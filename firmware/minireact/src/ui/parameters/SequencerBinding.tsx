import {
  CYCLE_LENGTH_ADDRESS,
  RHYTHM_STEP_COUNT,
  byAddress,
  isAvailable,
  rhythmStepAddress,
  withRhythmNote,
  type Parameter,
} from "../../domain";
import { differsFromDefault, firmwareVersion, isEdited } from "../../state";
import { useAppState, useRuntime } from "../runtimeContext";
import { Sequencer } from "./Sequencer";

/**
 * The one component that reads the store for the sixteen rhythm columns
 * (SPEC.md 6.1, invariant 1).
 *
 * It is `ParameterBinding`'s counterpart and not a special case of it: a
 * binding is one per *parameter*, and the grid is one object drawing sixteen of
 * them at once, so the sixteen values arrive here together and go down as
 * props. The grid below reads nothing.
 *
 * Toggling a cell **flips one bit of one address and nothing else**: the mask
 * is read back from the column that owns it, one bit is moved, and the whole
 * mask goes to that one address. The fifteen other columns are not written.
 *
 * There is no pointer hold here, unlike a fader: a cell is a bit and its edit
 * is instantaneous, so there is no drag for a dump to arrive in the middle of
 * (SPEC.md 5.3).
 */

/** The sixteen column parameters, in step order: addresses 220..235. */
const COLUMNS: readonly Parameter[] = Array.from(
  { length: RHYTHM_STEP_COUNT },
  (_, step) => {
    const parameter = byAddress.get(rhythmStepAddress(step));
    if (!parameter) {
      throw new Error(`no parameter at rhythm step ${step}`);
    }
    return parameter;
  },
);

export function SequencerBinding() {
  const runtime = useRuntime();
  const { parameters } = useAppState();
  const values = parameters.values;

  // No device, no state: the app before the first dump is the gate (SPEC.md
  // 5.2), so this only ever renders with a store behind it.
  if (!values) return null;

  const version = firmwareVersion(parameters);
  const masks = COLUMNS.map((column) => values[column.address]);
  // A column *is* a parameter, so it diverges like one and the grid is not
  // exempt from the two LEDs of SPEC.md 7.3 — the exception of invariant 3 is
  // to the *kind*, not to the repertoire. Read here, once per column, exactly
  // as a binding reads them for a control (invariant 1).
  const divergence = COLUMNS.map((column) => ({
    edited: isEdited(parameters, column.address),
    offDefault: differsFromDefault(parameters, column.address),
  }));

  return (
    <Sequencer
      columns={COLUMNS}
      masks={masks}
      divergence={divergence}
      cycleLength={values[CYCLE_LENGTH_ADDRESS]}
      firmwareVersion={version}
      // The sixteen columns share one `introduction_version`, so the grid is
      // equipped or not as one thing.
      unequipped={!isAvailable(COLUMNS[0], version)}
      onToggle={(step, note, on) => {
        const address = rhythmStepAddress(step);
        runtime.setParameter(
          address,
          withRhythmNote(values[address], note, on),
        );
      }}
    />
  );
}
