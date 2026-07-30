/**
 * The addresses that mean something on their own.
 *
 * `parameters.json` describes the 195 addressable parameters; these are the
 * slots of SPEC.md 1.4 that carry a fact about the device rather than a
 * parameter, and that several layers therefore have to name. They are here so
 * that the number 7 appears once with its meaning attached, instead of in every
 * file that needs the firmware version.
 */

/** The bank the device is in, as 0..11. A human counts it from one. */
export const BANK_ADDRESS = 1;

/**
 * The firmware version, an integer counter — 8 at the time of writing.
 *
 * The firmware heals this slot on every write (SPEC.md 1.5), so it is excluded
 * wherever the store compares what it holds against what it sent.
 */
export const FIRMWARE_VERSION_ADDRESS = 7;

/** How the bank number reads to a human: 1..12, not 0..11. */
export function bankNumber(rawBankValue: number): number {
  return rawBankValue + 1;
}
