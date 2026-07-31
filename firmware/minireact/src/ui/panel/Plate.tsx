import { useId } from "react";

import { isEdited } from "../../state";
import { ParameterBinding } from "../parameters/ParameterBinding";
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
 * rather than by lengthening 189 labels (SPEC.md 12.5).
 *
 * **A folded plate still reports how many of its parameters were edited**:
 * folding hides noise, never state. The count reads the store, which a plate
 * may do — invariant 1 is about components that *draw a parameter*, and the
 * binding below is still the only one of those.
 */
export function Plate({
  plate,
  folded,
  onFold,
  parameters,
}: {
  plate: PlateModel;
  folded: boolean;
  onFold: () => void;
  /** What survives the search; the plate itself decides nothing about it. */
  parameters: readonly PlateModel["parameters"][number][];
}) {
  const headingId = useId();
  const { parameters: store } = useAppState();

  const edited = plate.parameters.filter((parameter) =>
    isEdited(store, parameter.address),
  ).length;

  return (
    <section className={styles.plate} role="group" aria-labelledby={headingId}>
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
        <div className={styles.plateBody}>
          {parameters.map((parameter) => (
            <ParameterBinding key={parameter.address} parameter={parameter} />
          ))}
        </div>
      )}
    </section>
  );
}
