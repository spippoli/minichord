import { describe, expect, it } from "vitest";

import {
  PICKER_RESTING_VALUE,
  pickerTargets,
  stepPickerTarget,
} from "./pickerTargets";
import { byAddress } from "./parameters";

describe("what a potentiometer can be pointed at (SPEC.md 8.4)", () => {
  it("lists every visible parameter in 21..219, in address order", () => {
    const addresses = pickerTargets.map((each) => each.address);

    expect(addresses).toEqual([...addresses].sort((a, b) => a - b));
    expect(Math.min(...addresses)).toBeGreaterThanOrEqual(21);
    expect(Math.max(...addresses)).toBeLessThanOrEqual(219);
  });

  it("leaves out the rhythm masks and the four routing slots themselves", () => {
    const addresses = new Set(pickerTargets.map((each) => each.address));

    for (const address of [10, 12, 14, 16, 20, 220, 235]) {
      expect(addresses.has(address)).toBe(false);
    }
  });

  it("carries the names a picker lists, not the addresses", () => {
    const transpose = pickerTargets.find((each) => each.address === 30);

    expect(transpose?.name).toBe("transpose");
  });

  it("rests on a value its own declared range excludes", () => {
    // The four slots declare 21..219 and default to 0. Nothing here clamps it
    // into range: that would invent a target they do not point at.
    expect(PICKER_RESTING_VALUE).toBe(0);
    for (const address of [10, 12, 14, 16]) {
      const slot = byAddress.get(address);
      expect(slot?.defaultValue).toBe(PICKER_RESTING_VALUE);
      expect(slot?.min).toBe(21);
    }
  });
});

describe("stepping a routing slot by the arrow keys (SPEC.md 8.4, 12.2)", () => {
  const first = pickerTargets[0].address;
  const second = pickerTargets[1].address;
  const last = pickerTargets.at(-1)!.address;

  it("steps to the next target, not to the next number", () => {
    expect(stepPickerTarget(PICKER_RESTING_VALUE, 1)).toBe(first);
    expect(stepPickerTarget(first, 1)).toBe(second);
  });

  it("keeps `none` reachable by keyboard", () => {
    // The ordinary nudge would clamp into the declared 21..219 and leave the
    // resting value a thing only a mouse can choose.
    expect(stepPickerTarget(first, -1)).toBe(PICKER_RESTING_VALUE);
    expect(stepPickerTarget(PICKER_RESTING_VALUE, -1)).toBe(
      PICKER_RESTING_VALUE,
    );
  });

  it("stops at the ends rather than wrapping", () => {
    expect(stepPickerTarget(last, 1)).toBe(last);
    expect(stepPickerTarget(PICKER_RESTING_VALUE, 10_000)).toBe(last);
  });

  it("steps a value the manifest does not know from rest", () => {
    expect(stepPickerTarget(999, 1)).toBe(first);
  });
});
