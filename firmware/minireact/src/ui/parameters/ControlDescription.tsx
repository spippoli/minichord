import styles from "./ControlDescription.module.css";

/**
 * The element a control's `aria-describedby` points at: the one sentence of
 * SPEC.md A.5, announced and never shown.
 *
 * It is itself `aria-hidden`: Chromium computes the description from hidden
 * text, and without this the sentence is *also* read as loose text inside the
 * plate (SPEC.md 12.5).
 *
 * There is one of these rather than one per control kind, because the decision
 * it carries is one decision — every control that answers the reader answers it
 * the same way, and the third copy of a rule is the copy that drifts. The
 * sentence itself still comes from the single producer (invariant 5); this only
 * puts it where the reader finds it.
 */
export function ControlDescription({
  id,
  sentence,
}: {
  id: string;
  sentence: string;
}) {
  return (
    <span id={id} className={styles.offscreen} aria-hidden="true">
      {sentence}
    </span>
  );
}
