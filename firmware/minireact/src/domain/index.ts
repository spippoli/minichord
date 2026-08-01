/**
 * The domain layer: what the 195 parameters are, and how a wire integer
 * becomes something a human reads.
 *
 * Pure by construction — no MIDI, no React, no DOM. It sits below `state/` and
 * imports nothing from `transport/`.
 */

export {
  BANK_ADDRESS,
  BANK_COLOR_ADDRESS,
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

export { PRESET_CODE_VALUE_COUNT, encodePresetCode } from "./presetCode";

export type { ControlKind } from "./kind";
export { kindOf } from "./kind";

export { labelsOf } from "./enumerations";
export {
  PICKER_RESTING_VALUE,
  pickerTargets,
  stepPickerTarget,
} from "./pickerTargets";

export type { ParameterCondition, ParameterDescription } from "./description";
export { OUT_OF_CYCLE, RESTING_LINE, describeParameter } from "./description";

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

export type { SequencerCell } from "./rhythm";
export {
  CYCLE_LENGTH_ADDRESS,
  RHYTHM_FIRST_ADDRESS,
  RHYTHM_LAST_ADDRESS,
  RHYTHM_NOTE_COUNT,
  RHYTHM_STEP_COUNT,
  decodeRhythmMask,
  encodeRhythmMask,
  isRhythmAddress,
  isStepInCycle,
  rhythmNoteOfBit,
  rhythmStepAddress,
  rhythmStepOfAddress,
  rhythmVoiceOfBit,
  sequencerCell,
  sequencerCellOfAddress,
  withRhythmNote,
} from "./rhythm";
