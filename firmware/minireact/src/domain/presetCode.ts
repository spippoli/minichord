/**
 * The preset codec (SPEC.md 4.5), whose rules are SPEC.md 11.1.
 *
 * **Frozen on write, lenient on read**, and the asymmetry is the whole design:
 * what leaves has to be readable by the legacy editor and the minishop, so it
 * is written byte for byte; what arrives was written by one of two parsers of
 * one format with different strictness, so it is read as generously as the
 * looser of them.
 *
 * The module is pure and says nothing about the wire: it turns a store into a
 * string, a string into 256 values or a reason, and a set of values into the
 * map an import hands to the bulk write. Sending that map, waiting for the
 * dump and counting what did not land are `state/`'s.
 */

import { BANK_ADDRESS, FIRMWARE_VERSION_ADDRESS } from "./addresses";
import { HIDDEN_GROUP, byAddress } from "./parameters";

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

/**
 * The full width of the store, which a decoded code is padded out to.
 *
 * `transport/` declares the same number and this layer may not import it (the
 * dependency rule of SPEC.md 2.1 runs the other way). It is 256 here because
 * that is the length of the array the store holds, and there it is the length
 * of a dump frame; the two agree because they describe the same device.
 */
const STORE_SIZE = 256;

/**
 * The largest value the wire can carry: two 7-bit halves (SPEC.md 1.1).
 *
 * The bound SPEC.md 11.2 rejects on is the bound `transport/` throws on, and
 * this is the second copy of it for the same reason as above. A value past it
 * is not a preset that will sound wrong — it is a frame that cannot be built,
 * so the validator refuses the code rather than letting the transport throw
 * 189 times.
 */
export const MAX_WIRE_VALUE = 16383;

/**
 * Why a code was refused. **Structure only** (SPEC.md 11.2): a value outside a
 * parameter's declared `min_value`/`max_value` is not here and never will be.
 *
 * Data rather than a sentence, like every other thing the pure layers say about
 * something a human will read: the wording of Appendix A.7 is `ui/`'s, and the
 * index each of these carries is the address the field would have been written
 * to, which is what makes the message worth reading.
 */
export type PresetCodeRejection =
  /** `atob` could not read it. Usually not a preset code at all. */
  | { readonly kind: "not-base64" }
  /** Outside 254–256. `count` excludes the optional trailing separator. */
  | { readonly kind: "value-count"; readonly count: number }
  /** A field that is not a whole number — the empty one included. */
  | { readonly kind: "not-an-integer"; readonly index: number }
  /** A whole number the wire cannot carry. */
  | { readonly kind: "out-of-range"; readonly index: number };

/** A code read, or the one structural reason it could not be. */
export type PresetCodeReading =
  /** `STORE_SIZE` values, short codes padded with 0 as the legacy pads them. */
  | { readonly ok: true; readonly values: readonly number[] }
  | { readonly ok: false; readonly rejection: PresetCodeRejection };

/**
 * The smallest number of values a code may carry (SPEC.md 11.1).
 *
 * The window is 254–256 and not 255, because the ecosystem published codes at
 * both edges of its own format: the legacy editor demands exactly 256 elements
 * — 255 values and the empty string after the terminator — the minishop is
 * lenient, and the curated **"Ice Cream"** has 255 values and no terminator, so
 * it loads from the minishop and is rejected by the editor as malformed. One
 * published code in 43 is unreadable by the tool meant to read it. Leniency
 * admits it, and costs nothing: the addresses a short code does not reach are
 * padded with the 0 the legacy would have read there anyway.
 */
const MIN_VALUE_COUNT = PRESET_CODE_VALUE_COUNT - 1;
const MAX_VALUE_COUNT = PRESET_CODE_VALUE_COUNT + 1;

/** Only `-`-less digits: `Number` alone would take `" 12"`, `1e3` and `""`. */
const WHOLE_NUMBER = /^-?\d+$/;

/**
 * A pasted code back into 256 raw wire values, or the reason it is not one.
 *
 * Whitespace goes first: a code arrives through a clipboard, out of a chat
 * message or an email, and a trailing newline is not a malformed preset.
 * Unpadded base64 is read too, because a quarter of the published codes have
 * their `=` stripped and `atob` has always taken them.
 *
 * **Nothing here looks at what a parameter declares.** The four refusals are
 * the four in SPEC.md 11.2 and they are all structural: 31 of the 43 published
 * presets sit below their own declared minimum on addresses 106/107, where 0
 * means "MIDI channel off", so a validator with an opinion about range would
 * reject most of the library and a clamp would silently switch on a channel the
 * author had switched off.
 */
export function decodePresetCode(code: string): PresetCodeReading {
  let plain: string;
  try {
    plain = atob(code.trim());
  } catch {
    return { ok: false, rejection: { kind: "not-base64" } };
  }

  const fields = plain.split(";");
  // The terminator is a separator with nothing after it, not a value. Dropping
  // exactly one keeps a genuinely empty field — `…;;…` — a rejection.
  if (fields.at(-1) === "") fields.pop();

  if (fields.length < MIN_VALUE_COUNT || fields.length > MAX_VALUE_COUNT) {
    return {
      ok: false,
      rejection: { kind: "value-count", count: fields.length },
    };
  }

  const values = new Array<number>(STORE_SIZE).fill(0);
  for (const [index, field] of fields.entries()) {
    if (!WHOLE_NUMBER.test(field)) {
      return { ok: false, rejection: { kind: "not-an-integer", index } };
    }
    const value = Number(field);
    if (value < 0 || value > MAX_WIRE_VALUE) {
      return { ok: false, rejection: { kind: "out-of-range", index } };
    }
    values[index] = value;
  }

  return { ok: true, values };
}

/**
 * The addresses an import writes: the manifest's, less the ones that are not
 * anybody's sound (SPEC.md 11.3).
 *
 * **189, not 253.** Only what `parameters.json` declares is written, which is
 * the read-side mirror of the zeros the write side puts at every undeclared
 * address: a value sitting at an address nobody claims is not propagated. It is
 * the *manifest's* set and not the panel's, so **address 20 is written like any
 * other** — a preset carries the bank hue it was designed with, even though no
 * control draws it (SPEC.md 7.4).
 *
 * Three exclusions, with three different reasons:
 *
 * - **2–7**, which is exactly the manifest's `hidden` group: 2–6 are the
 *   fiction of SPEC.md 5.4 that the confirming dump would overwrite anyway, and
 *   7 is healed by the firmware on every write. You import someone's sound, not
 *   their volume.
 * - **1**, the bank id: writing it poisons the bank of every later dump
 *   (SPEC.md 1.5). No parameter declares it, and it is named here all the same
 *   — the one address in the store where a mistake is not recoverable by
 *   another write should not be excluded only by accident.
 * - **255**, excluded by the same accident and left to it: nothing declares it,
 *   and the legacy only ever wrote 0 there as a side effect of its trailing
 *   separator.
 */
export function presetWriteMap(
  values: readonly number[],
): ReadonlyMap<number, number> {
  const map = new Map<number, number>();
  for (const [address, parameter] of byAddress) {
    if (address === BANK_ADDRESS) continue;
    if (parameter.group === HIDDEN_GROUP) continue;
    map.set(address, values[address]);
  }
  return map;
}
