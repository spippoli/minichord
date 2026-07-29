import { describe, expect, it } from "vitest";

import {
  DUMP_FRAME_LENGTH,
  MAX_ADDRESS,
  MAX_VALUE,
  PARAMETER_COUNT,
  decodeDumpFrame,
  encodeMessage,
} from "./frame";

/** Build a dump frame the way the device does: F0, 512 payload bytes, F7. */
function dumpFrame(values: readonly number[]): Uint8Array {
  const frame = new Uint8Array(DUMP_FRAME_LENGTH);
  frame[0] = 0xf0;
  for (let i = 0; i < PARAMETER_COUNT; i += 1) {
    frame[1 + 2 * i] = values[i] % 128;
    frame[2 + 2 * i] = Math.floor(values[i] / 128);
  }
  frame[DUMP_FRAME_LENGTH - 1] = 0xf7;
  return frame;
}

describe("encodeMessage", () => {
  it("frames every message in exactly six bytes", () => {
    for (const [address, value] of [
      [0, 0],
      [1, 1],
      [255, 16383],
      [40, 300],
    ]) {
      expect(encodeMessage(address, value)).toHaveLength(6);
    }
  });

  it("wraps the payload in F0 and F7", () => {
    const message = encodeMessage(0, 0);
    expect(Array.from(message)).toEqual([0xf0, 0, 0, 0, 0, 0xf7]);
  });

  it("splits address and value little-endian into 7-bit halves", () => {
    expect(Array.from(encodeMessage(200, 16383))).toEqual([
      0xf0, 72, 1, 127, 127, 0xf7,
    ]);
    expect(Array.from(encodeMessage(128, 128))).toEqual([
      0xf0, 0, 1, 0, 1, 0xf7,
    ]);
    expect(Array.from(encodeMessage(127, 127))).toEqual([
      0xf0, 127, 0, 127, 0, 0xf7,
    ]);
  });

  it("never emits a payload byte with the high bit set", () => {
    for (let address = 0; address <= MAX_ADDRESS; address += 1) {
      const value = (address * 61) % (MAX_VALUE + 1);
      const message = encodeMessage(address, value);
      for (const byte of message.slice(1, 5)) expect(byte).toBeLessThan(128);
    }
  });

  it("round-trips through the same decoding the device applies", () => {
    for (const [address, value] of [
      [0, 0],
      [7, 8],
      [219, 9999],
      [MAX_ADDRESS, MAX_VALUE],
    ]) {
      const m = encodeMessage(address, value);
      expect(m[1] + 128 * m[2]).toBe(address);
      expect(m[3] + 128 * m[4]).toBe(value);
    }
  });

  it("throws on an address or value out of range", () => {
    expect(() => encodeMessage(-1, 0)).toThrow(RangeError);
    expect(() => encodeMessage(MAX_ADDRESS + 1, 0)).toThrow(RangeError);
    expect(() => encodeMessage(0, -1)).toThrow(RangeError);
    expect(() => encodeMessage(0, MAX_VALUE + 1)).toThrow(RangeError);
  });

  it("throws on a non-integer address or value", () => {
    expect(() => encodeMessage(1.5, 0)).toThrow(TypeError);
    expect(() => encodeMessage(0, 1.5)).toThrow(TypeError);
    expect(() => encodeMessage(Number.NaN, 0)).toThrow(TypeError);
    expect(() => encodeMessage(0, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("decodeDumpFrame", () => {
  it("decodes 256 values as data[2i] + 128 * data[2i + 1]", () => {
    const values = Array.from({ length: PARAMETER_COUNT }, (_, i) => i * 61);
    expect(decodeDumpFrame(dumpFrame(values))).toEqual(values);
  });

  it("reads the full 0..16383 range back", () => {
    const values = Array.from({ length: PARAMETER_COUNT }, () => MAX_VALUE);
    expect(decodeDumpFrame(dumpFrame(values))).toEqual(values);
  });

  it("rejects any frame whose body is not 513 bytes long", () => {
    const good = dumpFrame(Array.from({ length: PARAMETER_COUNT }, () => 0));
    expect(decodeDumpFrame(good)).not.toBeNull();
    expect(decodeDumpFrame(good.slice(0, DUMP_FRAME_LENGTH - 1))).toBeNull();
    expect(decodeDumpFrame(Uint8Array.from([...good, 0]))).toBeNull();
    expect(
      decodeDumpFrame(Uint8Array.from([0xf0, 0, 0, 0, 0, 0xf7])),
    ).toBeNull();
    expect(decodeDumpFrame(new Uint8Array(0))).toBeNull();
  });

  it("rejects a frame that does not start with F0", () => {
    const frame = dumpFrame(Array.from({ length: PARAMETER_COUNT }, () => 0));
    frame[0] = 0x90;
    expect(decodeDumpFrame(frame)).toBeNull();
  });
});
