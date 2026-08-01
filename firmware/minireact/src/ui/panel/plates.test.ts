import { describe, expect, it } from "vitest";

import { BANK_COLOR_ADDRESS, byAddress } from "../../domain";
import { matchesQuery, platesOf, sectionMatchCount } from "./plates";

/** The table of SPEC.md 7.2, verbatim: the plates in order, with their counts. */
const EXPECTED = {
  global: [
    ["Settings", 9],
    ["MIDI", 3],
    ["Effects", 6],
    ["Potentiometer", 8],
  ],
  harp: [
    ["General", 3],
    ["Oscillator", 2],
    ["Envelope", 6],
    ["Low pass filter", 10],
    ["Transient", 6],
    ["Tremolo", 3],
    ["Vibrato", 15],
    ["Effects", 11],
    ["Output filter", 10],
  ],
  chord: [
    ["General", 3],
    ["Oscillator", 16],
    ["Envelope", 6],
    ["Low pass filter", 13],
    ["Tremolo", 4],
    ["Vibrato", 16],
    ["Effects", 11],
    ["Rythm", 21],
    ["Output filter", 6],
  ],
} as const;

describe("the plates of a section (SPEC.md 7.2)", () => {
  for (const [section, expected] of Object.entries(EXPECTED)) {
    it(`draws the ${section} plates in the order and counts the spec states`, () => {
      const plates = platesOf(section as keyof typeof EXPECTED);

      expect(
        plates.map((plate) => [plate.group, plate.parameters.length]),
      ).toEqual(expected.map((each) => [...each]));
    });
  }

  it("merges the two blocks of the global Settings group into one plate", () => {
    // `group` is not contiguous in the file: Settings appears as 6 parameters,
    // then MIDI, then 4 more Settings. The legacy generator draws it twice.
    // One plate of 10 less the bank hue, which the panel never draws.
    const settings = platesOf("global").filter(
      (plate) => plate.group === "Settings",
    );

    expect(settings).toHaveLength(1);
    expect(settings[0].parameters).toHaveLength(9);
  });

  it("draws no control for the bank hue, in any section", () => {
    for (const section of ["global", "harp", "chord"] as const) {
      for (const plate of platesOf(section)) {
        expect(
          plate.parameters.some((each) => each.address === BANK_COLOR_ADDRESS),
        ).toBe(false);
      }
    }
  });

  it("finds no bank hue in a search either", () => {
    // The parameter is not drawn, so no query may surface it — search runs
    // over the plates, which is what makes that true for free.
    expect(sectionMatchCount("global", "bank color")).toBe(0);
  });

  it("never shows the hidden group", () => {
    for (const section of ["global", "harp", "chord"] as const) {
      for (const plate of platesOf(section)) {
        expect(plate.group).not.toBe("hidden");
      }
    }
  });

  it("keeps the rhythm masks in their plate, where the grid will draw them", () => {
    const rythm = platesOf("chord").find((plate) => plate.group === "Rythm");
    const masks = rythm?.parameters.filter((each) => each.address >= 220);

    expect(masks).toHaveLength(16);
  });
});

describe("search (SPEC.md 7.3)", () => {
  const attack = byAddress.get(45)!;

  it("matches the name, the group, the tooltip and the raw address", () => {
    expect(matchesQuery(attack, attack.name.slice(0, 3))).toBe(true);
    expect(matchesQuery(attack, attack.group)).toBe(true);
    expect(matchesQuery(attack, attack.tooltip.split(" ")[1])).toBe(true);
    expect(matchesQuery(attack, "45")).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(matchesQuery(attack, `  ${attack.name.toUpperCase()} `)).toBe(true);
  });

  it("matches nothing at all when nothing is being searched for", () => {
    // An empty query is not a search: the section is browsed, not filtered,
    // and no tab lights with a count.
    expect(matchesQuery(attack, "")).toBe(false);
    expect(sectionMatchCount("harp", "   ")).toBe(0);
  });

  it("counts a section's own matches, which is what lights the other tabs", () => {
    expect(sectionMatchCount("harp", "vibrato")).toBeGreaterThan(0);
    expect(sectionMatchCount("global", "vibrato")).toBe(0);
    expect(sectionMatchCount("chord", "zzz")).toBe(0);
  });
});
