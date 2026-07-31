/**
 * The rhythm masks at addresses 220–235.
 *
 * Each address holds one 7-bit mask standing for one column of the sequencer:
 * address `220 + step`, and bit `k` of that mask is note `k + 1`. The seven
 * bits are seven notes of the chord, not seven voices — the firmware folds note
 * `i` onto a physical voice by `i < 4 ? i : i - 3`.
 *
 * Encoding and decoding belong here rather than in the transport, which knows
 * only 16-bit integers and nothing about what they mean.
 */

export const RHYTHM_FIRST_ADDRESS = 220;
export const RHYTHM_LAST_ADDRESS = 235;
export const RHYTHM_STEP_COUNT = RHYTHM_LAST_ADDRESS - RHYTHM_FIRST_ADDRESS + 1;
export const RHYTHM_NOTE_COUNT = 7;

/**
 * `cycle length` (address 188, range 1..16): how many of the sixteen steps the
 * firmware ever reaches. Steps past it are never played — which the grid says
 * rather than hides, without touching what they hold (SPEC.md 1.5, 8.3).
 */
export const CYCLE_LENGTH_ADDRESS = 188;

/** How many voices the chord section has, and what the seven notes fold onto. */
const CHORD_VOICE_COUNT = 4;

/** Every bit a mask may legitimately carry: 0..127. */
const MASK_BITS = (1 << RHYTHM_NOTE_COUNT) - 1;

function assertNote(note: number): void {
  if (!Number.isInteger(note) || note < 0 || note >= RHYTHM_NOTE_COUNT) {
    throw new RangeError(`rhythm note out of range: ${note}`);
  }
}

function assertStep(step: number): void {
  if (!Number.isInteger(step) || step < 0 || step >= RHYTHM_STEP_COUNT) {
    throw new RangeError(`rhythm step out of range: ${step}`);
  }
}

export function isRhythmAddress(address: number): boolean {
  return address >= RHYTHM_FIRST_ADDRESS && address <= RHYTHM_LAST_ADDRESS;
}

/** The address holding the mask of a sequencer step, `0..15`. */
export function rhythmStepAddress(step: number): number {
  assertStep(step);
  return RHYTHM_FIRST_ADDRESS + step;
}

/** The step an address stands for, or `null` if it is not a rhythm address. */
export function rhythmStepOfAddress(address: number): number | null {
  return isRhythmAddress(address) ? address - RHYTHM_FIRST_ADDRESS : null;
}

/**
 * The chord note a bit stands for, counted from 1 as a musician counts.
 *
 * The seven bits are seven **notes**, not seven voices, which is the one thing
 * about this range that reads backwards from the wire (SPEC.md 1.5).
 */
export function rhythmNoteOfBit(bit: number): number {
  assertNote(bit);
  return bit + 1;
}

/**
 * The physical voice a bit borrows, counted from 1.
 *
 * The chord section has four voices and the pattern has seven notes, so the
 * firmware folds note `i` onto voice `i < 4 ? i : i - 3`: bits 0..3 keep their
 * own voice, bits 4..6 borrow voices 2..4 back again.
 */
export function rhythmVoiceOfBit(bit: number): number {
  assertNote(bit);
  return bit < CHORD_VOICE_COUNT ? bit + 1 : bit - CHORD_VOICE_COUNT + 2;
}

/**
 * Whether the firmware ever reaches this step, given `cycle length`.
 *
 * Steps past the cycle stay editable and stay reachable: the grid marks them,
 * and shortening the cycle destroys nothing (SPEC.md 8.3).
 */
export function isStepInCycle(step: number, cycleLength: number): boolean {
  return step < cycleLength;
}

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

/**
 * The cell a step and a bit stand for, both counted from 0 as the wire counts
 * them, in the words the description is written in.
 *
 * One producer, for the same reason the sentences have one (invariant 5): the
 * grid builds a cell for every square it draws and the readout builds one for
 * whatever is under the hand, and the +1 both of them owe the human belongs in
 * neither of them.
 */
export function sequencerCell(
  step: number,
  bit: number,
  cycleLength: number,
): SequencerCell {
  assertStep(step);
  return {
    step: step + 1,
    note: rhythmNoteOfBit(bit),
    outOfCycle: !isStepInCycle(step, cycleLength),
  };
}

/**
 * The same cell, found from what the readout is handed: an address and, only
 * when the target is a cell, the bit it stands for.
 *
 * Nothing but a sequencer cell carries a bit, so this answers `undefined` for
 * the other 173 controls and their where-line is unchanged.
 */
export function sequencerCellOfAddress(
  address: number,
  bit: number | undefined,
  cycleLength: number,
): SequencerCell | undefined {
  if (bit === undefined) return undefined;
  const step = rhythmStepOfAddress(address);
  return step === null ? undefined : sequencerCell(step, bit, cycleLength);
}

/**
 * A mask to its seven notes, lowest bit first. Bits above the seventh are
 * ignored: `parameters.json` declares `max_value: 128` where a 7-bit mask tops
 * out at 127, so a value carrying bit 7 is possible on the wire and means
 * nothing.
 */
export function decodeRhythmMask(mask: number): boolean[] {
  const notes: boolean[] = [];
  for (let note = 0; note < RHYTHM_NOTE_COUNT; note += 1) {
    notes.push((mask & (1 << note)) !== 0);
  }
  return notes;
}

/** Seven notes back to a mask in `0..127`. */
export function encodeRhythmMask(notes: readonly boolean[]): number {
  if (notes.length !== RHYTHM_NOTE_COUNT) {
    throw new RangeError(
      `a rhythm mask holds ${RHYTHM_NOTE_COUNT} notes, got ${notes.length}`,
    );
  }
  let mask = 0;
  for (let note = 0; note < RHYTHM_NOTE_COUNT; note += 1) {
    if (notes[note]) mask |= 1 << note;
  }
  return mask;
}

/** The mask with one note switched on or off, the others left alone. */
export function withRhythmNote(
  mask: number,
  note: number,
  on: boolean,
): number {
  assertNote(note);
  const bit = 1 << note;
  return (on ? mask | bit : mask & ~bit) & MASK_BITS;
}
