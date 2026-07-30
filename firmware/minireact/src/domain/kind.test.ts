import { describe, expect, it } from "vitest";

import { byAddress, visibleParameters } from "./parameters";
import { kindOf, type ControlKind } from "./kind";

/** The counts of SPEC.md 8.1 — a checksum over the real file, not a listing. */
const EXPECTED: Readonly<Record<ControlKind, number>> = {
  toggle: 6,
  select: 14,
  stepper: 11,
  slider: 138,
  picker: 4,
  sequencer: 16,
};

function parameterAt(address: number) {
  const found = byAddress.get(address);
  if (!found) throw new Error(`no parameter at address ${address}`);
  return found;
}

describe("the taxonomy is a checksum (SPEC.md 8.1)", () => {
  it("sorts the 189 visible parameters into the counts the spec states", () => {
    const counts = new Map<ControlKind, number>();
    for (const each of visibleParameters) {
      const kind = kindOf(each);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }

    expect(Object.fromEntries(counts)).toEqual(EXPECTED);
    expect(visibleParameters).toHaveLength(
      Object.values(EXPECTED).reduce((total, count) => total + count, 0),
    );
  });
});

describe("the rules, in order, first match wins (SPEC.md 8.1)", () => {
  it("makes every rhythm address a sequencer", () => {
    expect(kindOf(parameterAt(220))).toBe("sequencer");
    expect(kindOf(parameterAt(235))).toBe("sequencer");
  });

  it("makes the four routing slots pickers", () => {
    for (const address of [10, 12, 14, 16]) {
      expect(kindOf(parameterAt(address))).toBe("picker");
    }
  });

  it("makes a named enumeration a menu", () => {
    // A waveform, the key signatures, the two shufflings.
    expect(kindOf(parameterAt(42))).toBe("select");
    expect(kindOf(parameterAt(35))).toBe("select");
    expect(kindOf(parameterAt(40))).toBe("select");
    expect(kindOf(parameterAt(120))).toBe("select");
  });

  it("makes a 0..1 integer a switch, not a two-position fader", () => {
    expect(kindOf(parameterAt(21))).toBe("toggle");
  });

  it("makes a small ordinal a stepper", () => {
    expect(kindOf(parameterAt(30))).toBe("stepper");
  });

  it("leaves the continuous majority to the fader", () => {
    expect(kindOf(parameterAt(24))).toBe("slider");
    // `bank color` keeps its kind: the spectrum in the slot is a rendering,
    // not a seventh kind (SPEC.md 8.5).
    expect(kindOf(parameterAt(20))).toBe("slider");
  });

  it("keeps a picker a picker, whatever its range says", () => {
    // Address 10 declares 21..219, which no other rule would touch — but the
    // order of the rules is what decides, not the range.
    expect(parameterAt(10).min).toBe(21);
    expect(kindOf(parameterAt(10))).toBe("picker");
  });
});
