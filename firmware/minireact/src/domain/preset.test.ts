import { describe, expect, it } from "vitest";

import { PARAMETER_COUNT } from "../transport";
import { PRESET_VALUE_COUNT, encodePreset } from "./preset";

/** A store where every value is its own address, so a slot names itself. */
function identityStore(): number[] {
  return Array.from({ length: PARAMETER_COUNT }, (_, address) => address);
}

function decode(code: string): string {
  return atob(code);
}

describe("the preset code, on write (SPEC.md 11.1)", () => {
  it("writes 255 values and the trailing separator", () => {
    const body = decode(encodePreset(identityStore()));
    const fields = body.split(";");

    // 255 values plus the empty string after the terminator: exactly what the
    // legacy's `length != 256` check is satisfied by.
    expect(fields).toHaveLength(PRESET_VALUE_COUNT + 1);
    expect(fields.at(-1)).toBe("");
    expect(body.startsWith("0;1;2;")).toBe(true);
  });

  it("stops at address 254: address 255 never leaves", () => {
    const fields = decode(encodePreset(identityStore())).split(";");
    expect(fields[PRESET_VALUE_COUNT - 1]).toBe("254");
    expect(fields).not.toContain("255");
  });

  it("carries the raw wire values, the bank hue included", () => {
    const values = identityStore();
    values[20] = 220;
    values[1] = 6;

    const fields = decode(encodePreset(values)).split(";");
    expect(fields[20]).toBe("220");
    expect(fields[1]).toBe("6");
  });

  it("is base64 of exactly that, byte for byte", () => {
    const values = Array.from({ length: PARAMETER_COUNT }, () => 0);
    const expected = `${Array.from({ length: PRESET_VALUE_COUNT }, () => "0").join(";")};`;
    expect(encodePreset(values)).toBe(btoa(expected));
  });
});
