/**
 * The preset codec (SPEC.md 4.5), whose rules are SPEC.md 11.1.
 *
 * **Only the writing half is here.** A preset code is offered beside an armed
 * bank reset, as the escape hatch of SPEC.md 10.4 — the state about to be
 * destroyed, in one line the user can keep. Reading a code back is the preset
 * import, which is a different act with a validator and a bulk write behind it,
 * and it lands with the ticket that raises it.
 */

import { byAddress } from "./parameters";

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
 * **Addresses no parameter claims serialise as `0`**, exactly as the legacy
 * does (SPEC.md 11.1): the same sound then produces the same code, comparable
 * and diffable against published ones, and no undeclared device state leaks
 * into a public string. That covers the bank id at address 1, which is why
 * every published code begins `0;0;` — the code *is* a bank, so which bank it
 * came out of is not part of it.
 *
 * The fiction of SPEC.md 5.4 does travel, because 2–7 are declared parameters
 * and the store holds values there: published codes begin
 * `0;0;50;50;512;512;512;0`, which is the fiction exactly. Only byte 7 differs
 * — we send the firmware version the device reported rather than the legacy's
 * 0 — and it is inert whatever it says, because the firmware heals that slot on
 * every write (SPEC.md 1.5).
 *
 * The bank hue is declared, so it travels (SPEC.md 7.4).
 */
export function encodePreset(values: readonly number[]): string {
  const fields = Array.from({ length: PRESET_VALUE_COUNT }, (_, address) =>
    byAddress.has(address) ? values[address] : 0,
  );
  return btoa(`${fields.join(";")};`);
}
