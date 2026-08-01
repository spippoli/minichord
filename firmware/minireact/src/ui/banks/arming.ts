/**
 * The two windows the bank area holds open, shared by the gestures that arm in
 * place (SPEC.md 10.4, 11.4).
 *
 * They are constants in a module of their own because two components read them
 * — the bank reset and the preset import — and a file that exports a component
 * may export nothing else if Vite's fast refresh is to work. Two spellings of
 * "five seconds" would be two questions withdrawing at different moments on the
 * same screen.
 */

/**
 * How long an armed question stands before it withdraws itself.
 *
 * Long enough to read the sentence and answer it, short enough that an armed
 * destructive button is never left lying under a hand that has moved on. Every
 * gesture *inside* the question renews it — copying the preset code is part of
 * answering, not a change of subject.
 */
export const ARMED_MS = 5000;

/** How long "Copied." stands. It reports a clipboard, not a device. */
export const COPIED_MS = 3000;
