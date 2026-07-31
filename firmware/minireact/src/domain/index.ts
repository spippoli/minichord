/**
 * The domain layer: what the 195 parameters are, and how a wire integer
 * becomes something a human reads.
 *
 * Pure by construction — no MIDI, no React, no DOM. It sits below `state/` and
 * imports nothing from `transport/`.
 */

export {
  BANK_ADDRESS,
  FIRMWARE_VERSION_ADDRESS,
  bankNumber,
} from "./addresses";

export type { Parameter, Section } from "./parameters";
export {
  HIDDEN_GROUP,
  byAddress,
  isAvailable,
  parameters,
  visibleParameters,
} from "./parameters";

export type { ControlKind } from "./kind";
export { kindOf } from "./kind";

export type { ParameterCondition, ParameterDescription } from "./description";
export { RESTING_LINE, describeParameter } from "./description";

export {
  FLOAT_DECIMALS,
  FLOAT_MULTIPLIER,
  defaultWire,
  format,
  nudge,
  parse,
  positionToWire,
  wireMax,
  wireMin,
  wireToPosition,
} from "./conversion";

export {
  RHYTHM_FIRST_ADDRESS,
  RHYTHM_LAST_ADDRESS,
  RHYTHM_NOTE_COUNT,
  RHYTHM_STEP_COUNT,
  decodeRhythmMask,
  encodeRhythmMask,
  isRhythmAddress,
  rhythmStepAddress,
  rhythmStepOfAddress,
  withRhythmNote,
} from "./rhythm";
