/**
 * Every translation between a wire integer and what a human reads or types.
 *
 * It lives in `domain/` because all of it is parameterised by fields that live
 * here — the data type, the curve and the declared range. The wire itself
 * carries nothing but integers.
 *
 * The two tags a parameter carries, `dataType` and `curve`, are each answered
 * once by a table rather than re-tested at every call site: a scale says how a
 * declared value travels and how it reads back, a curve law says how travel
 * maps to the wire. Adding a third curve is then one entry, not a hunt for
 * every `if`.
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

/** The wire bounds of one parameter. They only ever travel together. */
interface WireRange {
  low: number;
  high: number;
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** How a declared value travels, and how a wire value reads back. */
interface ValueScale {
  toWire(value: number): number;
  format(wire: number): string;
}

const SCALES: Record<Parameter["dataType"], ValueScale> = {
  float: {
    toWire: (value) => Math.round(value * FLOAT_MULTIPLIER),
    format: (wire) => (wire / FLOAT_MULTIPLIER).toFixed(FLOAT_DECIMALS),
  },
  int: {
    toWire: (value) => Math.round(value),
    format: (wire) => String(Math.round(wire)),
  },
};

/** How a position on the control's travel maps to the wire, and back. */
interface CurveLaw {
  /** The bottom of the range, given the declared minimum already on the wire. */
  wireMin(declaredMin: number): number;
  positionToWire(position: number, range: WireRange): number;
  wireToPosition(wire: number, range: WireRange): number;
}

const CURVES: Record<Parameter["curve"], CurveLaw> = {
  linear: {
    wireMin: (declaredMin) => declaredMin,
    positionToWire: (position, { low, high }) =>
      clamp(Math.round(low + position * (high - low)), low, high),
    wireToPosition: (wire, { low, high }) =>
      high === low ? 0 : clamp((wire - low) / (high - low), 0, 1),
  },
  exponential: {
    wireMin: () => EXPONENTIAL_WIRE_MIN,
    // wire = round(max ** t). At t = 0 this is exactly 1, the wire minimum;
    // on a 0..5000 parameter the first ln(1.5)/ln(5000) = 4.76% of the travel
    // all sends 1, which is a logarithmic curve allotting travel by ratio and
    // not dead travel. Do not "fix" it.
    positionToWire: (position, { low, high }) =>
      clamp(Math.round(high ** position), low, high),
    wireToPosition: (wire, { high }) => {
      if (wire <= EXPONENTIAL_WIRE_MIN) return 0;
      if (high <= EXPONENTIAL_WIRE_MIN) return 0;
      return clamp(Math.log(wire) / Math.log(high), 0, 1);
    },
  },
};

function wireRange(parameter: Parameter): WireRange {
  return { low: wireMin(parameter), high: wireMax(parameter) };
}

export function wireMin(parameter: Parameter): number {
  const scale = SCALES[parameter.dataType];
  return CURVES[parameter.curve].wireMin(scale.toWire(parameter.min));
}

export function wireMax(parameter: Parameter): number {
  return SCALES[parameter.dataType].toWire(parameter.max);
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
  return CURVES[parameter.curve].positionToWire(
    clamp(position, 0, 1),
    wireRange(parameter),
  );
}

/** The inverse: the integer the device holds, to a position on the travel. */
export function wireToPosition(parameter: Parameter, wire: number): number {
  return CURVES[parameter.curve].wireToPosition(wire, wireRange(parameter));
}

/** The wire value as the user reads it: floats divided by 100, to two decimals. */
export function format(parameter: Parameter, wire: number): string {
  return SCALES[parameter.dataType].format(wire);
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

  const { low, high } = wireRange(parameter);
  return clamp(SCALES[parameter.dataType].toWire(value), low, high);
}
