/**
 * Write a set of addresses, confirm what landed, report what did not
 * (SPEC.md 5.8).
 *
 * Three features write many addresses at once and none of them can trust that
 * the writes landed: the preset import (SPEC.md 11.3), the randomiser and its
 * undo (SPEC.md 11.5), and the dock's revert-all (SPEC.md 10.4). **They are one
 * module, not three implementations of the same paragraph** — the
 * caller-visible difference between them is *which addresses are in the map*,
 * and everything else is this module's.
 *
 * Callers build a map and read a count. They do not know a dump is involved,
 * and they do not each carry a copy of the exclusion list — nor does this
 * module, which imports the store's one derivation of it below.
 *
 * It lives in `state/` and not in `domain/` because it awaits round trips and
 * drives the transport, which is exactly what a pure layer cannot do.
 */

/**
 * Which addresses a comparison may look at (SPEC.md 5.4) comes from the store,
 * which already derives it from the fiction it forces at 2–6 and from the
 * firmware version at 7.
 *
 * **Getting this exclusion wrong is precisely the bug that would otherwise be
 * written three times** — without it every round reports five or six phantom
 * divergences and the repair never converges — so this module does not restate
 * it either. A second copy here, written as two literals, would be that bug
 * with a fourth author rather than a fourth caller.
 *
 * The exclusion is from the *comparison* only. Whether an address is written at
 * all is the caller's business: the import declines to write these, the revert
 * has no reason to hold them.
 */
import { isComparable } from "./parameters/reducer";

/**
 * How many of the addresses this module could judge did land, and which ones
 * still had not after the repair round.
 *
 * `applied` counts only addresses this module is allowed to compare: nothing
 * can be said about 2–7, so they are counted in neither number.
 */
export type BulkWriteResult = { applied: number; diverged: readonly number[] };

/**
 * The wire, reduced to the three things a bulk write does with it.
 *
 * A seam rather than the transport itself: the module is then drivable with no
 * MIDI at all, and the runtime is the one place that knows a dump arrives as a
 * subscription rather than as the return value of a request.
 */
export type BulkWriteWire = {
  /** One raw value at one address, unpaced — see below. */
  send(address: number, value: number): void;
  requestDump(): void;
  /** The next dump the device sends, or `null` if it stayed silent. */
  nextDump(): Promise<readonly number[] | null>;
};

/**
 * Which of `among` the dump disagrees with.
 *
 * A dump that never arrived confirms nothing, so every address it was meant to
 * answer for is still unconfirmed rather than quietly assumed to have landed.
 */
function divergence(
  dump: readonly number[] | null,
  values: ReadonlyMap<number, number>,
  among: readonly number[],
): readonly number[] {
  if (!dump) return among;
  return among.filter((address) => dump[address] !== values.get(address));
}

/**
 * The bulk write of SPEC.md 5.8, bound to one wire.
 *
 * The writes go out **unpaced**: pacing only makes them slower, and 254
 * messages at zero interval lost nothing when it was measured (SPEC.md 5.7,
 * 1.6). Then a dump is requested, what comes back is compared against what was
 * sent, whatever diverged is re-sent, a second dump is requested, and it stops.
 *
 * **Two rounds, and the second only when the first came back wrong.** A second
 * loss on the same address is under 0.1% given the ≈2.5% bound of SPEC.md 1.6,
 * so a third round would not be fighting packet loss — it would be fighting the
 * firmware normalising a value (SPEC.md 11.3). If anything still diverges, the
 * caller says how many and stops.
 */
export function makeBulkWrite(
  wire: BulkWriteWire,
): (values: ReadonlyMap<number, number>) => Promise<BulkWriteResult> {
  return async function bulkWrite(
    values: ReadonlyMap<number, number>,
  ): Promise<BulkWriteResult> {
    const judged = [...values.keys()].filter(isComparable);

    for (const [address, value] of values) wire.send(address, value);
    wire.requestDump();
    let diverged = divergence(await wire.nextDump(), values, judged);

    if (diverged.length > 0) {
      for (const address of diverged) {
        wire.send(address, values.get(address) as number);
      }
      wire.requestDump();
      diverged = divergence(await wire.nextDump(), values, diverged);
    }

    return { applied: judged.length - diverged.length, diverged };
  };
}
