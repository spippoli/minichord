import { useId, useRef, useState, type KeyboardEvent } from "react";

import {
  RHYTHM_NOTE_COUNT,
  RHYTHM_STEP_COUNT,
  decodeRhythmMask,
  describeParameter,
  isStepInCycle,
  rhythmNoteOfBit,
  rhythmVoiceOfBit,
  sequencerCell,
  type Parameter,
} from "../../domain";
import { parameterAnchor } from "../panel/focusParameter";
import { useReadoutChannel } from "../readout/readoutChannel";
import { ControlDescription } from "./ControlDescription";
import styles from "./Sequencer.module.css";
import { StateLeds, type Divergence } from "./StateLeds";
import {
  FIRST_CELL,
  moveCursor,
  sameCell,
  type SequencerCursor,
} from "./sequencerGrid";

/**
 * The sixteen rhythm masks as one step sequencer: sixteen steps across, seven
 * rows down (SPEC.md 8.3). The legacy drew them as sixteen unrelated sliders.
 *
 * **This is the declared exception to the repertoire, and the reason travels
 * with it** (SPEC.md 6.1, invariant 3): it is not a seventh kind. A column *is*
 * a parameter — one address in 220–235 — and a cell's value is a **bit**, so
 * the arrows have no quantity to move and are free for navigation. Without the
 * reason written down the exception reads as an inconsistency and gets "fixed".
 *
 * What the exception buys and what it still owes:
 *
 * - **one tab stop** for the whole grid, `role="grid"` with a roving tabindex,
 *   arrows to move, `Space` to toggle, `Home`/`End` for the ends of a row, and
 *   re-entry at the last cell touched (SPEC.md 12.4);
 * - **cells feed the readout** like any other control, saying the column's
 *   parameter plus the row's note — in the legacy arrangement only the column
 *   headers answered the pointer;
 * - the rows carry **the chord note they play and the voice they borrow**: the
 *   seven bits are seven notes, folded onto four voices by the firmware, and
 *   which pitch a row plays is `chord shuffling`'s (address 120) to say.
 *
 * `Space` is the button's own activation and is deliberately not intercepted:
 * a `keydown` handler for it would have to suppress the click the browser
 * raises on `keyup`, and the two would toggle the same bit twice.
 *
 * It reads no store — the masks and the cycle arrive from the binding
 * (invariant 1) — and it composes no text of its own, every sentence coming
 * from `describeParameter` (invariant 5).
 */

export type SequencerProps = {
  /** The sixteen column parameters, in step order: addresses 220..235. */
  columns: readonly Parameter[];
  /** Their sixteen raw masks, in the same order. */
  masks: readonly number[];
  /**
   * The two LEDs of each column, in the same order.
   *
   * A column is a parameter and a cell is a bit, so divergence is a fact about
   * the column: sixteen pairs, on the sixteen headers, and never on the 112
   * cells (SPEC.md 7.3).
   */
  divergence: readonly Divergence[];
  /** `cycle length` (address 188): how far the firmware ever reaches. */
  cycleLength: number;
  /** The device the description explains an unequipped slot against. */
  firmwareVersion: number;
  /** The slot is dead when the device is older than the parameter. */
  unequipped: boolean;
  onToggle: (step: number, note: number, on: boolean) => void;
};

const STEPS = Array.from({ length: RHYTHM_STEP_COUNT }, (_, step) => step);
const NOTES = Array.from({ length: RHYTHM_NOTE_COUNT }, (_, note) => note);

export function Sequencer({
  columns,
  masks,
  divergence,
  cycleLength,
  firmwareVersion,
  unequipped,
  onToggle,
}: SequencerProps) {
  const readout = useReadoutChannel();
  const id = useId();
  const grid = useRef<HTMLDivElement>(null);

  /**
   * The roving tabindex, and the whole of "re-entry at the last cell touched":
   * one cell of the 112 is in the tab order, and it is the one the hand left.
   */
  const [cursor, setCursor] = useState<SequencerCursor>(FIRST_CELL);

  const columnId = (step: number) => `${id}-step-${step}`;
  const rowId = (note: number) => `${id}-note-${note}`;
  const cellId = (step: number, note: number) => `${id}-cell-${step}-${note}`;

  /**
   * The arrows move the cursor, never a value, and they reach every cell —
   * including the steps past `cycle length`, which the firmware never plays but
   * the keyboard must still reach (SPEC.md 12.4).
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = moveCursor(cursor, event.key);
    if (!next) return;

    event.preventDefault();
    if (sameCell(next, cursor)) return;

    setCursor(next);
    // The 112 cells are all mounted, so the target exists before this render
    // is committed and the focus does not have to wait for one.
    grid.current
      ?.querySelector<HTMLElement>(
        `[data-step="${next.step}"][data-note="${next.note}"]`,
      )
      ?.focus();
  }

  return (
    <div
      ref={grid}
      role="grid"
      className={styles.grid}
      aria-label="rythm pattern"
      onKeyDown={onKeyDown}
    >
      {/* `display: contents` on the row wrappers does not break the
          grid → row → rowheader/gridcell → checkbox tree; this was verified
          with a real screen reader (SPEC.md 12.4). */}
      <div role="row" className={styles.row}>
        <span role="columnheader" className={styles.corner} />
        {STEPS.map((step) => (
          <span
            key={step}
            role="columnheader"
            id={columnId(step)}
            className={styles.stepHead}
            aria-label={`step ${step + 1}`}
            data-out-of-cycle={
              isStepInCycle(step, cycleLength) ? undefined : true
            }
          >
            {step + 1}
            {/* The column's two LEDs. The header is where they belong: the
                address is the column's, and 112 lit cells would say the same
                thing sixteen times over (SPEC.md 7.3). The `aria-label` above
                already names this header, so hidden decoration inside it stays
                hidden. */}
            <StateLeds divergence={divergence[step]} />
          </span>
        ))}
      </div>

      {NOTES.map((note) => (
        <div key={note} role="row" className={styles.row}>
          <span
            role="rowheader"
            id={rowId(note)}
            className={styles.noteHead}
            aria-label={`note ${rhythmNoteOfBit(note)}, voice ${rhythmVoiceOfBit(note)}`}
          >
            note {rhythmNoteOfBit(note)}
            <span className={styles.voice}>voice {rhythmVoiceOfBit(note)}</span>
          </span>

          {STEPS.map((step) => {
            const column = columns[step];
            const on = decodeRhythmMask(masks[step])[note];
            const inCycle = isStepInCycle(step, cycleLength);
            const description = describeParameter(column, {
              firmwareVersion,
              cell: sequencerCell(step, note, cycleLength),
              // The two LEDs join the sentence here as they do everywhere
              // else: a reader is told the column diverged, having no LED to
              // look at (SPEC.md 12.5, A.5).
              changedFromStoredBank: divergence[step].edited,
              differsFromDefault: divergence[step].offDefault,
            });
            const target = { address: column.address, bit: note };

            return (
              <span key={step} role="gridcell" className={styles.cell}>
                <button
                  type="button"
                  id={cellId(step, note)}
                  role="checkbox"
                  className={styles.bit}
                  aria-checked={on}
                  aria-labelledby={`${columnId(step)} ${rowId(note)}`}
                  aria-describedby={`${cellId(step, note)}-description`}
                  // Never `disabled`: that would take the cell out of the tab
                  // order and deliver its explanation to the mouse alone
                  // (SPEC.md 12.6).
                  aria-disabled={unequipped || undefined}
                  // One tab stop for the whole grid (SPEC.md 12.4).
                  tabIndex={sameCell(cursor, { step, note }) ? 0 : -1}
                  data-out-of-cycle={inCycle ? undefined : true}
                  // What the arrows find the next cell by, and the reason the
                  // key handler needs no lookup table.
                  data-step={step}
                  data-note={note}
                  // How the panel finds this column again, given only its
                  // address (invariant 6): the first row carries the anchor,
                  // so a jump from the dock or from search lands on the grid.
                  {...(note === 0 ? parameterAnchor(column.address) : {})}
                  onClick={() => {
                    if (!unequipped) onToggle(step, note, !on);
                  }}
                  onFocus={() => {
                    setCursor({ step, note });
                    readout.show("focus", target);
                  }}
                  onBlur={(event) => {
                    if (grid.current?.contains(event.relatedTarget)) return;
                    readout.clear("focus");
                  }}
                  onPointerEnter={() => readout.show("hover", target)}
                  onPointerLeave={() => readout.clear("hover")}
                />

                {/* The sentence the reader hears, from the single producer. */}
                <ControlDescription
                  id={`${cellId(step, note)}-description`}
                  sentence={description.sentence}
                />
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
