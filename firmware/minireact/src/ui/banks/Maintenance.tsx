import { useId, useState } from "react";

import { useReadOnly, useRuntime } from "../runtimeContext";
import styles from "./Banks.module.css";

/**
 * The maintenance area (SPEC.md 10.6): what repairs the device, kept away from
 * the row that edits it.
 *
 * A wipe takes a **typed confirmation** — a different friction, not merely more
 * of the same. It resets all twelve banks and it is not a gesture of editing:
 * it exists for corrupt flash. Arming in place, the reset's confirmation, would
 * put the largest blast radius in the app behind the same single extra click as
 * the smallest. The legacy asks nothing at all before either command.
 *
 * The preset export and import fields of SPEC.md 11 belong here too, and arrive
 * with the ticket that raises them.
 */
export function Maintenance() {
  const runtime = useRuntime();
  const readOnly = useReadOnly();
  const [typed, setTyped] = useState("");
  const headingId = useId();
  const confirmId = useId();

  // The word is the confirmation, so it is compared exactly: a case-insensitive
  // match would accept a "wipe" typed absent-mindedly, which is the whole of
  // what the friction is for.
  const confirmed = typed === "WIPE";

  function wipe() {
    if (!confirmed || readOnly) return;
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
          disabled={!confirmed || readOnly}
          onClick={wipe}
        >
          Wipe all banks
        </button>
      </div>
    </section>
  );
}
