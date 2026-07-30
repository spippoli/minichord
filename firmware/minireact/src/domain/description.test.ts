import { describe, expect, it } from "vitest";

import { describeParameter, RESTING_LINE } from "./description";
import { byAddress } from "./parameters";

const CURRENT_FIRMWARE = 8;

function parameter(address: number) {
  const found = byAddress.get(address);
  if (!found) throw new Error(`no parameter at ${address}`);
  return found;
}

/** `chord key signature`, the menu that arrived in firmware 6. */
const NEWER = parameter(35);
/** `reverb size`, an ordinary fader that has always been there. */
const FADER = parameter(24);

function describe_(address: number, firmwareVersion = CURRENT_FIRMWARE) {
  return describeParameter(parameter(address), { firmwareVersion });
}

describe("the where-line (SPEC.md A.4)", () => {
  it("is section, group, name, then the raw address", () => {
    expect(describe_(24).where).toBe(
      "Global / Effects / reverb size — address 24",
    );
  });

  it("names the section a tab names it", () => {
    expect(describe_(40).where).toBe(
      "Harp / General / harp shuffling — address 40",
    );
    expect(describe_(120).where).toBe(
      "Chord / General / chord shuffling — address 120",
    );
  });
});

describe("the readout's two lines (SPEC.md A.4)", () => {
  it("carries the parameter's own tooltip, untouched", () => {
    expect(describe_(24).tooltip).toBe(FADER.tooltip);
  });

  it("appends the note of the kind, derived and not passed in", () => {
    expect(describe_(24).note).toBe(
      "drag, use the arrow keys, or press Enter to type the value",
    );
    expect(describe_(21).note).toBe("on / off");
    expect(describe_(35).note).toBe("pick a value by name");
    expect(describe_(30).note).toBe(
      "the arrow keys step the value; Enter types it",
    );
    expect(describe_(10).note).toBe("points at another parameter");
    expect(describe_(220).note).toBe("one step of the pattern");
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
    expect(describe_(24).sentence).toBe(`${FADER.tooltip}.`);
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
    const sentence = describe_(24).sentence;
    expect(sentence).not.toContain("Global");
    expect(sentence).not.toContain("Effects");
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
