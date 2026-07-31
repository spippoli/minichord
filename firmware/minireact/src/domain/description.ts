/**
 * The one producer of everything the app says *about* a parameter (SPEC.md 6.1,
 * invariant 5).
 *
 * There are two consumers and neither composes text of its own: the single
 * visual readout, which is `aria-hidden` and shows the where-line, the tooltip
 * and the kind note (SPEC.md A.4), and the screen-reader-only element every
 * control's `aria-describedby` points at, which gets the one sentence of
 * SPEC.md A.5. Both call this; a consumer that concatenates is the invariant
 * being broken, and it is the one that has already been broken twice.
 *
 * Pure, and parameterised by the parameter plus the little of the store's state
 * the sentence depends on — which is why it lives in `domain/` and can be
 * asserted string by string against the appendix.
 */

import { kindOf, type ControlKind } from "./kind";
import type { Parameter, Section } from "./parameters";

/** What the readout says when nothing is hovered and nothing is focused. */
export const RESTING_LINE =
  "Point at a control, or tab to one, and it explains itself here.";

/**
 * Which cell of the sequencer is being explained, when the control is one.
 *
 * A column is a parameter and a cell is a bit (SPEC.md 6.1, invariant 3), so
 * the address alone does not say what is under the hand: the note is what the
 * column does not carry. Both are counted from 1, as the grid shows them.
 */
export interface SequencerCell {
  step: number;
  note: number;
  /** Past `cycle length`: the firmware never reaches it (SPEC.md A.6). */
  outOfCycle: boolean;
}

/** What the panel calls a step the firmware never reaches (SPEC.md A.6). */
export const OUT_OF_CYCLE = "out of cycle";

/** The little of the store a description depends on. */
export interface ParameterCondition {
  /** The firmware the device reports at address 7. Decides the empty slot. */
  firmwareVersion: number;
  /** The amber LED: this value differs from what is stored in the bank. */
  changedFromStoredBank?: boolean;
  /** The blue LED: this value differs from the factory default. */
  differsFromDefault?: boolean;
  /** The cell under the hand, when the parameter is a sequencer column. */
  cell?: SequencerCell;
}

export interface ParameterDescription {
  /** `{section} / {group} / {name}`, with the raw address after it. */
  where: string;
  /** The parameter's own tooltip, verbatim. */
  tooltip: string;
  /** The kind note, or the whole explanation when the slot is unequipped. */
  note: string;
  /** Whether this device is too old for the parameter (SPEC.md 12.6). */
  unequipped: boolean;
  /** SPEC.md A.5: one sentence, in one order, ending in a full stop. */
  sentence: string;
}

/** The section as its own tab spells it (SPEC.md A.6). */
const SECTION_NAME: Readonly<Record<Section, string>> = {
  global: "Global",
  harp: "Harp",
  chord: "Chord",
};

/** SPEC.md A.4. The kind is derived from the parameter, never passed in. */
const KIND_NOTE: Readonly<Record<ControlKind, string>> = {
  toggle: "on / off",
  select: "pick a value by name",
  stepper: "the arrow keys step the value; Enter types it",
  slider: "drag, use the arrow keys, or press Enter to type the value",
  picker: "points at another parameter",
  sequencer: "one step of the pattern",
};

/**
 * Join the fragments of SPEC.md A.5 into one sentence.
 *
 * Eleven of the 195 tooltips end in a full stop of their own, so a fragment
 * that already ends in one is not given a second.
 */
function sentence(fragments: readonly string[]): string {
  return fragments
    .map((fragment) => (fragment.endsWith(".") ? fragment : `${fragment}.`))
    .join(" ");
}

/**
 * Where a cell is, in the words of SPEC.md A.4 and A.5: the step and the note,
 * plus _out of cycle_ when the firmware never reaches that step.
 *
 * One fragment for both consumers, because there is one producer: the readout
 * appends it to the where-line and the reader hears it first in the sentence.
 */
function cellFragment(cell: SequencerCell): string {
  const where = `step ${cell.step}, note ${cell.note}`;
  return cell.outOfCycle ? `${where}, ${OUT_OF_CYCLE}` : where;
}

export function describeParameter(
  parameter: Parameter,
  condition: ParameterCondition,
): ParameterDescription {
  const unequipped = parameter.introducedIn > condition.firmwareVersion;
  const cell = condition.cell;

  return {
    // The address stays on a cell's where-line: the column *is* a parameter,
    // and the step and note are what the address alone cannot say.
    where: `${SECTION_NAME[parameter.section]} / ${parameter.group} / ${parameter.name} — address ${parameter.address}${cell ? ` — ${cellFragment(cell)}` : ""}`,
    tooltip: parameter.tooltip,
    unequipped,
    note: unequipped
      ? `Not on this device. This parameter arrived in firmware ${parameter.introducedIn}; the minichord you are connected to is older, so the slot is empty rather than editable.`
      : KIND_NOTE[kindOf(parameter)],
    sentence: sentence([
      // First, per SPEC.md A.5: the section and the group are deliberately
      // absent, the plate's `role="group"` having announced them on entry.
      ...(cell ? [cellFragment(cell)] : []),
      ...(unequipped
        ? [
            `Not on this device: this parameter arrived in firmware ${parameter.introducedIn} and the connected minichord is older`,
          ]
        : []),
      parameter.tooltip,
      ...(condition.changedFromStoredBank
        ? ["changed from the stored bank"]
        : []),
      ...(condition.differsFromDefault
        ? ["differs from the factory default"]
        : []),
    ]),
  };
}
