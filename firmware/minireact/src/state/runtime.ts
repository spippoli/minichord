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
};

const PROBE_TIMEOUT_MS = 1000;
const DUMP_RETRY_MS = 1000;

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

  private state: AppState = initialAppState;
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: Unsubscribe[] = [];
  private dumpRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private disposed = false;

  constructor(transport: RuntimeTransport, options: RuntimeOptions = {}) {
    this.transport = transport;
    this.supported = options.supported ?? MinichordTransport.isSupported();
    this.probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.dumpRetryMs = options.dumpRetryMs ?? DUMP_RETRY_MS;
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
        // Straight onto the wire, for now. The write policy of SPEC.md 5.7 —
        // one pending value per address, flushed once per animation frame,
        // with a final flush on pointer-up — belongs to the first control that
        // can produce a drag, and lands here without the reducer changing.
        this.transport.sendParameter(effect.address, effect.value);
    }
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
