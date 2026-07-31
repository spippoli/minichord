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

export function isRhythmAddress(address: number): boolean {
  return address >= RHYTHM_FIRST_ADDRESS && address <= RHYTHM_LAST_ADDRESS;
}

/** The address holding the mask of a sequencer step, `0..15`. */
export function rhythmStepAddress(step: number): number {
  if (!Number.isInteger(step) || step < 0 || step >= RHYTHM_STEP_COUNT) {
    throw new RangeError(`rhythm step out of range: ${step}`);
  }
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
