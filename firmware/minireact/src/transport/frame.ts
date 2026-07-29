/**
 * The wire format, and nothing else.
 *
 * Six bytes out, 514 bytes in. These functions know how a number becomes two
 * 7-bit bytes and how 512 bytes become 256 integers; they do not know what any
 * of those integers means. Everything semantic -- the /100 multiplier, the
 * exponential curve, the rhythm mask -- belongs to `domain/` (SPEC.md 3.5).
 */

/** The device state is a flat array of 256 integers (`parameter_size`). */
export const PARAMETER_COUNT = 256;

/** Highest addressable slot. Above it the firmware writes out of bounds. */
export const MAX_ADDRESS = PARAMETER_COUNT - 1;

/** Two 7-bit bytes carry a value: 128 * 128 - 1. */
export const MAX_VALUE = 16383;

/** Highest value that fits in a single wire byte, used by both command fields. */
export const MAX_COMMAND_FIELD = 127;

/**
 * A dump as Web MIDI delivers it, F0 included.
 *
 * The length to gate on is the firmware's: drop the leading F0 and 513 bytes
 * must remain -- 512 payload bytes and the closing F7 (`256 * 2 + 1`).
 */
export const DUMP_FRAME_LENGTH = PARAMETER_COUNT * 2 + 2;

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;

/**
 * Reject what the caller must not have sent.
 *
 * A value outside the legal range or a fractional one is a bug in the calling
 * code, not an operating condition, so it throws (SPEC.md 3.4). The legacy does
 * `parseInt(value % 128)` with no check at all, which turns a negative or
 * oversized number into corrupt bytes inside a formally valid frame.
 */
function checkField(value: number, max: number): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`expected an integer, received ${String(value)}`);
  }
  if (value < 0 || value > max) {
    throw new RangeError(`expected 0..${max}, received ${String(value)}`);
  }
}

/**
 * Frame one message: little-endian 7-bit split on both fields.
 *
 * Throws on an address or value the wire cannot carry.
 */
export function encodeMessage(address: number, value: number): Uint8Array {
  checkField(address, MAX_ADDRESS);
  checkField(value, MAX_VALUE);
  return Uint8Array.from([
    SYSEX_START,
    address % 128,
    Math.floor(address / 128),
    value % 128,
    Math.floor(value / 128),
    SYSEX_END,
  ]);
}

/**
 * Frame one command: address 0, the command in `valLo`, its argument in
 * `valHi`. Both fields are single bytes, so neither is split.
 */
export function encodeCommand(command: number, argument: number): Uint8Array {
  checkField(command, MAX_COMMAND_FIELD);
  checkField(argument, MAX_COMMAND_FIELD);
  return Uint8Array.from([SYSEX_START, 0, 0, command, argument, SYSEX_END]);
}

/** True for anything that opens like a SysEx frame. */
export function isSysex(data: Uint8Array): boolean {
  return data.length > 0 && data[0] === SYSEX_START;
}

/**
 * Decode a dump, or return null for anything that is not one.
 *
 * The gate is the firmware's own: drop the leading F0 and require exactly 513
 * bytes. Value `i` is `data[2i] + 128 * data[2i + 1]`. The values come out
 * verbatim -- no neutralisation of the potentiometer slots, no conversion --
 * because a transport that alters what the device said is no longer a mirror.
 */
export function decodeDumpFrame(data: Uint8Array): readonly number[] | null {
  if (!isSysex(data) || data.length !== DUMP_FRAME_LENGTH) return null;
  const values = new Array<number>(PARAMETER_COUNT);
  for (let i = 0; i < PARAMETER_COUNT; i += 1) {
    values[i] = data[1 + 2 * i] + 128 * data[2 + 2 * i];
  }
  return values;
}
