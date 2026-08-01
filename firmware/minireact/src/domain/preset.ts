/**
 * The preset codec (SPEC.md 4.5), whose rules are SPEC.md 11.1.
 *
 * **Only the writing half is here.** A preset code is offered beside an armed
 * bank reset, as the escape hatch of SPEC.md 10.4 — the state about to be
 * destroyed, in one line the user can keep. Reading a code back is the preset
 * import, which is a different act with a validator and a bulk write behind it,
 * and it lands with the ticket that raises it.
 */

/**
 * **255 values, not 256** (SPEC.md 11.1).
 *
 * The legacy's generator loops to 254, so address 255 never leaves; `split(";")`
 * then yields 255 values plus a trailing empty string, and *that* is what
 * satisfies its `length != 256` check. Writing 256 would produce a code the
 * legacy editor and the minishop both reject.
 */
export const PRESET_VALUE_COUNT = 255;

/**
 * The store, as the code every other tool in this ecosystem can read.
 *
 * Frozen on write, byte for byte: `v0;…;v254;`, base64. The values are the raw
 * wire integers, which is what the format holds — the /100 of a float and the
 * exponential curve are the display's business (SPEC.md 4.3), and a code that
 * carried decoded values would be unreadable to the legacy editor.
 *
 * Nothing is excluded, not the bank id and not the bank hue: a preset code is a
 * bank, and the hue is the bank's identity (SPEC.md 7.4).
 */
export function encodePreset(values: readonly number[]): string {
  const fields = values.slice(0, PRESET_VALUE_COUNT);
  return btoa(`${fields.join(";")};`);
}
