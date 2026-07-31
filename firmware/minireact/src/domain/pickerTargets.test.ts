import { describe, expect, it } from "vitest";

import { PICKER_RESTING_VALUE, pickerTargets } from "./pickerTargets";
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
