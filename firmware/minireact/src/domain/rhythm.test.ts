import { describe, expect, it } from "vitest";

import {
  RHYTHM_FIRST_ADDRESS,
  RHYTHM_LAST_ADDRESS,
  RHYTHM_NOTE_COUNT,
  RHYTHM_STEP_COUNT,
  decodeRhythmMask,
  encodeRhythmMask,
  isRhythmAddress,
  rhythmStepAddress,
  rhythmStepOfAddress,
  withRhythmNote,
} from "./rhythm";

describe("the rhythm address range", () => {
  it("spans 220..235, one address per sequencer step", () => {
    expect(RHYTHM_FIRST_ADDRESS).toBe(220);
    expect(RHYTHM_LAST_ADDRESS).toBe(235);
    expect(RHYTHM_STEP_COUNT).toBe(16);
    expect(RHYTHM_NOTE_COUNT).toBe(7);
  });

  it("recognises its own addresses and nothing else", () => {
    expect(isRhythmAddress(219)).toBe(false);
    expect(isRhythmAddress(220)).toBe(true);
    expect(isRhythmAddress(235)).toBe(true);
    expect(isRhythmAddress(236)).toBe(false);
  });

  it("maps a step column onto its address, and back", () => {
    expect(rhythmStepAddress(0)).toBe(220);
    expect(rhythmStepAddress(15)).toBe(235);
    expect(rhythmStepOfAddress(220)).toBe(0);
    expect(rhythmStepOfAddress(235)).toBe(15);
    expect(rhythmStepOfAddress(219)).toBeNull();
    for (let step = 0; step < RHYTHM_STEP_COUNT; step += 1) {
      expect(rhythmStepOfAddress(rhythmStepAddress(step))).toBe(step);
    }
  });

  it("refuses a step outside 0..15", () => {
    expect(() => rhythmStepAddress(-1)).toThrow();
    expect(() => rhythmStepAddress(16)).toThrow();
  });
});

describe("decodeRhythmMask", () => {
  it("returns seven notes, bit k being note k + 1", () => {
    expect(decodeRhythmMask(0)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(decodeRhythmMask(1)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(decodeRhythmMask(0b1000000)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(decodeRhythmMask(0b0010101)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it("ignores bits above the seventh, which the declared max_value of 128 permits", () => {
    expect(decodeRhythmMask(128)).toEqual(decodeRhythmMask(0));
    expect(decodeRhythmMask(129)).toEqual(decodeRhythmMask(1));
  });
});

describe("encodeRhythmMask", () => {
  it("packs seven notes into a 7-bit mask", () => {
    expect(
      encodeRhythmMask([false, false, false, false, false, false, false]),
    ).toBe(0);
    expect(
      encodeRhythmMask([true, false, false, false, false, false, false]),
    ).toBe(1);
    expect(encodeRhythmMask([true, true, true, true, true, true, true])).toBe(
      127,
    );
  });

  it("refuses a note array of the wrong length", () => {
    expect(() => encodeRhythmMask([true])).toThrow();
  });

  it("round-trips every mask in 0..127", () => {
    for (let mask = 0; mask < 128; mask += 1) {
      expect(encodeRhythmMask(decodeRhythmMask(mask))).toBe(mask);
    }
  });
});

describe("withRhythmNote", () => {
  it("sets and clears one bit, leaving the others alone", () => {
    expect(withRhythmNote(0, 0, true)).toBe(1);
    expect(withRhythmNote(0b0000101, 1, true)).toBe(0b0000111);
    expect(withRhythmNote(0b0000111, 1, false)).toBe(0b0000101);
    expect(withRhythmNote(0b0000101, 0, false)).toBe(0b0000100);
  });

  it("is idempotent", () => {
    expect(withRhythmNote(withRhythmNote(0, 3, true), 3, true)).toBe(0b0001000);
  });

  it("refuses a note outside 0..6", () => {
    expect(() => withRhythmNote(0, -1, true)).toThrow();
    expect(() => withRhythmNote(0, 7, true)).toThrow();
  });
});
