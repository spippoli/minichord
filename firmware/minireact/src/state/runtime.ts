import {
  MinichordTransport,
  type PortRef,
  type TransportEvent,
  type Unsubscribe,
} from "../transport";
import { isCandidatePort } from "./connection/ports";
import type { Effect } from "./effects";
import type { AppEvent } from "./events";
import { initialAppState, root, type AppState } from "./reducer";

/**
 * The slice of the transport the runtime drives.
 *
 * Structural, and `MinichordTransport` satisfies it as it is: a test can hand
 * the runtime a double for the one path the simulator cannot stage — a device
 * that answers a probe and then swallows the dump request.
 */
export type RuntimeTransport = {
  queryPermission(): Promise<PermissionState>;
  onPermissionChange(cb: (state: PermissionState) => void): Unsubscribe;
  requestAccess(): Promise<void>;
  listPorts(): readonly PortRef[];
  probe(port: PortRef, timeoutMs: number): Promise<boolean>;
  bind(port: PortRef): void;
  requestDump(): boolean;
  sendParameter(address: number, rawValue: number): boolean;
  subscribe(listener: (event: TransportEvent) => void): Unsubscribe;
  onPortsChanged(listener: () => void): Unsubscribe;
};

/**
 * Ask for the next frame, and hand back the way to call it off.
 *
 * Injected so the write policy can be driven a frame at a time in a test, where
 * there is no `requestAnimationFrame` and no vsync to wait for.
 */
export type FrameScheduler = (flush: () => void) => () => void;

export type RuntimeOptions = {
  /**
   * Whether this platform has a Web MIDI API at all. Defaults to asking
   * `MinichordTransport`; an injected transport can say otherwise.
   */
  supported?: boolean;
  /** The probe window of SPEC.md 9.3. */
  probeTimeoutMs?: number;
  /** How long a dump request waits before the retry of SPEC.md 5.9. */
  dumpRetryMs?: number;
  /** The animation frame the write policy flushes on (SPEC.md 5.7). */
  scheduleFlush?: FrameScheduler;
};

const PROBE_TIMEOUT_MS = 1000;
const DUMP_RETRY_MS = 1000;

const scheduleOnFrame: FrameScheduler = (flush) => {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(() => flush());
    return () => {
      cancelAnimationFrame(handle);
    };
  }
  const timer = setTimeout(flush, 0);
  return () => {
    clearTimeout(timer);
  };
};

/**
 * The engine: dispatch, execute, notify.
 *
 * **A plain class, not a hook, and it imports no React.** A pure reducer cannot
 * await a probe, hold a one-second timer or subscribe to a wire; this holds the
 * transport, dispatches every event into `root`, performs the effects the
 * reducer returned and notifies its own subscribers (SPEC.md 5.6).
 *
 * React reads it through a single `useSyncExternalStore`. It is a reader, not
 * the motor — which is what lets the probe, the retry and the reconnection path
 * be exercised headless against the simulator, the whole reason the simulator
 * exists.
 */
export class Runtime {
  private readonly transport: RuntimeTransport;
  private readonly supported: boolean;
  private readonly probeTimeoutMs: number;
  private readonly dumpRetryMs: number;
  private readonly scheduleFlush: FrameScheduler;

  private state: AppState = initialAppState;
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: Unsubscribe[] = [];
  private dumpRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** At most one value per address, waiting for the frame (SPEC.md 5.7). */
  private readonly pendingWrites = new Map<number, number>();
  private cancelFlush: (() => void) | null = null;
  private started = false;
  private disposed = false;

  constructor(transport: RuntimeTransport, options: RuntimeOptions = {}) {
    this.transport = transport;
    this.supported = options.supported ?? MinichordTransport.isSupported();
    this.probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.dumpRetryMs = options.dumpRetryMs ?? DUMP_RETRY_MS;
    this.scheduleFlush = options.scheduleFlush ?? scheduleOnFrame;
  }

  /** Wire up to the transport and decide what the gate shows. Idempotent. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;

    this.subscriptions.push(
      this.transport.subscribe((event) => {
        this.onTransportEvent(event);
      }),
      this.transport.onPortsChanged(() => {
        this.dispatch({ type: "ports-changed" });
      }),
      this.transport.onPermissionChange((state) => {
        this.dispatch({ type: "permission", state });
      }),
    );

    this.dispatch({ type: "boot", supported: this.supported });
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelDumpRetry();
    this.cancelPendingFlush();
    this.pendingWrites.clear();
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.listeners.clear();
  }

  // -- intents, the only thing `ui/` may call ------------------------------

  /** The Connect button of the `idle` gate. */
  connect(): void {
    this.dispatch({ type: "connect" });
  }

  /** The Try again button of the `no-device` gate. */
  retry(): void {
    this.dispatch({ type: "retry" });
  }

  /** A port clicked in `choose`, or picked by hand in `no-device`. */
  pick(port: PortRef): void {
    this.dispatch({ type: "pick", port });
  }

  /** One control moved: one address, one raw wire value. */
  setParameter(address: number, rawValue: number): void {
    this.dispatch({ type: "edit", address, value: rawValue });
  }

  /**
   * A pointer went down on a control. Until it comes up, that address is the
   * one thing a dump may not overrule (SPEC.md 5.3).
   */
  pointerDown(address: number): void {
    this.dispatch({ type: "pointer-down", address });
  }

  /** The pointer came up: the exception ends and the wire is flushed. */
  pointerUp(): void {
    this.dispatch({ type: "pointer-up" });
  }

  // -- internals -----------------------------------------------------------

  private onTransportEvent(event: TransportEvent): void {
    switch (event.type) {
      case "dump":
        this.dispatch({ type: "dump", values: event.values });
        return;
      case "connection":
        this.dispatch({
          type: "transport-connection",
          connected: event.connected,
        });
        return;
      case "error":
        if (event.reason === "malformed-message") {
          // A bug of ours, with no human remedy: the console, never a screen
          // (SPEC.md 9.7).
          console.warn("minichord: malformed message on the wire");
          return;
        }
        this.dispatch({ type: "transport-error", reason: event.reason });
    }
  }

  private dispatch(event: AppEvent): void {
    if (this.disposed) return;
    const { state, effects } = root(this.state, event);
    if (state !== this.state) {
      this.state = state;
      for (const listener of [...this.listeners]) listener();
    }
    for (const effect of effects) this.perform(effect);
  }

  private perform(effect: Effect): void {
    switch (effect.type) {
      case "query-permission":
        void this.transport.queryPermission().then((state) => {
          this.dispatch({ type: "permission", state });
        });
        return;

      case "request-access":
        // Failure arrives as an `error` event, not as a rejection (SPEC.md
        // 3.4), and the reducer ignores `access-granted` from `blocked`.
        void this.transport.requestAccess().then(() => {
          this.dispatch({ type: "access-granted" });
        });
        return;

      case "discover":
        void this.discover();
        return;

      case "probe-port":
        void this.transport
          .probe(effect.port, this.probeTimeoutMs)
          .then((answered) => {
            this.dispatch({
              type: "manual-probe-result",
              port: effect.port,
              answered,
            });
          });
        return;

      case "bind":
        this.transport.bind(effect.port);
        return;

      case "request-dump":
        this.transport.requestDump();
        return;

      case "schedule-dump-retry":
        this.cancelDumpRetry();
        this.dumpRetryTimer = setTimeout(() => {
          this.dumpRetryTimer = null;
          this.dispatch({ type: "dump-timeout" });
        }, this.dumpRetryMs);
        return;

      case "cancel-dump-retry":
        this.cancelDumpRetry();
        return;

      case "write":
        this.pendingWrites.set(effect.address, effect.value);
        if (!this.cancelFlush) {
          this.cancelFlush = this.scheduleFlush(() => {
            this.cancelFlush = null;
            this.flushWrites();
          });
        }
        return;

      case "flush-writes":
        this.cancelPendingFlush();
        this.flushWrites();
    }
  }

  /**
   * The write policy of SPEC.md 5.7, in one place.
   *
   * Coalescing is what does the work: one address at 60 Hz is 3.5% of the
   * measured ceiling, while an uncoalesced 1000 Hz mouse on a single slider
   * would sit at 58% of it with nothing left for a second control. Pacing was
   * not adopted — 254 messages at zero interval lost nothing.
   *
   * The `timestamp` is the transport's business and is always 0: Web MIDI's
   * scheduling is unusable in Chromium, where `clear()` was never implemented,
   * so a scheduled message cannot be called back.
   */
  private flushWrites(): void {
    if (this.pendingWrites.size === 0) return;
    const pending = [...this.pendingWrites];
    this.pendingWrites.clear();
    for (const [address, value] of pending) {
      this.transport.sendParameter(address, value);
    }
  }

  private cancelPendingFlush(): void {
    if (!this.cancelFlush) return;
    this.cancelFlush();
    this.cancelFlush = null;
  }

  /**
   * The name filters, the parallel fan-out, the count (SPEC.md 9.3).
   *
   * Every candidate is asked at the same time and each gets the same window:
   * cable 2 stays silent and excludes itself, whatever it is called.
   */
  private async discover(): Promise<void> {
    const ports = this.transport.listPorts();
    const candidates = ports.filter((port) => isCandidatePort(port.name));
    const answers = await Promise.all(
      candidates.map((port) => this.transport.probe(port, this.probeTimeoutMs)),
    );
    this.dispatch({
      type: "probe-results",
      answered: candidates.filter((_, at) => answers[at]),
      ports,
    });
  }

  private cancelDumpRetry(): void {
    if (this.dumpRetryTimer === null) return;
    clearTimeout(this.dumpRetryTimer);
    this.dumpRetryTimer = null;
  }
}
