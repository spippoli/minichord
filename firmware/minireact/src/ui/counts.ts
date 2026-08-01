/**
 * The counted phrases the app says, in one place.
 *
 * `{k}` is always a count and **the singular is spelled out** (SPEC.md A.3):
 * "1 unsaved changes are gone" is the kind of thing a machine says, in the
 * lines whose whole job is to be believed about something that was just lost.
 *
 * They are here rather than beside their one obvious caller because each has
 * two: the unsaved count is in the strip's loss lines *and* on the armed import
 * button (SPEC.md A.7), and the divergence count is in the strip. A rule about
 * the number one, answered in two places, is two places to disagree — which is
 * exactly what a count of one gets wrong.
 */

/**
 * What the user is about to lose, or has just lost.
 *
 * **The verb comes back with the phrase**, though only one caller has one. The
 * singular is a single fact about `k`; the lines that need no verb ignore it.
 */
export function unsavedChanges(k: number): {
  readonly phrase: string;
  readonly verb: string;
} {
  return k === 1
    ? { phrase: "1 unsaved change", verb: "is" }
    : { phrase: `${k} unsaved changes`, verb: "are" };
}

/** What two rounds of bulk write could not get to stick (SPEC.md A.3). */
export function valuesDidNotTake(k: number): string {
  return k === 1 ? "1 value did not take" : `${k} values did not take`;
}
