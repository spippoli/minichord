import { useId } from "react";

import { isRhythmAddress, type Parameter } from "../../domain";
import { isEdited } from "../../state";
import { ParameterBinding } from "../parameters/ParameterBinding";
import { SequencerBinding } from "../parameters/SequencerBinding";
import { useAppState } from "../runtimeContext";
import styles from "./Panel.module.css";
import type { Plate as PlateModel } from "./plates";

/**
 * A group of the section, drawn as one collapsible plate (SPEC.md 7.2).
 *
 * Not one of the six obligated components (SPEC.md 6.2): a plate is a place
 * where controls go, not a boundary holding a decision up. It is `role="group"`
 * labelled by its own heading, which is what fixes the ambiguous names —
 * `attack` and `waveform` exist in both the harp and the chord — by structure
 * rather than by lengthening 188 labels (SPEC.md 12.5).
 *
 * **A folded plate still reports how many of its parameters were edited**:
 * folding hides noise, never state. The count reads the store, which a plate
 * may do — invariant 1 is about components that *draw a parameter*, and the
 * binding below is still the only one of those.
 *
 * One plate is not a column of controls: the chord section's Rythm group holds
 * the sixteen rhythm masks, and those are **one grid, not sixteen controls**
 * (SPEC.md 8.3). The plate that holds them spans the whole flow, since a
 * sixteen-step grid in a 20rem column is a grid nobody can read.
 */
export function Plate({
  plate,
  folded,
  onFold,
  matching,
}: {
  plate: PlateModel;
  folded: boolean;
  onFold: () => void;
  /**
   * What survives the search, which the plate decides nothing about. The
   * edited count is deliberately taken from `plate` instead: a search narrows
   * what is on screen, and it must not narrow what the header reports.
   */
  matching: readonly Parameter[];
}) {
  const headingId = useId();
  const { parameters: store } = useAppState();

  const edited = plate.parameters.filter((parameter) =>
    isEdited(store, parameter.address),
  ).length;

  /**
   * The grid is one object, so a search that finds any of its sixteen columns
   * draws all sixteen: a grid with four of its steps missing is not a shorter
   * grid, it is a broken one.
   */
  const sequencer = matching.some((parameter) =>
    isRhythmAddress(parameter.address),
  );
  const controls = matching.filter(
    (parameter) => !isRhythmAddress(parameter.address),
  );

  return (
    <section
      className={sequencer ? styles.plateWide : styles.plate}
      role="group"
      aria-labelledby={headingId}
    >
      <h2 className={styles.plateHeading}>
        <button
          type="button"
          className={styles.plateHeader}
          aria-expanded={!folded}
          onClick={onFold}
        >
          {/* The group's name alone labels the group: the edited count is
              state, and a label that changed with it would be read as a
              rename. */}
          <span id={headingId} className={styles.plateName}>
            {plate.group}
          </span>
          {edited > 0 && (
            <span className={styles.plateEdited}>{edited} edited</span>
          )}
        </button>
      </h2>

      {!folded && (
        <div className={sequencer ? styles.plateBodyWide : styles.plateBody}>
          {controls.map((parameter) => (
            <ParameterBinding key={parameter.address} parameter={parameter} />
          ))}
          {sequencer && (
            <div className={styles.sequencerSlot}>
              <SequencerBinding />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
