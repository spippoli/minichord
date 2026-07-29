import { useAppState } from "./runtimeContext";
import styles from "./Strip.module.css";

/** Address 1 holds the bank as 0..11; a human counts from one. */
const BANK_ADDRESS = 1;
const FIRMWARE_VERSION_ADDRESS = 7;

/**
 * After the first dump the connection is one line of the top bar.
 *
 * It is the app's only voice for what happened to the device (SPEC.md 9.7):
 * never a modal, never an `alert()`, never a focus steal — the legacy calls
 * `focus()` and `scrollTo(0, 0)` on a disconnect and tears you out of the page.
 * It reads both slices, which is what keeps the connection status and the
 * values it describes from being severed into a third one (SPEC.md 5.5).
 *
 * The lines are Appendix A.3, verbatim. The ones this ticket does not produce —
 * the reconnection notice, the bank-change loss, saves and presets — come with
 * the tickets that raise them.
 */
export function Strip() {
  const { connection, parameters } = useAppState();
  const values = parameters.values;

  const line =
    connection.status === "interrupted"
      ? "Disconnected — waiting for the minichord to come back. Your edits are on screen but cannot be sent."
      : `${connection.port?.name ?? ""} · firmware ${values?.[FIRMWARE_VERSION_ADDRESS] ?? 0} · bank ${(values?.[BANK_ADDRESS] ?? 0) + 1}`;

  return (
    <header className={styles.strip} data-status={connection.status}>
      <p className={styles.line}>{line}</p>
    </header>
  );
}
