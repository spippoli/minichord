import { describe, expect, it } from "vitest";

import { byAddress } from "./parameters";
import {
  MAX_WIRE_VALUE,
  PRESET_CODE_VALUE_COUNT,
  decodePresetCode,
  encodePresetCode,
  presetWriteMap,
} from "./presetCode";

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

/**
 * The published "Ice Cream", byte for byte out of
 * `firmware/minicontrol/json/shared_presets.json`.
 *
 * It is here as itself rather than as a synthetic 255-value code because the
 * fact it stands for is a fact about the ecosystem, not about the parser: this
 * is the one published code in 43 that the legacy editor rejects and the
 * minishop loads (SPEC.md 11.1). A hand-rolled equivalent would still pass on
 * the day someone tightened the count back to 256.
 */
const ICE_CREAM =
  "MDswOzUwOzUwOzUxMjs1MTI7NTEyOzA7MDswOzE5NDsxMDA7OTI7MTAwOzYxOzEwMDs2MDsxMDA7MDswOzIwOTswOzA7MTsyMDsxMTswOzEyOzA7ODc7MDswOzk0OzA7MDswOzA7MDswOzA7MDsxODs2OzEwOzEwOTszMjQ7NTU7NzY2OzU7NDk4Ozc7OTA7MTM7MTg7NDsyNjs2OzE7ODA7MDszNjA7MTY7MDsxOTA7NDs3NjsxOTszNjsxMDA7Mjk7MTszMDsxNzsxNDsyMjsyMDswOzMwNDs4ODY7ODM7NDM7MDs3OzkwOzI5OzM2Ozk7MDsxODgwOzkwOzQwOzEwMDsxMDA7MDswOzA7MDsxMzA7MDsxOzQ7MDsyOzM1OzU1OzA7MTsxOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzI7MTA7ODsxMDA7MTA7MjsxMDA7NTs2OzUwOzY7NzA7NTA7NDA7MzA7ODsyNzs2OzE1OzMxOzY1OzQzMjsyOzI0MDQ7NjI7MTA4OzE5Ozg7MzI7ODA7MTsxOzA7MzA7MDswOzA7MTAwOzIzOzM7ODs2MDszOzk7MTsxOzE7MTAwOzE7MTsxMDA7MTsxOzE7MTsxODswOzA7NzA7MDswOzA7MTAwOzA7MzA7MTA7MDsxODA7MTY7NDsxMDA7MTEwOzIxMzk7MTAwOzg3OzUwOzY5OzEwMDsyOzUwOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDszOzQ7MzM7MDs1OzMyOzY1OzA7MTs0MDszOzY0OzQxOzA7Njc7NDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDswOzA7MDsw";

/** A code holding `count` fields, with or without the trailing separator. */
function codeOf(values: readonly number[], terminated = true): string {
  return btoa(`${values.join(";")}${terminated ? ";" : ""}`);
}

function accepted(code: string): readonly number[] {
  const reading = decodePresetCode(code);
  if (!reading.ok) expect.fail(`rejected: ${reading.rejection.kind}`);
  return reading.values;
}

function rejection(code: string) {
  const reading = decodePresetCode(code);
  if (reading.ok) expect.fail("accepted a code that should have been refused");
  return reading.rejection;
}

describe("the preset code, on read (SPEC.md 11.1)", () => {
  it("round-trips what it wrote", () => {
    const values = Array.from({ length: 256 }, (_, address) => address * 3);
    const back = accepted(encodePresetCode(values));

    for (let address = 0; address < PRESET_CODE_VALUE_COUNT; address += 1) {
      const written = byAddress.has(address) && address !== 7;
      expect(back[address]).toBe(written ? values[address] : 0);
    }
  });

  it("loads the published Ice Cream: 255 values and no terminator", () => {
    const values = accepted(ICE_CREAM);

    expect(values).toHaveLength(256);
    // `0;0;50;50;512;512;512;0`, the opening every published code shares.
    expect(values.slice(0, 8)).toEqual([0, 0, 50, 50, 512, 512, 512, 0]);
  });

  it("accepts 254, 255 and 256 values, terminated or not", () => {
    for (const count of [254, 255, 256]) {
      for (const terminated of [true, false]) {
        const fields = Array.from({ length: count }, (_, at) => at);
        expect(decodePresetCode(codeOf(fields, terminated)).ok).toBe(true);
      }
    }
  });

  it("pads what a short code does not carry, address 255 included", () => {
    const values = accepted(codeOf(Array.from({ length: 254 }, () => 7)));

    expect(values).toHaveLength(256);
    expect(values[253]).toBe(7);
    expect(values[254]).toBe(0);
    expect(values[255]).toBe(0);
  });

  it("reads base64 the ecosystem left unpadded", () => {
    // A quarter of the published codes have their `=` stripped. `atob` decodes
    // them, the legacy therefore loads them, and so does this.
    const code = codeOf(Array.from({ length: 255 }, () => 1));
    expect(decodePresetCode(code.replace(/=+$/, "")).ok).toBe(true);
  });

  it("ignores the whitespace a paste brings with it", () => {
    const code = codeOf(Array.from({ length: 255 }, () => 2));
    expect(decodePresetCode(`  ${code}\n`).ok).toBe(true);
  });
});

describe("validation rejects structure, never range (SPEC.md 11.2)", () => {
  it("refuses base64 it cannot decode", () => {
    expect(rejection("not a preset code!").kind).toBe("not-base64");
  });

  it("refuses a count outside 254–256, and says what it counted", () => {
    expect(rejection(codeOf(Array.from({ length: 253 }, () => 0)))).toEqual({
      kind: "value-count",
      count: 253,
    });
    expect(rejection(codeOf(Array.from({ length: 257 }, () => 0)))).toEqual({
      kind: "value-count",
      count: 257,
    });
  });

  it("counts the values, not the fields: the terminator is not one", () => {
    const fields = Array.from({ length: 253 }, () => 0);
    expect(rejection(codeOf(fields, true))).toEqual({
      kind: "value-count",
      count: 253,
    });
  });

  it("refuses a field that is not a whole number, at its address", () => {
    const fields: (number | string)[] = Array.from({ length: 255 }, () => 0);
    fields[106] = "1.5";
    expect(rejection(btoa(`${fields.join(";")};`))).toEqual({
      kind: "not-an-integer",
      index: 106,
    });
  });

  it("refuses an empty field, which the legacy would read as 0", () => {
    const fields: (number | string)[] = Array.from({ length: 255 }, () => 0);
    fields[40] = "";
    expect(rejection(btoa(`${fields.join(";")};`))).toEqual({
      kind: "not-an-integer",
      index: 40,
    });
  });

  it("refuses a value outside the wire range, at either end", () => {
    const high: (number | string)[] = Array.from({ length: 255 }, () => 0);
    high[40] = MAX_WIRE_VALUE + 1;
    expect(rejection(btoa(`${high.join(";")};`))).toEqual({
      kind: "out-of-range",
      index: 40,
    });

    const low: (number | string)[] = Array.from({ length: 255 }, () => 0);
    low[41] = -1;
    expect(rejection(btoa(`${low.join(";")};`))).toEqual({
      kind: "out-of-range",
      index: 41,
    });
  });

  it("accepts a value outside the parameter's declared minimum", () => {
    // 31 of the 43 published presets sit below their declared minimum on
    // addresses 106 and 107, where 0 means "MIDI channel off". Clamping would
    // switch on a channel the author switched off.
    const fields = Array.from({ length: 255 }, () => 0);
    const values = accepted(codeOf(fields));

    expect(byAddress.get(106)?.min).toBeGreaterThan(0);
    expect(values[106]).toBe(0);
    expect(values[107]).toBe(0);
  });

  it("accepts the top of the wire range", () => {
    const fields = Array.from({ length: 255 }, () => MAX_WIRE_VALUE);
    expect(accepted(codeOf(fields))[40]).toBe(MAX_WIRE_VALUE);
  });
});

describe("what an import writes (SPEC.md 11.3)", () => {
  const map = presetWriteMap(Array.from({ length: 256 }, (_, at) => at));

  it("writes only the addresses the manifest declares: 189, not 253", () => {
    expect(map.size).toBe(189);
    for (const address of map.keys()) expect(byAddress.has(address)).toBe(true);
  });

  it("never writes 1, 2–7 or 255", () => {
    for (const address of [1, 2, 3, 4, 5, 6, 7, 255]) {
      expect(map.has(address)).toBe(false);
    }
  });

  it("writes the bank hue like any other address", () => {
    // No control draws address 20, and the import is the manifest's set rather
    // than the panel's: a preset carries the hue it was designed with.
    expect(map.get(20)).toBe(20);
  });

  it("carries the value the code held, unaltered", () => {
    expect(map.get(40)).toBe(40);
    expect(map.get(235)).toBe(235);
  });
});
