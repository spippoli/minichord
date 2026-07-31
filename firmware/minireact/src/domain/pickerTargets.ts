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

/**
 * Move a routing slot by whole targets, the way the arrow keys do everywhere
 * else — by value rather than by position (SPEC.md 8.2).
 *
 * A picker cannot use the ordinary nudge: its value is an address and the gaps
 * between them are not steps, and clamping into the declared 21..219 would make
 * the resting value of 0 unreachable by keyboard, leaving "none" a thing only a
 * mouse can choose (SPEC.md 8.4, 12.2).
 */
export function stepPickerTarget(value: number, step: number): number {
  const addresses = [
    PICKER_RESTING_VALUE,
    ...pickerTargets.map((target) => target.address),
  ];

  // A target the manifest does not know steps from rest, which is the only
  // place a value it does not contain can honestly be said to sit.
  const at = Math.max(0, addresses.indexOf(value));
  const to = Math.min(Math.max(at + step, 0), addresses.length - 1);
  return addresses[to];
}
