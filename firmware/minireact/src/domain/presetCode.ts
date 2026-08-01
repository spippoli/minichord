/**
 * The preset codec (SPEC.md 4.5), whose rules are SPEC.md 11.1.
 *
 * **Only the writing half is here.** A preset code is offered beside an armed
 * bank reset, as the escape hatch of SPEC.md 10.4 — the state about to be
 * destroyed, in one line the user can keep. Reading a code back is the preset
 * import, which is a different act with a validator and a bulk write behind it,
 * and it lands with the ticket that raises it.
 */

import { FIRMWARE_VERSION_ADDRESS } from "./addresses";
import { byAddress } from "./parameters";

/**
 * **255 values, not 256** (SPEC.md 11.1).
 *
 * The legacy's generator loops to 254, so address 255 never leaves; `split(";")`
 * then yields 255 values plus a trailing empty string, and *that* is what
 * satisfies its `length != 256` check. Writing 256 would produce a code the
 * legacy editor and the minishop both reject.
 */
export const PRESET_CODE_VALUE_COUNT = 255;

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
 * **The firmware version serialises as `0` too**, and it is the one declared
 * parameter that does. SPEC.md 11.1 says to write the format byte for byte, and
 * records what that produces: all 43 published codes begin
 * `0;0;50;50;512;512;512;0`. Sending the version the connected device happens
 * to report would make one sound produce two different codes on two devices —
 * the diffability the rule above exists for, given up on the one byte that says
 * nothing about a sound. It is inert on import either way, because the firmware
 * heals that address on every write (SPEC.md 1.5).
 *
 * The rest of the fiction of SPEC.md 5.4 does travel, because 2–6 are declared
 * parameters and the store holds the forced values there.
 *
 * The bank hue is declared, so it travels (SPEC.md 7.4).
 */
export function encodePresetCode(values: readonly number[]): string {
  const fields = Array.from(
    { length: PRESET_CODE_VALUE_COUNT },
    (_, address) =>
      byAddress.has(address) && address !== FIRMWARE_VERSION_ADDRESS
        ? values[address]
        : 0,
  );
  return btoa(`${fields.join(";")};`);
}
