/**
 * Where the arrows take the cursor inside the sequencer (SPEC.md 12.4).
 *
 * A module rather than component state because it is a pure fact about a
 * sixteen-by-seven rectangle and a key, and because it is the one part of the
 * grid a test can hold: SPEC.md 2.4 admits no component tests, so the rule that
 * **steps past `cycle length` stay reachable by arrow** is asserted here or
 * nowhere. Skipping them would make them editable by mouse and not by keyboard,
 * which is the exact disparity SPEC.md 12.4 exists to remove — so the cycle
 * length is deliberately not an argument of this module.
 *
 * The cursor is counted from 0, as the mask's bits and the step addresses are;
 * only what is shown and said counts from 1.
 */

import { RHYTHM_NOTE_COUNT, RHYTHM_STEP_COUNT } from "../../domain";

export interface SequencerCursor {
  /** The column, `0..15` — the parameter, at address `220 + step`. */
  step: number;
  /** The row, `0..6` — the bit of that column's mask. */
  note: number;
}

/** Where the grid is re-entered before anything has been touched. */
export const FIRST_CELL: SequencerCursor = { step: 0, note: 0 };

function clamp(value: number, limit: number): number {
  return Math.min(Math.max(value, 0), limit - 1);
}

/**
 * The cell a key moves to, or `null` when the key is not the grid's.
 *
 * The edges clamp rather than wrap: a grid that wraps moves the eye a row away
 * from where the hand asked, and nothing here is a cycle. `Home` and `End` are
 * the ends of the **row**, per SPEC.md 12.4, so they never change note.
 */
export function moveCursor(
  cursor: SequencerCursor,
  key: string,
): SequencerCursor | null {
  switch (key) {
    case "ArrowLeft":
      return { ...cursor, step: clamp(cursor.step - 1, RHYTHM_STEP_COUNT) };
    case "ArrowRight":
      return { ...cursor, step: clamp(cursor.step + 1, RHYTHM_STEP_COUNT) };
    case "ArrowUp":
      return { ...cursor, note: clamp(cursor.note - 1, RHYTHM_NOTE_COUNT) };
    case "ArrowDown":
      return { ...cursor, note: clamp(cursor.note + 1, RHYTHM_NOTE_COUNT) };
    case "Home":
      return { ...cursor, step: 0 };
    case "End":
      return { ...cursor, step: RHYTHM_STEP_COUNT - 1 };
    default:
      return null;
  }
}

/** Whether two cursors stand on the same cell. */
export function sameCell(a: SequencerCursor, b: SequencerCursor): boolean {
  return a.step === b.step && a.note === b.note;
}
