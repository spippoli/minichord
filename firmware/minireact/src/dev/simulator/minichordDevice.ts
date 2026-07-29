import { BANK_COUNT, DEFAULT_BANKS, PARAMETER_SIZE } from "./defaultBanks";

/**
 * The minichord's SysEx protocol, modelled as a pure state machine.
 *
 * Feed it 6-byte messages, get back the dumps it decides to emit. It has no
 * notion of time, of MIDI ports or of the Web MIDI API -- `FakeMidiAccess`
 * wraps it with all three.
 *
 * It models the *protocol only*, never audio. Nothing here says what a
 * parameter sounds like, so no sound decision can be validated against it.
 *
 * Behaviours below are copied from firmware/src/main.cpp rather than from the
 * legacy editor, including the ones that look like bugs -- a simulator that
 * quietly fixes the device teaches the app the wrong lessons.
 */

export const FIRMWARE_VERSION_ADDRESS = 7;
export const BANK_ADDRESS = 1;

/** Matches `int version_ID = 8` in firmware/src/main.cpp. */
export const SIMULATED_FIRMWARE_VERSION = 8;

export interface MinichordDeviceOptions {
  /** Bank selected at power-on. */
  initialBank?: number;
  /** Reported at address 7; lower it to exercise `introduction_version` gating. */
  firmwareVersion?: number;
}

export class MinichordDevice {
  /** The live 256 values -- the firmware's `current_sysex_parameters`. */
  private values: number[];
  /** Per-bank stored content -- the firmware's LittleFS files. */
  private banks: number[][];
  private bank: number;
  private readonly firmwareVersion: number;

  constructor(options: MinichordDeviceOptions = {}) {
    this.firmwareVersion =
      options.firmwareVersion ?? SIMULATED_FIRMWARE_VERSION;
    this.banks = DEFAULT_BANKS.map((bank) => [...bank]);
    this.bank = options.initialBank ?? 0;
    this.values = [];
    this.loadBank(this.bank);
  }

  /**
   * `load_config` in the firmware: read the bank file back into the live values.
   *
   * It ends with `control_command(0, 0)`, so every load emits a dump nobody
   * asked for. Callers return that dump; see `command` and `switchBank`.
   */
  private loadBank(bank: number): Uint8Array {
    this.bank = bank;
    this.values = [...this.banks[bank]];
    // `serialize` writes 0 at index 0 and the bank number at index 1, so a
    // reload always restores those two rather than whatever was in RAM.
    this.values[0] = 0;
    this.values[BANK_ADDRESS] = bank;
    this.values[FIRMWARE_VERSION_ADDRESS] = this.firmwareVersion;
    return this.encodeDump();
  }

  /** The 512-byte payload of a dump: little-endian 7-bit pairs, one per value. */
  private encodeDump(): Uint8Array {
    const payload = new Uint8Array(PARAMETER_SIZE * 2);
    for (let i = 0; i < PARAMETER_SIZE; i += 1) {
      payload[2 * i] = this.values[i] % 128;
      payload[2 * i + 1] = Math.floor(this.values[i] / 128);
    }
    return payload;
  }

  /** Read-only view of the 256 values, for assertions in tests. */
  snapshot(): readonly number[] {
    return [...this.values];
  }

  get currentBank(): number {
    return this.bank;
  }

  /**
   * Handle one inbound message. Returns the dump to emit, or null.
   *
   * The firmware gates on `getSysExArrayLength() == 6`, so anything else is
   * dropped without a word -- including a 6-byte message that is not SysEx.
   */
  receive(message: Uint8Array | readonly number[]): Uint8Array | null {
    const data = Array.from(message);
    if (data.length !== 6 || data[0] !== 0xf0 || data[5] !== 0xf7) return null;

    const address = data[1] + 128 * data[2];
    if (address === 0) return this.command(data[3], data[4]);

    const value = data[3] + 128 * data[4];
    // The firmware writes `current_sysex_parameters[adress] = value` with no
    // bounds check at all, so an address above 255 is an out-of-bounds write
    // into whatever follows the array. We refuse instead of reproducing memory
    // corruption; the transport is specified (#6) to throw before this point,
    // and this is the backstop that proves it never gets here.
    if (address >= PARAMETER_SIZE) return null;

    // Note the absence of any protection on addresses 2..9 or 10..17: the
    // firmware applies every write unconditionally. The "protected" and
    // "limited access" ranges are a convention of the editor, not of the device.
    this.values[address] = value;

    // ...with exactly one exception. `apply_audio_parameter` runs after the
    // store, and its `case 7` is `current_sysex_parameters[7] = version_ID`
    // (firmware/include/sysex_handler.h), so the device silently heals the
    // firmware-version slot. This matters: a preset load writes every address
    // from 2 to 255, and byte 7 of a shared preset is usually 0. Without this,
    // one preset load would leave the reported version wrong for good and every
    // parameter gated on `introduction_version` would go inactive.
    if (address === FIRMWARE_VERSION_ADDRESS) {
      this.values[FIRMWARE_VERSION_ADDRESS] = this.firmwareVersion;
    }
    return null;
  }

  private command(command: number, argument: number): Uint8Array | null {
    switch (command) {
      case 0: // send back all data
        return this.encodeDump();

      case 1: // wipe memory: quickFormat, then bank 0 from factory defaults
        this.banks = DEFAULT_BANKS.map((bank) => [...bank]);
        return this.loadBank(0);

      case 2: // save the live values into a bank
        if (argument >= BANK_COUNT) return null;
        this.banks[argument] = [...this.values];
        // `save_config` assigns `current_bank_number = bank_number` before
        // writing, then reloads: saving into a bank also *switches* to it.
        return this.loadBank(argument);

      case 3: // reset a bank to factory defaults and make it current
        if (argument >= BANK_COUNT) return null;
        this.banks[argument] = [...DEFAULT_BANKS[argument]];
        return this.loadBank(argument);

      default:
        return null;
    }
  }

  /**
   * Physical preset change -- the up/down buttons on the device.
   *
   * Returns the dump the firmware sends on its own initiative, with no request
   * from the app: the single most important thing the app must not assume away.
   */
  switchBank(bank: number): Uint8Array {
    return this.loadBank(((bank % BANK_COUNT) + BANK_COUNT) % BANK_COUNT);
  }
}
