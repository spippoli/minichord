import styles from "./StateLeds.module.css";

/**
 * Divergence at its finest magnification, for one address (SPEC.md 7.3).
 *
 * The two answer different questions and are deliberately independent: amber
 * says "you will lose this if you walk away", blue says "this sound is not the
 * factory sound". A freshly saved bank is amber-dark and blue-lit all over.
 *
 * They are one type rather than two booleans because they are never read apart:
 * a binding computes both, the LEDs light from both, and the single producer of
 * SPEC.md 6.1 invariant 5 appends a clause for each.
 */
export type Divergence = {
  /** The amber LED: this differs from what is stored in the bank. */
  edited: boolean;
  /** The blue LED: this differs from the factory default. */
  offDefault: boolean;
};

/**
 * The pair, drawn once for the whole panel.
 *
 * Both the repertoire's controls and the sequencer's column headers light them,
 * and a column header is not a control — so the pair is its own component
 * rather than the `Control` of SPEC.md 6.2, which the grid is the declared
 * exception to (SPEC.md 6.1, invariant 3). A second copy in the grid's own
 * stylesheet is how the two would drift apart.
 *
 * They are `aria-hidden` and carry no title: the same two states are already in
 * the description sentence the reader hears, so for a reader that state had
 * never existed at all (SPEC.md 12.5, A.5).
 *
 * `className` is the caller's placement and nothing else — the LEDs own their
 * own size, shape and colour, and the layout around them is the plate's.
 */
export function StateLeds({
  divergence,
  className,
}: {
  divergence: Divergence;
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.leds} ${className}` : styles.leds}
      aria-hidden="true"
    >
      <span
        className={styles.ledEdited}
        data-lit={divergence.edited || undefined}
      />
      <span
        className={styles.ledOffDefault}
        data-lit={divergence.offDefault || undefined}
      />
    </span>
  );
}
