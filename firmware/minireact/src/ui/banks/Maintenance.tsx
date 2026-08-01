import { useId, useState } from "react";

import { useAppState, useReadOnly, useRuntime } from "../runtimeContext";
import styles from "./Banks.module.css";
import { PresetCodes } from "./PresetCodes";

/**
 * The maintenance area (SPEC.md 10.6): what repairs the device and what carries
 * a bank in and out of it, kept away from the row that edits it.
 *
 * Three things live here and they are ordered by blast radius, smallest first:
 * the preset code of the bank on screen, the field that replaces that bank, and
 * the wipe that takes all twelve. The export sitting above the import is not
 * arbitrary either — it is the safety net for the click below it (SPEC.md
 * 11.4).
 *
 * The area is two boxes rather than one, and it has no heading of its own: the
 * wipe has the only heading Appendix A gives, and inventing a second string to
 * span both would be inventing a string.
 */
export function Maintenance() {
  return (
    <>
      <PresetCodes />
      <WipeMemory />
    </>
  );
}

/**
 * A wipe takes a **typed confirmation** — a different friction, not merely more
 * of the same. It resets all twelve banks and it is not a gesture of editing:
 * it exists for corrupt flash. Arming in place, the reset's and the import's
 * confirmation, would put the largest blast radius in the app behind the same
 * single extra click as the smallest. The legacy asks nothing at all before
 * either command.
 */
function WipeMemory() {
  const runtime = useRuntime();
  const { parameters } = useAppState();
  const readOnly = useReadOnly();
  const [typed, setTyped] = useState("");
  const headingId = useId();
  const confirmId = useId();

  // The word is the confirmation, so it is compared exactly: a case-insensitive
  // match would accept a "wipe" typed absent-mindedly, which is the whole of
  // what the friction is for.
  const confirmed = typed === "WIPE";

  // The same refusal the editing row makes, and it is owed for the same reason
  // even at this distance from it: a save issued a moment ago has one flag
  // waiting for one dump, and a wipe landing inside that window would take the
  // acknowledgement of the save with it and put a second flash erase on a
  // device already in the middle of one (SPEC.md 10.2). The reducer refuses it;
  // this stops the button from looking as though it would work.
  const busy = readOnly || parameters.pendingCommand !== null;

  function wipe() {
    if (!confirmed || busy) return;
    // Cleared on the click rather than on the answer: the friction is spent,
    // and a second wipe must be typed for again.
    setTyped("");
    runtime.wipeMemory();
  }

  return (
    <section className={styles.maintenance} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.maintenanceHeading}>
        Wipe all memory
      </h2>

      <p className={styles.maintenanceBody}>
        This resets all 12 banks to the factory sounds. It cannot be undone.{" "}
        {/*
          The field's accessible name, and it is the sentence that was going to
          be written anyway: Appendix A gives the wipe one body and no field
          label, and inventing a second string for a reader to hear would be
          inventing a string.
        */}
        <span id={confirmId}>Type WIPE to confirm.</span>
      </p>

      <div className={styles.maintenanceRow}>
        <input
          className={styles.field}
          type="text"
          value={typed}
          aria-labelledby={confirmId}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button
          type="button"
          className={styles.key}
          // Not `disabled`: the click that fires clears the word, which would
          // disable the button under the hand that just pressed it and drop the
          // focus to `<body>` — the focus steal of SPEC.md 9.7, arriving as a
          // consequence rather than as a call.
          aria-disabled={!confirmed || busy}
          onClick={wipe}
        >
          Wipe all banks
        </button>
      </div>
    </section>
  );
}
