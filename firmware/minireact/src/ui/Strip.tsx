import { useAppState } from "./runtimeContext";
import styles from "./Strip.module.css";
import { stripLine } from "./stripLine";

/**
 * After the first dump the connection is one line of the top bar.
 *
 * It is the app's only voice for what happened to the device (SPEC.md 9.7):
 * never a modal, never an `alert()`, never a focus steal — the legacy calls
 * `focus()` and `scrollTo(0, 0)` on a disconnect and tears you out of the page.
 * It reads both slices, which is what keeps the connection status and the
 * values it describes from being severed into a third one (SPEC.md 5.5).
 *
 * Which line it is saying is `stripLine`'s, and it is a pure function of what
 * the app holds: the lines are Appendix A.3 verbatim, and the one thing about
 * them that can be wrong is exercised headless rather than by mounting this.
 *
 * **It says what happened; it never grabs the page.** A reconnection notice
 * appears here and nowhere else, and it is not a live region: a device message
 * announcing itself over whatever a reader was in the middle of would be the
 * focus steal of SPEC.md 9.7 wearing an accessibility hat.
 */
export function Strip() {
  const state = useAppState();
  const values = state.parameters.values;

  return (
    <header className={styles.strip} data-status={state.connection.status}>
      {/* The bank LED: the only element the bank hue reaches (SPEC.md 7.4). */}
      {values && <span className={styles.bankLed} aria-hidden="true" />}
      <p className={styles.line}>{stripLine(state)}</p>
    </header>
  );
}
