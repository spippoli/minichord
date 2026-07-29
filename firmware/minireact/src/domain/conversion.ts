/**
 * Every translation between a wire integer and what a human reads or types.
 *
 * It lives in `domain/` because all of it is parameterised by fields that live
 * here — the data type, the curve and the declared range. The wire itself
 * carries nothing but integers.
 */

import type { Parameter } from "./parameters";

/** Floats travel multiplied by this and are displayed divided by it. */
export const FLOAT_MULTIPLIER = 100;

/** Digits shown after the decimal point for a float parameter. */
export const FLOAT_DECIMALS = 2;

/**
 * The smallest wire value an exponential parameter can carry. `max ** t` never
 * reaches zero, so the bottom of the travel is 1, not the declared minimum.
 * This costs nothing: every exponential parameter is an envelope time in
 * milliseconds and none of them defaults to 0.
 */
const EXPONENTIAL_WIRE_MIN = 1;

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** The declared bound as it travels: floats multiplied by 100, integers as is. */
function toWire(parameter: Parameter, value: number): number {
  return parameter.dataType === "float"
    ? Math.round(value * FLOAT_MULTIPLIER)
    : Math.round(value);
}

export function wireMin(parameter: Parameter): number {
  if (parameter.curve === "exponential") return EXPONENTIAL_WIRE_MIN;
  return toWire(parameter, parameter.min);
}

export function wireMax(parameter: Parameter): number {
  return toWire(parameter, parameter.max);
}

/**
 * A position on the control's travel, `0..1`, to the integer the device gets.
 *
 * The position is deliberately **continuous**. The legacy walks an integer
 * position over `0..max`, which near the top of a 0..5000 exponential jumps
 * 4991 → 5000 and leaves 3155 of the 5000 values unreachable by any means. A
 * continuous position recovers them and changes nothing on the wire.
 */
export function positionToWire(parameter: Parameter, position: number): number {
  const low = wireMin(parameter);
  const high = wireMax(parameter);
  const t = clamp(position, 0, 1);

  if (parameter.curve === "exponential") {
    // wire = round(max ** t). At t = 0 this is exactly 1, the wire minimum;
    // on a 0..5000 parameter the first ln(1.5)/ln(5000) = 4.76% of the travel
    // all sends 1, which is a logarithmic curve allotting travel by ratio and
    // not dead travel. Do not "fix" it.
    return clamp(Math.round(high ** t), low, high);
  }

  return clamp(Math.round(low + t * (high - low)), low, high);
}

/** The inverse: the integer the device holds, to a position on the travel. */
export function wireToPosition(parameter: Parameter, wire: number): number {
  const low = wireMin(parameter);
  const high = wireMax(parameter);

  if (parameter.curve === "exponential") {
    if (wire <= EXPONENTIAL_WIRE_MIN) return 0;
    if (high <= EXPONENTIAL_WIRE_MIN) return 0;
    return clamp(Math.log(wire) / Math.log(high), 0, 1);
  }

  if (high === low) return 0;
  return clamp((wire - low) / (high - low), 0, 1);
}

/** The wire value as the user reads it: floats divided by 100, to two decimals. */
export function format(parameter: Parameter, wire: number): string {
  if (parameter.dataType === "float") {
    return (wire / FLOAT_MULTIPLIER).toFixed(FLOAT_DECIMALS);
  }
  return String(Math.round(wire));
}

/**
 * Typed text back to a wire value, clamped into `wireMin..wireMax`.
 *
 * A comma is accepted as a decimal separator, and `null` is returned only when
 * the text is not a number at all — an out-of-range number is a number, and is
 * clamped rather than rejected.
 */
export function parse(parameter: Parameter, text: string): number | null {
  const trimmed = text.trim().replace(/,/g, ".");
  if (trimmed === "") return null;

  const value = Number(trimmed);
  if (Number.isNaN(value)) return null;

  return clamp(
    toWire(parameter, value),
    wireMin(parameter),
    wireMax(parameter),
  );
}
