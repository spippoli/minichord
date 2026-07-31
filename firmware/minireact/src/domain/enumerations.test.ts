import { describe, expect, it } from "vitest";

import { ENUMERATIONS, labelsOf } from "./enumerations";
import { byAddress, visibleParameters } from "./parameters";

/**
 * The addresses carrying the twelve waveforms, read back out of the table
 * rather than restated: a copy of the list here would make the assertion below
 * agree with itself and fail on nothing.
 */
const waveformAddresses = [...ENUMERATIONS]
  .filter(([, labels]) => labels[0] === "sine")
  .map(([address]) => address);

describe("the named enumerations (SPEC.md 8.6, A.8)", () => {
  it("names exactly fourteen addresses", () => {
    expect(ENUMERATIONS.size).toBe(14);
  });

  it("gives every enumerated address one label per declared value", () => {
    for (const [address, labels] of ENUMERATIONS) {
      const parameter = byAddress.get(address);
      expect(parameter, `no parameter at address ${address}`).toBeDefined();
      expect(parameter!.min).toBe(0);
      expect(labels).toHaveLength(parameter!.max + 1);
    }
  });

  it("labels the twelve waveforms in wire order, at all eleven addresses", () => {
    // SPEC.md 8.6: eleven of the fourteen carry a waveform.
    expect(waveformAddresses).toHaveLength(11);

    for (const address of waveformAddresses) {
      expect(labelsOf(address)?.[0]).toBe("sine");
      expect(labelsOf(address)?.[4]).toBe("bandlimited pulse");
      expect(labelsOf(address)?.[11]).toBe("bandlimited square");
      // Every one of them is a parameter whose own tooltip says "waveform".
      expect(byAddress.get(address)?.tooltip).toContain("waveform");
    }
  });

  it("labels the key signatures as the circle of fifths, sharps then flats", () => {
    expect(labelsOf(35)).toEqual([
      "C",
      "G",
      "D",
      "A",
      "E",
      "B",
      "F",
      "B♭",
      "E♭",
      "A♭",
      "D♭",
      "G♭",
    ]);
  });

  it("labels the seven harp shufflings and the six chord ones", () => {
    expect(labelsOf(40)?.[0]).toBe("triad, three octaves");
    expect(labelsOf(40)?.[6]).toBe("keymaster / barry harris");
    expect(labelsOf(120)?.[0]).toBe("normal");
    expect(labelsOf(120)?.[5]).toBe("two octaves up");
  });

  it("has nothing to say about an address that carries a quantity", () => {
    expect(labelsOf(24)).toBeUndefined();
  });

  it("only ever names a parameter the panel draws", () => {
    const drawn = new Set(visibleParameters.map((each) => each.address));
    for (const address of ENUMERATIONS.keys()) expect(drawn).toContain(address);
  });
});
