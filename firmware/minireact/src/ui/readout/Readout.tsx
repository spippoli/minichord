import {
  CYCLE_LENGTH_ADDRESS,
  RESTING_LINE,
  RHYTHM_STEP_COUNT,
  byAddress,
  describeParameter,
  isStepInCycle,
  rhythmNoteOfBit,
  rhythmStepOfAddress,
  type SequencerCell,
} from "../../domain";
import { firmwareVersion } from "../../state";
import { useAppState } from "../runtimeContext";
import styles from "./Readout.module.css";
import { useReadoutTarget } from "./readoutChannel";

/**
 * There is **exactly one** of these in the tree (SPEC.md 6.2).
 *
 * It explains whatever is under the pointer or the focus, and it is
 * `aria-hidden`: a reader has already been told the same words as the control's
 * own description, and a live region here fires again, out of order (SPEC.md
 * 12.5). It is also not the strip — that one says what happened to the device,
 * on a different clock, and merging the two loses both decisions (invariant 7).
 *
 * It reads the store for two things only — the firmware version, which decides
 * whether the slot the pointer is on exists on this device, and `cycle length`,
 * which decides whether the sequencer cell under the hand is one the firmware
 * ever reaches. It draws no parameter and holds no value, so invariant 1 is
 * untouched; and it composes no text of its own — every string here comes out
 * of `describeParameter` (invariant 5).
 */
/**
 * The cell a target stands for, in the words the description is written in:
 * step and note counted from 1, and whether the step is past `cycle length`.
 *
 * Nothing but a sequencer cell carries a `bit`, so this answers `undefined` for
 * the other 173 controls and the where-line is unchanged for them.
 */
function cellOf(
  target: ReturnType<typeof useReadoutTarget>,
  values: readonly number[] | null,
): SequencerCell | undefined {
  if (!target || target.bit === undefined) return undefined;

  const step = rhythmStepOfAddress(target.address);
  if (step === null) return undefined;

  // Before the first dump there is no cycle to be outside of; the whole
  // sixteen is the honest answer, and the panel is the gate anyway.
  const cycleLength = values?.[CYCLE_LENGTH_ADDRESS] ?? RHYTHM_STEP_COUNT;

  return {
    step: step + 1,
    note: rhythmNoteOfBit(target.bit),
    outOfCycle: !isStepInCycle(step, cycleLength),
  };
}

export function Readout() {
  const target = useReadoutTarget();
  const { parameters } = useAppState();

  const parameter = target ? byAddress.get(target.address) : undefined;
  const description = parameter
    ? describeParameter(parameter, {
        firmwareVersion: firmwareVersion(parameters),
        cell: cellOf(target, parameters.values),
      })
    : null;

  return (
    <div className={styles.readout} aria-hidden="true">
      {description ? (
        <>
          <p className={styles.where}>{description.where}</p>
          <p className={styles.what}>
            {description.tooltip}{" "}
            <span
              className={
                description.unequipped ? styles.unequipped : styles.note
              }
            >
              {description.note}
            </span>
          </p>
        </>
      ) : (
        <p className={styles.resting}>{RESTING_LINE}</p>
      )}
    </div>
  );
}
