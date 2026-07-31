/**
 * What the four potentiometer routing slots can point at (SPEC.md 8.4).
 *
 * Addresses 10, 12, 14 and 16 hold **the SysEx address of another parameter** —
 * which one the physical knob drives. The legacy asks you to pick it by dragging
 * a fader across 21..219, so today you choose *which parameter to control* by
 * dragging a cursor over an address number; a picker lists its targets by name
 * instead.
 *
 * The list is the data's own: every visible parameter whose address the
 * firmware accepts as a target, in address order. Nothing is hand-written here.
 */

import { visibleParameters, type Parameter } from "./parameters";

/** The window of addresses the firmware routes a potentiometer to. */
const FIRST_TARGET = 21;
const LAST_TARGET = 219;

/**
 * The value a slot rests on: **0, outside its own declared minimum of 21**.
 * Any control here has to survive a value its declared range excludes, which is
 * why `defaultWire` does not clamp (SPEC.md 4.3, 8.4).
 */
export const PICKER_RESTING_VALUE = 0;

/** Every parameter a potentiometer may be pointed at, in address order. */
export const pickerTargets: readonly Parameter[] = visibleParameters
  .filter(
    (parameter) =>
      parameter.address >= FIRST_TARGET && parameter.address <= LAST_TARGET,
  )
  .toSorted((a, b) => a.address - b.address);
