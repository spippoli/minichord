import { describe, expect, it } from "vitest";

import { byAddress } from "./parameters";
import { PRESET_CODE_VALUE_COUNT, encodePresetCode } from "./presetCode";

/** A store where every value is its own address, so an address names itself. */
function identityStore(): number[] {
  return Array.from({ length: 256 }, (_, address) => address);
}

function fieldsOf(values: readonly number[]): string[] {
  return atob(encodePresetCode(values)).split(";");
}

describe("the preset code, on write (SPEC.md 11.1)", () => {
  it("writes 255 values and the trailing separator", () => {
    const fields = fieldsOf(identityStore());

    // 255 values plus the empty string after the terminator: exactly what the
    // legacy's `length != 256` check is satisfied by.
    expect(fields).toHaveLength(PRESET_CODE_VALUE_COUNT + 1);
    expect(fields.at(-1)).toBe("");
  });

  it("stops at address 254: address 255 never leaves", () => {
    const values = identityStore();
    values[254] = 254;
    expect(fieldsOf(values)).not.toContain("255");
  });

  it("serialises the addresses no parameter claims as 0", () => {
    const fields = fieldsOf(identityStore());

    // The bank id among them: the code *is* a bank, so which bank it came out
    // of is not part of it, and every published code begins `0;0;`.
    expect(fields.slice(0, 2)).toEqual(["0", "0"]);
    for (let address = 0; address < PRESET_CODE_VALUE_COUNT; address += 1) {
      if (byAddress.has(address)) continue;
      expect(fields[address]).toBe("0");
    }
  });

  it("carries the fiction of the five knobs, as every published code does", () => {
    const values = identityStore();
    values[2] = 50;
    values[3] = 50;
    values[4] = 512;
    values[5] = 512;
    values[6] = 512;

    // `0;0;50;50;512;512;512;0` is how all 43 published codes begin.
    expect(fieldsOf(values).slice(0, 8).join(";")).toBe(
      "0;0;50;50;512;512;512;0",
    );
  });

  it("writes the firmware version as 0, whatever the device reports", () => {
    // The one declared parameter held back: the same sound has to produce the
    // same code on a device running 8 and on one running 15, or the code stops
    // being diffable against the published ones over the byte that says least.
    const eight = identityStore();
    eight[7] = 8;
    const fifteen = identityStore();
    fifteen[7] = 15;

    expect(fieldsOf(eight)[7]).toBe("0");
    expect(encodePresetCode(eight)).toBe(encodePresetCode(fifteen));
  });

  it("carries the raw wire value of every declared parameter, the hue included", () => {
    const values = identityStore();
    values[20] = 220;
    values[40] = 3;

    const fields = fieldsOf(values);
    expect(fields[20]).toBe("220");
    expect(fields[40]).toBe("3");
  });

  it("is base64 of exactly that, byte for byte", () => {
    const values = Array.from({ length: 256 }, () => 0);
    const expected = `${Array.from({ length: PRESET_CODE_VALUE_COUNT }, () => "0").join(";")};`;
    expect(encodePresetCode(values)).toBe(btoa(expected));
  });
});
