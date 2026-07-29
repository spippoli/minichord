import { describe, expect, it } from "vitest";

import {
  RAW_SECTION_KEYS,
  rawParameterFile,
  sectionOfRawKey,
  type RawParameter,
} from "./rawParameters";

/**
 * A JSON import is inferred as `string`, never as a union, so every closed
 * domain declared in `RawParameter` is an assertion nothing else checks. This
 * suite is the check: it walks the real `firmware/generator/parameters.json`
 * and fails the moment the generator's output stops matching the hand-written
 * type.
 */

const RAW_KEYS = [
  "name",
  "group",
  "default_value",
  "data_type",
  "sysex_adress",
  "curve",
  "min_value",
  "max_value",
  "tooltip",
  "iterate",
  "method",
  "introduction_version",
] as const;

const allRawParameters: RawParameter[] = RAW_SECTION_KEYS.flatMap(
  (key) => rawParameterFile[key],
);

describe("the real parameters.json", () => {
  it("has exactly the three section keys", () => {
    expect(Object.keys(rawParameterFile).sort()).toEqual(
      [...RAW_SECTION_KEYS].sort(),
    );
  });

  it("declares 195 parameters", () => {
    expect(allRawParameters).toHaveLength(195);
  });

  it("gives every record exactly the twelve documented keys", () => {
    for (const raw of allRawParameters) {
      expect(Object.keys(raw).sort()).toEqual([...RAW_KEYS].sort());
    }
  });

  it("gives every field the declared primitive type", () => {
    for (const raw of allRawParameters) {
      expect(typeof raw.name).toBe("string");
      expect(typeof raw.group).toBe("string");
      expect(typeof raw.tooltip).toBe("string");
      expect(typeof raw.method).toBe("string");
      expect(Number.isFinite(raw.default_value)).toBe(true);
      expect(Number.isFinite(raw.min_value)).toBe(true);
      expect(Number.isFinite(raw.max_value)).toBe(true);
      expect(Number.isInteger(raw.sysex_adress)).toBe(true);
      expect(Number.isInteger(raw.iterate)).toBe(true);
      expect(Number.isInteger(raw.introduction_version)).toBe(true);
    }
  });

  it("keeps data_type and curve inside their closed domains", () => {
    for (const raw of allRawParameters) {
      expect(["int", "float"]).toContain(raw.data_type);
      expect(["linear", "exponential"]).toContain(raw.curve);
    }
  });

  it("keeps every address unique and inside 2..235", () => {
    const addresses = allRawParameters.map((raw) => raw.sysex_adress);
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(Math.min(...addresses)).toBe(2);
    expect(Math.max(...addresses)).toBe(235);
  });

  it("never declares a minimum above its maximum", () => {
    for (const raw of allRawParameters) {
      expect(raw.min_value).toBeLessThanOrEqual(raw.max_value);
    }
  });

  it("maps each section key to a section name", () => {
    expect(sectionOfRawKey("global_parameter")).toBe("global");
    expect(sectionOfRawKey("harp_parameter")).toBe("harp");
    expect(sectionOfRawKey("chord_parameter")).toBe("chord");
  });
});
