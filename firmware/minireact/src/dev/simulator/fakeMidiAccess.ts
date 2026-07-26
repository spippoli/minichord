import { MinichordDevice, type MinichordDeviceOptions } from './minichordDevice'

/**
 * A fake `MIDIAccess` exposing a simulated minichord.
 *
 * The seam is deliberately low (see issue #6): the transport injects
 * `requestAccess`, so it is the real transport -- real 6-byte framing, real
 * 7-bit split, real 513-byte dump decoding, real port matching -- running
 * against a fake bus. Nothing about the transport is stubbed out, so the
 * simulator cannot drift away from the code it stands in for.
 *
 * Timing defaults come from a real device; see `CALIBRATION` below and
 * `tools/measure-device.py`.
 */

/**
 * Measured on a minichord running firmware version 8, over ALSA rawmidi,
 * on 2026-07-26. Reproduce with `python3 tools/measure-device.py`.
 */
export const CALIBRATION = {
  /**
   * Seconds of device time per inbound SysEx message.
   *
   * `loop()` calls `usbMIDI.read()` once per iteration, so ingest is capped at
   * one message per main-loop iteration. Measured as the slope of drain time
   * against burst size over 25..800 messages: 0.581 ms, i.e. ~1720 messages/s,
   * linear with no knee.
   */
  ingestSecondsPerMessage: 0.000_581,

  /** Round-trip of a (0, 0) command: median 0.81 ms, p95 1.41 ms, max 1.91 ms over 500. */
  dumpLatencySeconds: 0.000_81,

  /**
   * A save (command 2) writes flash and fully reloads the bank before
   * answering: measured 164 ms, two orders of magnitude above a plain dump.
   */
  saveLatencySeconds: 0.164,

  /**
   * No message loss was observed at any pacing, including none at all:
   * 0/195 lost across seven intervals, and 0/117 probe slots lost across
   * 254-message preset-load bursts. The host blocks rather than overflowing.
   */
  observedLossRate: 0,
} as const

export interface SimulatorOptions extends MinichordDeviceOptions {
  /**
   * Reproduce the measured device timing. Default true.
   *
   * Set false for deterministic tests: everything then resolves on a
   * microtask, and no timer is involved.
   */
  realisticTiming?: boolean
  /** Port name pattern to expose. The default matches the Linux ALSA naming. */
  portNames?: readonly [string, string]
}

class FakePort extends EventTarget {
  readonly manufacturer = 'minichord simulator'
  readonly version = '8'
  state: MIDIPortDeviceState = 'connected'
  connection: MIDIPortConnectionState = 'open'

  readonly id: string
  readonly name: string
  readonly type: MIDIPortType

  constructor(id: string, name: string, type: MIDIPortType) {
    super()
    this.id = id
    this.name = name
    this.type = type
  }

  async open(): Promise<this> {
    return this
  }

  async close(): Promise<this> {
    return this
  }
}

class FakeInput extends FakePort {
  onmidimessage: ((event: MIDIMessageEvent) => void) | null = null

  constructor(id: string, name: string) {
    super(id, name, 'input')
  }

  /** Deliver bytes as if they had arrived from the device. */
  deliver(data: Uint8Array): void {
    const event = new MessageEvent('midimessage', { data }) as unknown as MIDIMessageEvent
    this.onmidimessage?.(event)
    this.dispatchEvent(event as unknown as Event)
  }
}

class FakeOutput extends FakePort {
  private readonly onSend: (data: Uint8Array) => void

  constructor(id: string, name: string, onSend: (data: Uint8Array) => void) {
    super(id, name, 'output')
    this.onSend = onSend
  }

  send(data: number[] | Uint8Array): void {
    if (this.state !== 'connected') {
      // Matches the spec: sending to a disconnected port throws.
      throw new DOMException('port is not connected', 'InvalidStateError')
    }
    this.onSend(data instanceof Uint8Array ? data : Uint8Array.from(data))
  }

  clear(): void {
    // Chromium never implemented this (see the throughput research, issue #3).
    // The simulator matches Chromium rather than the spec, so no app can come
    // to depend on it working.
  }
}

/**
 * The simulated bus. Hand `requestAccess` to the transport; drive the physical
 * side of the device (bank buttons, unplugging) through the returned object.
 */
export class MinichordSimulator {
  readonly device: MinichordDevice
  readonly access: MIDIAccess

  private readonly input: FakeInput
  private readonly output: FakeOutput
  private readonly realisticTiming: boolean
  /** Device time at which the ingest queue drains, in performance-clock seconds. */
  private queueFreeAt = 0

  constructor(options: SimulatorOptions = {}) {
    this.device = new MinichordDevice(options)
    this.realisticTiming = options.realisticTiming ?? true
    const [first, second] = options.portNames ?? ['minichord MIDI 1', 'minichord MIDI 2']

    this.input = new FakeInput('sim-in-1', first)
    this.output = new FakeOutput('sim-out-1', first, (data) => this.handleSend(data))
    const otherIn = new FakeInput('sim-in-2', second)
    const otherOut = new FakeOutput('sim-out-2', second, () => {})

    const access = new EventTarget() as unknown as MIDIAccess
    Object.assign(access, {
      inputs: new Map<string, MIDIInput>([
        [this.input.id, this.input as unknown as MIDIInput],
        [otherIn.id, otherIn as unknown as MIDIInput],
      ]),
      outputs: new Map<string, MIDIOutput>([
        [this.output.id, this.output as unknown as MIDIOutput],
        [otherOut.id, otherOut as unknown as MIDIOutput],
      ]),
      sysexEnabled: true,
      onstatechange: null,
    })
    this.access = access
  }

  private now(): number {
    return performance.now() / 1000
  }

  /**
   * Model the firmware's serial ingest: one message per main-loop iteration.
   *
   * A burst therefore does not arrive all at once, it drains at a fixed rate,
   * which is what makes an uncoalesced slider drag feel laggy on the real
   * device. Nothing is ever dropped, because nothing ever was on the real one.
   */
  private handleSend(data: Uint8Array): void {
    const reply = this.device.receive(data)

    if (!this.realisticTiming) {
      if (reply) queueMicrotask(() => this.emit(reply))
      return
    }

    const now = this.now()
    const servicedAt = Math.max(now, this.queueFreeAt) + CALIBRATION.ingestSecondsPerMessage
    this.queueFreeAt = servicedAt
    if (!reply) return

    // A save reloads the bank from flash before answering; a plain dump does not.
    const isSave = data[1] === 0 && data[2] === 0 && data[3] === 2
    const extra = isSave ? CALIBRATION.saveLatencySeconds : CALIBRATION.dumpLatencySeconds
    this.after(servicedAt - now + extra, () => this.emit(reply))
  }

  private after(seconds: number, action: () => void): void {
    setTimeout(action, Math.max(0, seconds * 1000))
  }

  private emit(payload: Uint8Array): void {
    // The wire carries F0 + 512 bytes + F7, and Web MIDI hands the whole frame
    // to onmidimessage, F0 included.
    const frame = new Uint8Array(payload.length + 2)
    frame[0] = 0xf0
    frame.set(payload, 1)
    frame[frame.length - 1] = 0xf7
    this.input.deliver(frame)
  }

  // -- the physical side, for driving prototypes -------------------------

  /**
   * Press the preset up/down buttons. The device reloads the bank and sends a
   * dump on its own initiative -- the app never asked for it.
   */
  pressPresetButton(direction: 1 | -1): void {
    const dump = this.device.switchBank(this.device.currentBank + direction)
    this.after(this.realisticTiming ? CALIBRATION.saveLatencySeconds : 0, () =>
      this.emit(dump),
    )
  }

  /** Unplug the device. Ports go to `disconnected` and `statechange` fires. */
  disconnect(): void {
    for (const port of [this.input, this.output]) {
      port.state = 'disconnected'
      port.connection = 'closed'
    }
    this.fireStateChange(this.input)
  }

  /** Plug it back in. */
  reconnect(): void {
    for (const port of [this.input, this.output]) {
      port.state = 'connected'
      port.connection = 'open'
    }
    this.queueFreeAt = 0
    this.fireStateChange(this.input)
  }

  private fireStateChange(port: FakePort): void {
    const event = new Event('statechange') as MIDIConnectionEvent
    Object.defineProperty(event, 'port', { value: port, configurable: true })
    this.access.onstatechange?.call(this.access, event)
    this.access.dispatchEvent(event)
  }

  /** Drop-in for `navigator.requestMIDIAccess`, to inject into the transport. */
  requestAccess = async (options?: MIDIOptions): Promise<MIDIAccess> => {
    if (!options?.sysex) {
      throw new DOMException('sysex access is required', 'SecurityError')
    }
    return this.access
  }
}
