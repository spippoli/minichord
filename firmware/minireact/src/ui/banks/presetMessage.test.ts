import { describe, expect, it } from "vitest";

import { decodePresetCode } from "../../domain";
import { presetRejectionMessage } from "./presetMessage";

/** The message a real refusal of `code` produces, end to end. */
function refusing(code: string): string {
  const reading = decodePresetCode(code);
  if (reading.ok) expect.fail("the codec accepted that code");
  return presetRejectionMessage(reading.rejection);
}

function codeOf(fields: readonly (number | string)[]): string {
  return btoa(`${fields.join(";")};`);
}

describe("what a refused paste says (SPEC.md 11.2, A.7)", () => {
  it("says a paste that is not a code at all is not one", () => {
    expect(refusing("hello world!")).toBe("That is not a preset code.");
  });

  it("says how many values it counted", () => {
    const short = Array.from({ length: 100 }, () => 0);
    expect(refusing(codeOf(short))).toBe(
      "A preset code holds 255 values; this one holds 100.",
    );
  });

  it("names the value that is not a whole number", () => {
    const fields: (number | string)[] = Array.from({ length: 255 }, () => 0);
    fields[131] = "4.5";
    expect(refusing(codeOf(fields))).toBe("Value 131 is not a whole number.");
  });

  it("names the value the wire cannot carry", () => {
    const fields: (number | string)[] = Array.from({ length: 255 }, () => 0);
    fields[212] = 99999;
    expect(refusing(codeOf(fields))).toBe(
      "Value 212 is outside the range the minichord accepts.",
    );
  });

  it("has nothing to say about a value below a declared minimum", () => {
    // There is no message for it because there is no refusal: 31 of the 43
    // published presets sit below their own minimum at 106/107 (SPEC.md 11.2).
    const fields = Array.from({ length: 255 }, () => 0);
    expect(decodePresetCode(codeOf(fields)).ok).toBe(true);
  });
});
