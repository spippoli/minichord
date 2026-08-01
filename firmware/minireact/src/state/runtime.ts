import { BANK_ADDRESS, presetWriteMap } from "../domain";
import {
  MinichordTransport,
  type PortRef,
  type TransportEvent,
  type Unsubscribe,
} from "../transport";
import { makeBulkWrite, type BulkWriteResult } from "./bulkWrite";
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
  saveToBank(bank: number): boolean;
  resetBank(bank: number): boolean;
  wipeMemory(): boolean;
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
  /** How long a bulk write waits for the dump that confirms it. */
  bulkDumpTimeoutMs?: number;
  /** How long a flash command waits for the dump that confirms it. */
  commandTimeoutMs?: number;
  /** The animation frame the write policy flushes on (SPEC.md 5.7). */
  scheduleFlush?: FrameScheduler;
};

const PROBE_TIMEOUT_MS = 1000;
const DUMP_RETRY_MS = 1000;

/**
 * The window a bulk write gives the confirming dump.
 *
 * SPEC.md 1.6 budgets ~148 ms of device time for 254 messages *before* the dump
 * can even be asked for, and calls that a lower bound. This is that bound with
 * room around it: it is not a retry, it is the point past which the device is
 * not answering and the caller is owed a count rather than a hung promise.
 */
const BULK_DUMP_TIMEOUT_MS = 2000;

/**
 * The window a save, a reset or a wipe is given.
 *
 * All three erase and rewrite flash and then reload the bank, measured at 164
 * ms and read off the firmware source for the other two (SPEC.md 1.2). This is
 * an order of magnitude above that: it is not a retry, it is the point past
 * which the device is not answering and the editing row must stop being
 * disabled by a promise nobody is going to keep.
 */
const COMMAND_TIMEOUT_MS = 2000;

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
  private readonly bulkDumpTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly scheduleFlush: FrameScheduler;

  private state: AppState = initialAppState;
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: Unsubscribe[] = [];
  private dumpRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** The window the flash command in flight has left, if there is one. */
  private commandTimer: ReturnType<typeof setTimeout> | null = null;
  /** At most one value per address, waiting for the frame (SPEC.md 5.7). */
  private readonly pendingWrites = new Map<number, number>();
  /** Who is waiting for the next dump: at most one bulk write at a time. */
  private readonly dumpWaiters = new Set<
    (values: readonly number[] | null) => void
  >();
  private cancelFlush: (() => void) | null = null;
  private started = false;
  private disposed = false;

  constructor(transport: RuntimeTransport, options: RuntimeOptions = {}) {
    this.transport = transport;
    this.supported = options.supported ?? MinichordTransport.isSupported();
    this.probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.dumpRetryMs = options.dumpRetryMs ?? DUMP_RETRY_MS;
    this.bulkDumpTimeoutMs = options.bulkDumpTimeoutMs ?? BULK_DUMP_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
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
    this.cancelCommandTimeout();
    this.cancelPendingFlush();
    this.pendingWrites.clear();
    // A bulk write in flight is owed an answer, and "no dump" is one: a hung
    // promise would keep the caller's button saying "Applying…" forever.
    this.settleDumpWaiters(null);
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
   * Commit the live state to the bank the device is in (SPEC.md 10.2).
   *
   * No argument, and that is the design: the firmware's `save_config` sets the
   * current bank before reloading, so any target other than the current one
   * would move the user through the destructive door. The bank is the store's
   * to read (see the reducer), not the caller's to name.
   */
  saveBank(): void {
    this.dispatch({ type: "bank-command", command: "save" });
  }

  /** Reset the current bank to the factory sound. Irreversible (SPEC.md 10.4). */
  resetBank(): void {
    this.dispatch({ type: "bank-command", command: "reset" });
  }

  /** Reset all twelve banks. The maintenance gesture of SPEC.md 10.6. */
  wipeMemory(): void {
    this.dispatch({ type: "bank-command", command: "wipe" });
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

  /**
   * Write a set of addresses and report what did not take (SPEC.md 5.8).
   *
   * The signature the three callers see is the specification's: a map in, a
   * count out. What it costs — unpaced writes, a dump, a comparison excluding
   * 2–7, a repair round and a second dump — is `bulkWrite.ts`'s, and the
   * runtime contributes only the wire and the waiting, neither of which a pure
   * module can hold.
   *
   * It **does not queue behind the coalescing frame**: that queue exists to
   * keep a 1000 Hz mouse off the wire, and a bulk write is 189 distinct
   * addresses that would each survive coalescing anyway (SPEC.md 5.7). But it
   * **drains the queue first rather than jumping it** — a write still waiting
   * for its frame, a slider let go in the same frame as the click, would
   * otherwise reach the device *after* these sends and re-apply the very value
   * being reverted. Draining is not pacing: the queue's own reason is intact.
   *
   * With no wire it writes nothing and says so. The reducer refuses single
   * edits while the connection is interrupted (SPEC.md 5.2), and a bulk write
   * that went around it would be the one lie that rule exists to prevent.
   */
  bulkWrite(values: ReadonlyMap<number, number>): Promise<BulkWriteResult> {
    if (this.state.connection.status !== "connected" || this.disposed) {
      return Promise.resolve({
        applied: 0,
        diverged: [...values.keys()],
      });
    }

    this.cancelPendingFlush();
    this.flushWrites();

    // The bank the write is about, read before the first send: a dump carrying
    // another one is somebody else's (see `nextDump`).
    const bank = this.state.parameters.values?.[BANK_ADDRESS];

    return makeBulkWrite({
      send: (address, value) => {
        this.transport.sendParameter(address, value);
      },
      requestDump: () => {
        this.transport.requestDump();
      },
      nextDump: () => this.nextDump(bank),
    })(values);
  }

  /**
   * Write a decoded preset code to the device (SPEC.md 11.3).
   *
   * The whole of the intent: the map is the domain's — 189 declared addresses,
   * never 1, never 2–7, never 255 — the round trips and the repair round are
   * `bulkWrite`'s, and what is left over becomes the strip's line. This method
   * is the seam between the three and holds no rule of its own.
   *
   * It resolves when there is nothing left to say, so the field that called it
   * can stop saying "Applying…". What it resolves *with* is nothing: the count
   * has already gone into the store, and a caller reading it a second time to
   * compose its own message would be a second voice for one round trip
   * (SPEC.md 9.7).
   */
  async applyPreset(values: readonly number[]): Promise<void> {
    const { diverged } = await this.bulkWrite(presetWriteMap(values));
    this.dispatch({ type: "preset-applied", diverged: diverged.length });
  }

  // -- internals -----------------------------------------------------------

  private onTransportEvent(event: TransportEvent): void {
    switch (event.type) {
      case "dump":
        this.dispatch({ type: "dump", values: event.values });
        // After the store, never before: a bulk write that resolves first would
        // hand its caller a count describing a panel that has not redrawn.
        this.settleDumpWaiters(event.values);
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
        return;

      case "schedule-command-timeout":
        // One timer, replaced rather than stacked: there is at most one command
        // in flight, because the row that issues them is disabled while one is.
        if (this.commandTimer !== null) clearTimeout(this.commandTimer);
        this.commandTimer = setTimeout(() => {
          this.commandTimer = null;
          this.dispatch({ type: "command-timeout" });
        }, this.commandTimeoutMs);
        return;

      case "device-command":
        // Nothing waits for the answer: the device confirms all three with an
        // unsolicited dump (SPEC.md 1.3), which arrives by the one door every
        // dump arrives by and is consumed by the flag the reducer raised.
        switch (effect.command) {
          case "save":
            this.transport.saveToBank(effect.bank);
            return;
          case "reset":
            this.transport.resetBank(effect.bank);
            return;
          case "wipe":
            this.transport.wipeMemory();
        }
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

  /**
   * The next dump about `bank`, or `null` once the window of SPEC.md 1.6 has
   * gone by.
   *
   * The dump is a subscription rather than the answer to a request — the device
   * announces dumps nobody asked for, and one cannot be told from the other by
   * inspecting the payload, which SPEC.md 1.3 says never to try. This is the
   * one place that fact is turned into a promise, and it is deliberately not a
   * general "solicited dump" abstraction: a bulk write is the only caller that
   * needs to wait for one.
   *
   * **One announcement can still be told apart, and it is the one that hurts.**
   * Every unsolicited dump follows something that reloads the device from flash
   * — a save, a reset, a wipe, a press of the physical preset buttons, a boot —
   * and the ones we did not cause ourselves arrive on a *different bank*. Such
   * a dump describes a state that has nothing to do with what was just sent, so
   * taking it as the answer would report every address as diverged and then
   * re-send the previous bank's values over the new one. Reading address 1 is
   * not inspecting the payload for what changed: it is the same question
   * SPEC.md 10.3 already asks of every dump, about what caused it.
   *
   * A same-bank announcement remains indistinguishable and stays that way. It
   * costs a repair round and nothing else, which is what the round is for.
   */
  private nextDump(
    bank: number | undefined,
  ): Promise<readonly number[] | null> {
    return new Promise((resolve) => {
      const settle = (values: readonly number[] | null) => {
        // Not ours: keep waiting, and let the window run as it was.
        if (values && bank !== undefined && values[BANK_ADDRESS] !== bank) {
          return;
        }
        clearTimeout(timer);
        this.dumpWaiters.delete(settle);
        resolve(values);
      };
      const timer = setTimeout(() => {
        settle(null);
      }, this.bulkDumpTimeoutMs);
      this.dumpWaiters.add(settle);
    });
  }

  private settleDumpWaiters(values: readonly number[] | null): void {
    for (const waiter of [...this.dumpWaiters]) waiter(values);
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

  private cancelCommandTimeout(): void {
    if (this.commandTimer === null) return;
    clearTimeout(this.commandTimer);
    this.commandTimer = null;
  }

  private cancelDumpRetry(): void {
    if (this.dumpRetryTimer === null) return;
    clearTimeout(this.dumpRetryTimer);
    this.dumpRetryTimer = null;
  }
}
