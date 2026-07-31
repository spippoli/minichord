/**
 * What kind of control a parameter is drawn as (SPEC.md 8.1).
 *
 * `parameters.json` carries no notion of a kind — only `data_type`, `curve` and
 * a range — which is why the legacy draws one range input 189 times and a
 * boolean ends up a two-position fader. **The taxonomy is hand-derived, lives
 * here, and leaves the JSON untouched.**
 *
 * Six rules, in order, first match wins. Only two things are genuinely written
 * by hand: which four addresses are not quantities, and which fourteen carry a
 * named enumeration; everything else falls out of the data.
 *
 * The kind is *derived* from the parameter and never passed in by a caller
 * (SPEC.md 6.1, invariant 2): the kind chooses the widget in the slot, and
 * nothing else.
 */

import { ENUMERATIONS } from "./enumerations";
import { isRhythmAddress } from "./rhythm";
import type { Parameter } from "./parameters";

export type ControlKind =
  "toggle" | "select" | "stepper" | "slider" | "picker" | "sequencer";

/**
 * The four potentiometer routing slots, whose value is the SysEx address of
 * another parameter rather than a quantity (SPEC.md 8.4).
 */
export const PICKER_ADDRESSES: ReadonlySet<number> = new Set([10, 12, 14, 16]);

/**
 * The fourteen addresses whose values have names (SPEC.md 8.6): eleven
 * waveforms, the key signatures, and the two shufflings.
 *
 * The rule reads the labels rather than restating their addresses: a menu with
 * no names is the one thing a `select` cannot be, so the two lists must not be
 * able to drift apart.
 */
export const ENUMERATED_ADDRESSES: ReadonlySet<number> = new Set(
  ENUMERATIONS.keys(),
);

/** The widest range still small enough to step through rather than drag. */
const STEPPER_SPAN = 16;

export function kindOf(parameter: Parameter): ControlKind {
  const { address, dataType, curve, min, max } = parameter;

  if (isRhythmAddress(address)) return "sequencer";
  if (PICKER_ADDRESSES.has(address)) return "picker";
  if (ENUMERATED_ADDRESSES.has(address)) return "select";

  const ordinal = dataType === "int" && curve === "linear";
  if (ordinal && min === 0 && max === 1) return "toggle";
  if (ordinal && max - min <= STEPPER_SPAN) return "stepper";

  return "slider";
}
