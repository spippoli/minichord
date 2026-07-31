import { describe, expect, it } from "vitest";

import { describeParameter, RESTING_LINE } from "./description";
import { byAddress } from "./parameters";

const CURRENT_FIRMWARE = 8;

function parameterAt(address: number) {
  const found = byAddress.get(address);
  if (!found) throw new Error(`no parameter at address ${address}`);
  return found;
}

/** `chord key signature`, the menu that arrived in firmware 6. */
const NEWER = parameterAt(35);
/** `reverb size`, an ordinary fader that has always been there. */
const FADER = parameterAt(24);

function descriptionAt(address: number, firmwareVersion = CURRENT_FIRMWARE) {
  return describeParameter(parameterAt(address), { firmwareVersion });
}

describe("the where-line (SPEC.md A.4)", () => {
  it("is section, group, name, then the raw address", () => {
    expect(descriptionAt(24).where).toBe(
      "Global / Effects / reverb size — address 24",
    );
  });

  it("says the step and the note of a sequencer cell (SPEC.md A.4)", () => {
    // A column *is* a parameter and a cell is a bit, so the address alone does
    // not say what is under the hand (SPEC.md 6.1, invariant 3).
    expect(
      describeParameter(parameterAt(223), {
        firmwareVersion: CURRENT_FIRMWARE,
        cell: { step: 4, note: 2, outOfCycle: false },
      }).where,
    ).toBe("Chord / Rythm / rythm pattern — address 223 — step 4, note 2");
  });

  it("marks a step the firmware never reaches (SPEC.md A.6)", () => {
    expect(
      describeParameter(parameterAt(235), {
        firmwareVersion: CURRENT_FIRMWARE,
        cell: { step: 16, note: 7, outOfCycle: true },
      }).where,
    ).toBe(
      "Chord / Rythm / rythm pattern — address 235 — step 16, note 7, out of cycle",
    );
  });

  it("names the section a tab names it", () => {
    expect(descriptionAt(40).where).toBe(
      "Harp / General / harp shuffling — address 40",
    );
    expect(descriptionAt(120).where).toBe(
      "Chord / General / chord shuffling — address 120",
    );
  });
});

describe("the readout's two lines (SPEC.md A.4)", () => {
  it("carries the parameter's own tooltip, untouched", () => {
    expect(descriptionAt(24).tooltip).toBe(FADER.tooltip);
  });

  it("appends the note of the kind, derived and not passed in", () => {
    expect(descriptionAt(24).note).toBe(
      "drag, use the arrow keys, or press Enter to type the value",
    );
    expect(descriptionAt(21).note).toBe("on / off");
    expect(descriptionAt(35).note).toBe("pick a value by name");
    expect(descriptionAt(30).note).toBe(
      "the arrow keys step the value; Enter types it",
    );
    expect(descriptionAt(10).note).toBe("points at another parameter");
    expect(descriptionAt(220).note).toBe("one step of the pattern");
  });

  it("replaces the note on an unequipped slot, and says which firmware", () => {
    const description = describeParameter(NEWER, { firmwareVersion: 5 });
    expect(description.unequipped).toBe(true);
    expect(description.note).toBe(
      "Not on this device. This parameter arrived in firmware 6; the minichord you are connected to is older, so the slot is empty rather than editable.",
    );
  });

  it("equips the slot as soon as the firmware is new enough", () => {
    expect(describeParameter(NEWER, { firmwareVersion: 6 }).unequipped).toBe(
      false,
    );
  });

  it("says what to do when nothing is under the hand", () => {
    expect(RESTING_LINE).toBe(
      "Point at a control, or tab to one, and it explains itself here.",
    );
  });
});

describe("the one sentence a screen reader hears (SPEC.md A.5)", () => {
  it("is the tooltip alone when there is nothing else to say", () => {
    expect(descriptionAt(24).sentence).toBe(`${FADER.tooltip}.`);
  });

  it("puts the unequipped explanation in front of the tooltip", () => {
    expect(describeParameter(NEWER, { firmwareVersion: 5 }).sentence).toBe(
      "Not on this device: this parameter arrived in firmware 6 and the connected minichord is older. " +
        `${NEWER.tooltip}.`,
    );
  });

  it("appends the two state LEDs, in the order of the appendix", () => {
    expect(
      describeParameter(FADER, {
        firmwareVersion: CURRENT_FIRMWARE,
        changedFromStoredBank: true,
        differsFromDefault: true,
      }).sentence,
    ).toBe(
      `${FADER.tooltip}. changed from the stored bank. differs from the factory default.`,
    );
  });

  it("carries neither the section nor the group: the plate announces them", () => {
    const sentence = descriptionAt(24).sentence;
    expect(sentence).not.toContain("Global");
    expect(sentence).not.toContain("Effects");
  });

  it("opens with the cell, when the control is one (SPEC.md A.5)", () => {
    expect(
      describeParameter(parameterAt(223), {
        firmwareVersion: CURRENT_FIRMWARE,
        cell: { step: 4, note: 2, outOfCycle: false },
      }).sentence,
    ).toBe(`step 4, note 2. ${parameterAt(223).tooltip}.`);
  });

  it("never doubles a full stop on a tooltip that carries its own", () => {
    // Eleven of the 195 tooltips end in a full stop.
    const withStop = describeParameter(
      { ...FADER, tooltip: "a sentence that ends itself." },
      { firmwareVersion: CURRENT_FIRMWARE },
    );
    expect(withStop.sentence).toBe("a sentence that ends itself.");
  });
});
