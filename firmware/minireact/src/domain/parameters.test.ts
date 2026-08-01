import { describe, expect, it } from "vitest";

import {
  byAddress,
  isAvailable,
  parameters,
  visibleParameters,
} from "./parameters";

describe("the parameter list", () => {
  it("holds all 195 parameters", () => {
    expect(parameters).toHaveLength(195);
  });

  it("is in file order: global, then harp, then chord", () => {
    const sections = parameters.map((p) => p.section);
    expect(sections.indexOf("global")).toBe(0);
    expect(sections.lastIndexOf("global")).toBeLessThan(
      sections.indexOf("harp"),
    );
    expect(sections.lastIndexOf("harp")).toBeLessThan(
      sections.indexOf("chord"),
    );
    expect(sections.lastIndexOf("chord")).toBe(sections.length - 1);
    expect(sections.filter((s) => s === "global")).toHaveLength(31);
    expect(sections.filter((s) => s === "harp")).toHaveLength(67);
    expect(sections.filter((s) => s === "chord")).toHaveLength(97);
  });

  it("carries the normalised field names, and drops method and iterate", () => {
    const bankColor = byAddress.get(20);
    expect(bankColor).toEqual({
      name: "bank color",
      group: "Settings",
      section: "global",
      address: 20,
      dataType: "int",
      curve: "linear",
      min: 0,
      max: 360,
      defaultValue: 0,
      tooltip: "color of the preset",
      introducedIn: 2,
    });
  });
});

describe("the index by address", () => {
  it("is lossless: one entry per parameter", () => {
    expect(byAddress.size).toBe(parameters.length);
    for (const parameter of parameters) {
      expect(byAddress.get(parameter.address)).toBe(parameter);
    }
  });

  it("holds nothing outside 2..235", () => {
    for (const address of byAddress.keys()) {
      expect(address).toBeGreaterThanOrEqual(2);
      expect(address).toBeLessThanOrEqual(235);
    }
  });
});

describe("the visible list", () => {
  it("holds 188 entries", () => {
    expect(visibleParameters).toHaveLength(188);
  });

  it("drops the six hidden parameters, which live at addresses 2..7", () => {
    const hidden = parameters.filter((p) => p.group === "hidden");
    expect(hidden).toHaveLength(6);
    expect(hidden.map((p) => p.address).sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7,
    ]);
    expect(visibleParameters.some((p) => p.group === "hidden")).toBe(false);
  });

  it("drops the bank hue, which is read from the device and never edited", () => {
    expect(visibleParameters.some((p) => p.address === 20)).toBe(false);
    // And it is still a parameter: the strip reads its value by address.
    expect(byAddress.get(20)?.name).toBe("bank color");
  });

  it("preserves the order of the full list", () => {
    expect(visibleParameters).toEqual(
      parameters.filter((p) => p.group !== "hidden" && p.address !== 20),
    );
  });
});

describe("isAvailable", () => {
  const parameter = parameters.find((p) => p.introducedIn > 1);
  if (parameter === undefined) throw new Error("no versioned parameter");

  it("is true when the firmware is new enough", () => {
    expect(isAvailable(parameter, parameter.introducedIn)).toBe(true);
    expect(isAvailable(parameter, parameter.introducedIn + 1)).toBe(true);
  });

  it("is false on firmware older than the parameter", () => {
    expect(isAvailable(parameter, parameter.introducedIn - 1)).toBe(false);
  });
});
