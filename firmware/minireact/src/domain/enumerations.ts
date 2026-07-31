/**
 * The fourteen addresses whose values have names (SPEC.md 8.6).
 *
 * This is the one part of the taxonomy that is genuinely written by hand: a
 * range in `parameters.json` says a waveform is 0..11, and nothing in the file
 * says that 4 is a bandlimited pulse. **No label here was invented** — the
 * waveforms come from the `waveform_array` comments in `firmware/src/main.cpp`
 * and are confirmed verbatim in every waveform tooltip, the key signatures and
 * the two shufflings come from the same file's arrays. The strings themselves
 * are normative: SPEC.md A.8.
 *
 * The labels live here rather than in `parameters.json` because the JSON is the
 * generator's input and also emits the firmware's C++ switch (SPEC.md 8.1): the
 * taxonomy is client-side and leaves that file untouched.
 */

/** The twelve waveforms, in wire order. The shape is the label. */
const WAVEFORMS = [
  "sine",
  "sawtooth",
  "square",
  "triangle",
  "bandlimited pulse",
  "pulse",
  "reverse sawtooth",
  "sample and hold",
  "variable triangle",
  "bandlimited sawtooth",
  "reverse bandlimited sawtooth",
  "bandlimited square",
] as const;

/** The twelve key signatures, in wire order: the circle of fifths. */
const KEY_SIGNATURES = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F",
  "B♭",
  "E♭",
  "A♭",
  "D♭",
  "G♭",
] as const;

/** The seven harp shufflings (address 40), in wire order. */
const HARP_SHUFFLINGS = [
  "triad, three octaves",
  "add the seconds",
  "add the fourth",
  "add the sixth",
  "barry harris",
  "chromatic",
  "keymaster / barry harris",
] as const;

/** The six chord shufflings (address 120), in wire order. */
const CHORD_SHUFFLINGS = [
  "normal",
  "octave up, chromatics",
  "octave up, low chord notes",
  "octave up, low fifth + low chromatics",
  "octave up, low fifth + high chromatics",
  "two octaves up",
] as const;

/**
 * The eleven addresses carrying a waveform: the harp oscillator, its tremolo,
 * its vibrato, its output filter LFO and its transient, then the chord's three
 * oscillators, its filter LFO, its tremolo and its vibrato.
 */
const WAVEFORM_ADDRESSES = [42, 59, 62, 93, 100, 122, 125, 128, 152, 156, 160];

/** Address to labels, indexed by the wire value itself. */
export const ENUMERATIONS: ReadonlyMap<number, readonly string[]> = new Map([
  ...WAVEFORM_ADDRESSES.map(
    (address) => [address, WAVEFORMS] as [number, readonly string[]],
  ),
  [35, KEY_SIGNATURES] as [number, readonly string[]],
  [40, HARP_SHUFFLINGS] as [number, readonly string[]],
  [120, CHORD_SHUFFLINGS] as [number, readonly string[]],
]);

/** The names of an address's values, or `undefined` if it carries a quantity. */
export function labelsOf(address: number): readonly string[] | undefined {
  return ENUMERATIONS.get(address);
}
