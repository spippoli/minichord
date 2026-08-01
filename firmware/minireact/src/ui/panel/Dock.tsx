import { useId, useState } from "react";

import { format } from "../../domain";
import { editBuffer } from "../../state";
import { useAppState, useRuntime } from "../runtimeContext";
import { focusParameter } from "./focusParameter";
import styles from "./Panel.module.css";

/**
 * Divergence at its coarsest magnification: every changed parameter, what it
 * was, what it is, and the way back (SPEC.md 7.3).
 *
 * It sits **after the grid in DOM order** and stays there: a reader would
 * otherwise hear the result of editing before the panel that produces it, and
 * the dock is empty until something is touched. What that costs — the dock
 * being 96 controls away from the hand — is paid by the skip link the panel
 * puts first, and by the jump link here moving the *focus* and not just the
 * eye.
 *
 * **Revert yes, undo no** (SPEC.md 10.4). It exists because if the LEDs tell
 * you that you diverged, the gesture opposite to saving must exist. It touches
 * no flash, so it asks nothing before acting.
 */

/** SPEC.md A.6, verbatim. The dock is the one place these five are named. */
const FICTION_LINE =
  "Harp volume, chord volume and the three potentiometer slots are physical knobs on the minichord. This page does not show them, and does not change them.";

const EMPTY_LINE = "Nothing changed since this bank was loaded.";

export function Dock({
  id,
  backTo,
}: {
  /** Where the panel's skip link lands. */
  id: string;
  /** The id of the panel region "Back to the panel" returns to. */
  backTo: string;
}) {
  const runtime = useRuntime();
  const { parameters, connection } = useAppState();
  const headingId = useId();

  /**
   * A revert-all is a round trip and a repair round, not a click: while it is
   * in flight the button must not be clickable twice, which would put a second
   * bulk write on a wire already carrying one.
   */
  const [reverting, setReverting] = useState(false);

  const edited = editBuffer(parameters);
  // The reducer refuses edits with no wire (SPEC.md 5.2) and `bulkWrite` refuses
  // to go around it; drawing the buttons dead is a rendering of that fact, not
  // the authority for it.
  const writable = connection.status === "connected";

  /**
   * Discarding unsaved changes is just re-sending the reference of SPEC.md 10.3
   * through `bulkWrite` (SPEC.md 10.4, 5.8) — and only the addresses that
   * actually diverged, since the rest of the reference is already on the
   * device and addresses 2–7 must never be written at all.
   *
   * **The count is read, and the rows are what says it.** `bulkWrite` resolves
   * only after the confirming dump has been through the store, so an address
   * that did not take still differs from its stored value and keeps its row:
   * the dock is the report, and it is exact rather than a number. Nothing is
   * announced in the strip — A.3 carries a divergence line for the preset
   * import and none for a revert, and inventing one here would be this
   * component composing device messages of its own (SPEC.md 9.7).
   *
   * What has no place on screen goes to the console: a revert that came back
   * short means the device dropped writes twice, which is a fact about the
   * wire and not something the panel can ask the user to do anything about.
   */
  async function revertAll() {
    if (reverting || edited.length === 0) return;
    setReverting(true);
    try {
      const { diverged } = await runtime.bulkWrite(
        new Map(edited.map((row) => [row.parameter.address, row.stored])),
      );
      if (diverged.length > 0) {
        console.warn(
          `minichord: ${diverged.length} of ${edited.length} reverted values did not take`,
          diverged,
        );
      }
    } finally {
      setReverting(false);
    }
  }

  return (
    <section
      id={id}
      className={styles.dock}
      // The skip link lands the focus here, and a section is not focusable on
      // its own account.
      tabIndex={-1}
      aria-labelledby={headingId}
    >
      <div className={styles.dockChrome}>
        <h2 id={headingId} className={styles.dockHeading}>
          Dock
        </h2>

        {edited.length > 0 && (
          <button
            type="button"
            className={styles.dockAction}
            disabled={!writable || reverting}
            onClick={() => void revertAll()}
          >
            Revert all
          </button>
        )}

        <a className={styles.skipLink} href={`#${backTo}`}>
          Back to the panel
        </a>
      </div>

      {edited.length === 0 ? (
        <p className={styles.dockEmpty}>{EMPTY_LINE}</p>
      ) : (
        <ul className={styles.dockRows}>
          {edited.map(({ parameter, stored, current }) => (
            <li key={parameter.address} className={styles.dockRow}>
              {/*
                A button rather than an anchor, and deliberately: it navigates
                nowhere, it moves the hand. `focusParameter` switches section,
                unfolds the plate, waits for the commit and takes the focus —
                and this link owns none of that (SPEC.md 6.1 invariant 6, 12.3).
              */}
              <button
                type="button"
                className={styles.dockJump}
                onClick={() => focusParameter(parameter.address)}
              >
                {parameter.name}
              </button>

              <span className={styles.dockSeparator} aria-hidden="true">
                ·
              </span>

              <span className={styles.dockChange}>
                {format(parameter, stored)} → {format(parameter, current)}
              </span>

              <span className={styles.dockSeparator} aria-hidden="true">
                ·
              </span>

              {/*
                One address back to the reference: an ordinary edit, so the
                reducer's optimism and its refusal both apply unchanged. Only
                the all-at-once case needs a confirming round trip.
              */}
              <button
                type="button"
                className={styles.dockAction}
                disabled={!writable}
                aria-label={`Revert ${parameter.name}`}
                onClick={() => runtime.setParameter(parameter.address, stored)}
              >
                Revert
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        The five fiction addresses get one line, not controls (SPEC.md 7.3):
        they are physical knobs, and they were never controls in the legacy
        editor either.
      */}
      <p className={styles.dockFiction}>{FICTION_LINE}</p>
    </section>
  );
}
