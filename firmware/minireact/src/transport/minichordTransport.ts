import {
  decodeDumpFrame,
  encodeCommand,
  encodeMessage,
  isSysex,
} from "./frame";
import type {
  PortRef,
  TransportErrorReason,
  TransportEvent,
  TransportListener,
  TransportSeams,
  Unsubscribe,
} from "./types";

/** The four commands the firmware understands at address 0 (SPEC.md 1.2). */
const COMMAND = {
  dump: 0,
  wipe: 1,
  save: 2,
  reset: 3,
} as const;

/** The permission the Web MIDI API answers for, SysEx included. */
const MIDI_PERMISSION = { name: "midi", sysex: true } as PermissionDescriptor;

/** An output and the input the transport paired it with, kept private. */
type PortPair = { output: MIDIOutput; input: MIDIInput | null };

/**
 * A faithful mirror of the wire: no initiative, no semantics.
 *
 * It knows what six bytes and a 513-byte dump are; it does not know what an
 * address means. `state/` drives, the transport answers (SPEC.md 3.1).
 *
 * Deliberately absent (SPEC.md 3.5): value conversion, the rhythm mask, the
 * neutralisation of the potentiometer slots, the initial dump request, the port
 * name filter, the firmware version check, and every user-facing string.
 */
export class MinichordTransport {
  private readonly seams: TransportSeams;
  private readonly listeners = new Set<TransportListener>();
  private readonly permissionListeners = new Set<
    (state: PermissionState) => void
  >();
  private readonly portListeners = new Set<() => void>();

  private access: MIDIAccess | null = null;
  /** Output id -> the pair behind it. The pairing never crosses the seam. */
  private pairs = new Map<string, PortPair>();
  /** What `listPorts` describes, rebuilt whenever the bus changes. */
  private portRefs: PortRef[] = [];
  /** The bound pair, by identity, so it survives the pair map being rebuilt. */
  private bound: { outputId: string; inputId: string | null } | null = null;
  /** Last connection state reported for the bound port, to report each once. */
  private boundConnected: boolean | null = null;
  /** Input id -> the probes waiting to swallow the next dump on that input. */
  private readonly probes = new Map<string, Array<() => void>>();
  private permissionStatus: PermissionStatus | null = null;
  private permissionWatched = false;
  /** Last permission answer seen, from whichever source read it. */
  private lastPermission: PermissionState | null = null;

  constructor(seams: TransportSeams = {}) {
    this.seams = seams;
  }

  // -- capability and permission ------------------------------------------

  /**
   * Whether this platform has a Web MIDI API at all.
   *
   * A capability question, never an identity one: no user-agent is inspected
   * anywhere in this layer (SPEC.md 9.2).
   */
  static isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.requestMIDIAccess === "function"
    );
  }

  /**
   * Read the permission without raising the prompt.
   *
   * Where the query cannot be answered -- no Permissions API, or a browser that
   * does not know the `midi` name -- the answer is `prompt`, so the decision
   * falls to an explicit user action rather than to a guess.
   */
  async queryPermission(): Promise<PermissionState> {
    const state = this.seams.queryPermission
      ? await this.seams.queryPermission()
      : ((await this.nativePermissionStatus())?.state ?? "prompt");
    this.notePermission(state);
    return state;
  }

  /**
   * Watch the permission, so a change made in site settings is noticed without
   * a reload (SPEC.md 9.2).
   *
   * Two sources feed it: the platform's `PermissionStatus` change event, and any
   * reading taken through `queryPermission` -- including one taken through an
   * injected seam, which is what makes this observable with no DOM at all. The
   * first reading is the baseline; only a different answer is a change.
   */
  onPermissionChange(cb: (state: PermissionState) => void): Unsubscribe {
    this.permissionListeners.add(cb);
    void this.watchPermission();
    return () => {
      this.permissionListeners.delete(cb);
    };
  }

  /**
   * Ask for MIDI access with SysEx.
   *
   * Failure is an operating condition, so it arrives as a typed `error` event
   * rather than as a rejection: an exception out of this layer means a caller
   * contract violation and nothing else (SPEC.md 3.4).
   */
  async requestAccess(): Promise<void> {
    const request =
      this.seams.requestAccess ??
      (MinichordTransport.isSupported()
        ? () => navigator.requestMIDIAccess({ sysex: true })
        : null);

    if (!request) {
      this.emitError("unsupported");
      return;
    }

    let access: MIDIAccess;
    try {
      access = await request();
    } catch {
      this.emitError("access-denied");
      return;
    }

    this.access = access;
    access.addEventListener("statechange", (event) => {
      this.onStateChange(event as MIDIConnectionEvent);
    });
    this.refreshPorts();
  }

  // -- ports ---------------------------------------------------------------

  /**
   * Every output port, as an id and a name.
   *
   * No filtering: which of these is a minichord is decided above, by name and
   * then by `probe` (SPEC.md 9.3).
   */
  listPorts(): readonly PortRef[] {
    this.refreshPorts();
    // A copy: a seam whose whole argument is opacity does not hand out the
    // array it keeps.
    return [...this.portRefs];
  }

  /**
   * Watch the bus itself: any port appearing or going away.
   *
   * The `connection` event reports the *bound* device and nothing else, on
   * purpose. This reports the bus, which is a different question and the one
   * `no-device` waits on: with no port bound there is nothing to report a
   * connection for, and plugging a minichord in must still end the gate without
   * the user pressing anything (SPEC.md 9.8). It carries no payload — what
   * changed is `listPorts()`, and deciding what it means is `state/`'s.
   */
  onPortsChanged(listener: () => void): Unsubscribe {
    this.portListeners.add(listener);
    return () => {
      this.portListeners.delete(listener);
    };
  }

  /**
   * Send `(0, 0)` on one port and wait for a dump inside the caller's window.
   *
   * The dump it consumes is discarded and never emitted: it is evidence that
   * this port is a minichord, not device state anyone asked for (SPEC.md 3.3).
   * One candidate, one wire operation, no policy -- the parallel fan-out and
   * the 0/1/2+ decision belong to `state/connection`.
   */
  probe(port: PortRef, timeoutMs: number): Promise<boolean> {
    const pair = this.pairs.get(port.id);
    if (!pair?.input) return Promise.resolve(false);
    const inputId = pair.input.id;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (answer: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.dropProbe(inputId, waiting);
        resolve(answer);
      };
      const waiting = () => {
        finish(true);
      };
      const timer = setTimeout(() => {
        finish(false);
      }, timeoutMs);

      const queue = this.probes.get(inputId);
      if (queue) queue.push(waiting);
      else this.probes.set(inputId, [waiting]);

      if (!this.write(pair.output, encodeCommand(COMMAND.dump, 0))) {
        finish(false);
      }
    });
  }

  /**
   * Make one port the one this transport reads from and writes to.
   *
   * A port this transport does not know leaves it unbound rather than throwing:
   * a stale `PortRef` is an ordinary consequence of a device going away, and the
   * mechanism for that is the `false` every later send returns (SPEC.md 3.4).
   */
  bind(port: PortRef): void {
    const pair = this.pairs.get(port.id);
    if (!pair) {
      this.unbind();
      return;
    }
    this.bound = { outputId: port.id, inputId: pair.input?.id ?? null };
    this.boundConnected = pair.output.state === "connected";
  }

  unbind(): void {
    this.bound = null;
    this.boundConnected = null;
  }

  // -- sending -------------------------------------------------------------

  /**
   * Write one raw value at one address.
   *
   * The value is already what travels on the wire: the /100 multiplier and the
   * exponential curve are `domain`'s (SPEC.md 4.3).
   *
   * Throws on an address or value out of range or not an integer -- a bug in
   * the caller, whose only alternative is sending garbage to a device that will
   * apply it. Returns false when there is no wire to write to.
   */
  sendParameter(address: number, rawValue: number): boolean {
    return this.sendToBound(encodeMessage(address, rawValue));
  }

  /** Write one command at address 0. Same contract as `sendParameter`. */
  sendCommand(command: number, argument: number): boolean {
    return this.sendToBound(encodeCommand(command, argument));
  }

  /** Command 0: ask for the full state. */
  requestDump(): boolean {
    return this.sendCommand(COMMAND.dump, 0);
  }

  /** Command 1: wipe all memory back to factory. */
  wipeMemory(): boolean {
    return this.sendCommand(COMMAND.wipe, 0);
  }

  /** Command 2: save the live state into a bank -- which also switches to it. */
  saveToBank(bank: number): boolean {
    return this.sendCommand(COMMAND.save, bank);
  }

  /** Command 3: reset a bank to factory defaults. */
  resetBank(bank: number): boolean {
    return this.sendCommand(COMMAND.reset, bank);
  }

  // -- events --------------------------------------------------------------

  /**
   * Listen to everything this transport reports.
   *
   * Several listeners at once, each with its own unsubscribe: a dump interests
   * the store, the strip and any future debug panel at the same time.
   */
  subscribe(listener: TransportListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- internals -----------------------------------------------------------

  private sendToBound(bytes: Uint8Array): boolean {
    const pair = this.bound ? this.pairs.get(this.bound.outputId) : undefined;
    if (!pair) return false;
    return this.write(pair.output, bytes);
  }

  /**
   * Hand the bytes to the platform.
   *
   * A port that has gone away is an ordinary runtime state, not a programming
   * error, so it is a `false` rather than a throw (SPEC.md 3.4, 9.4).
   */
  private write(output: MIDIOutput, bytes: Uint8Array): boolean {
    if (output.state !== "connected") return false;
    try {
      output.send(bytes);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rebuild the output-to-input pairing and listen on every input.
   *
   * Ports are paired by name, in enumeration order: the firmware declares one
   * USB product string and no per-cable names, so the two cables can arrive
   * with identical names and only their order tells them apart (SPEC.md 9.3).
   */
  private refreshPorts(): void {
    if (!this.access) return;

    const inputsByName = new Map<string, MIDIInput[]>();
    for (const input of this.access.inputs.values()) {
      const queue = inputsByName.get(input.name ?? "");
      if (queue) queue.push(input);
      else inputsByName.set(input.name ?? "", [input]);
      this.listen(input);
    }

    this.pairs = new Map();
    this.portRefs = [];
    for (const output of this.access.outputs.values()) {
      const name = output.name ?? "";
      const input = inputsByName.get(name)?.shift() ?? null;
      this.pairs.set(output.id, { output, input });
      this.portRefs.push({ id: output.id, name });
    }
  }

  private listen(input: MIDIInput): void {
    input.onmidimessage = (event: MIDIMessageEvent) => {
      this.receive(input.id, event.data ?? new Uint8Array(0));
    };
  }

  /**
   * One inbound message.
   *
   * Anything that is not a 514-byte SysEx frame is ignored, exactly as the
   * firmware ignores anything that is not six bytes. A SysEx frame of the wrong
   * length is reported as `malformed-message` -- it says something is wrong on
   * the wire; ordinary MIDI traffic on the same port says nothing at all.
   */
  private receive(inputId: string, data: Uint8Array): void {
    const values = decodeDumpFrame(data);
    if (!values) {
      if (isSysex(data)) this.emitError("malformed-message");
      return;
    }

    const waiting = this.probes.get(inputId);
    if (waiting?.length) {
      // Consumed by a probe, and therefore never emitted (SPEC.md 3.3).
      waiting.shift()?.();
      return;
    }

    if (this.bound?.inputId !== inputId) return;
    this.emit({ type: "dump", values });
  }

  private dropProbe(inputId: string, waiting: () => void): void {
    const queue = this.probes.get(inputId);
    if (!queue) return;
    const at = queue.indexOf(waiting);
    if (at >= 0) queue.splice(at, 1);
    if (queue.length === 0) this.probes.delete(inputId);
  }

  /**
   * A port on the bus changed state.
   *
   * Only the bound device is reported, and only when it actually changes:
   * `state/` turns the whole editor read-only on a `connected: false` (SPEC.md
   * 9.4), which somebody else's synth being unplugged must not do -- and one
   * physical unplug announces both halves of the device, which is one event.
   */
  private onStateChange(event: MIDIConnectionEvent): void {
    this.refreshPorts();
    for (const listener of [...this.portListeners]) listener();
    const port = event.port;
    if (!port || !this.bound) return;
    if (port.id !== this.bound.outputId && port.id !== this.bound.inputId) {
      return;
    }
    const connected =
      this.pairs.get(this.bound.outputId)?.output.state === "connected";
    if (connected === this.boundConnected) return;
    this.boundConnected = connected;
    this.emit({ type: "connection", connected });
  }

  private async nativePermissionStatus(): Promise<PermissionStatus | null> {
    if (this.permissionStatus) return this.permissionStatus;
    if (typeof navigator === "undefined" || !navigator.permissions) return null;
    try {
      this.permissionStatus =
        await navigator.permissions.query(MIDI_PERMISSION);
    } catch {
      return null;
    }
    return this.permissionStatus;
  }

  private async watchPermission(): Promise<void> {
    if (this.permissionWatched) return;
    this.permissionWatched = true;
    // Establish the baseline, through the seam when there is one.
    await this.queryPermission();
    if (this.seams.queryPermission) return;
    const status = await this.nativePermissionStatus();
    // No Permissions API: the unsubscribe stays valid, it simply has nothing to
    // undo, and readings taken through `queryPermission` still report changes.
    if (!status) return;
    status.addEventListener("change", () => {
      this.notePermission(status.state);
    });
  }

  private notePermission(state: PermissionState): void {
    const previous = this.lastPermission;
    this.lastPermission = state;
    if (previous === null || previous === state) return;
    for (const listener of [...this.permissionListeners]) listener(state);
  }

  private emitError(reason: TransportErrorReason): void {
    this.emit({ type: "error", reason });
  }

  private emit(event: TransportEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
