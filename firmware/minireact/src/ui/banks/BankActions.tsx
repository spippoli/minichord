import { useEffect, useState } from "react";

import { BANK_ADDRESS, bankNumber, encodePreset } from "../../domain";
import { useAppState, useReadOnly, useRuntime } from "../runtimeContext";
import styles from "./Banks.module.css";

/**
 * The editing row: commit the work, or throw the bank away (SPEC.md 10.2,
 * 10.4).
 *
 * **There is no target selector, and that is the design.** The firmware's
 * `save_config` sets the current bank before reloading, so a save into another
 * bank always *moves* you — app-driven navigation through the destructive door.
 * The bank is a place you are in and the physical buttons are the only way to
 * change it (SPEC.md 10.1), so this row names the bank it is standing in and
 * offers nothing else. It is a deliberate loss of parity with the legacy's
 * dropdown, which was never a navigator: it silently redirected where your work
 * landed.
 *
 * **Confirmation scales to the blast radius, and is never a modal** (SPEC.md
 * 10.4). A save asks nothing — it is the intended act, and the LEDs have
 * already said exactly what will change. A reset arms in place: the button
 * becomes its own question, a second click executes, it disarms by itself, the
 * focus stays where the hand left it and the panel about to be wiped stays on
 * screen. A native `confirm()` is the worst option available — it steals focus,
 * cannot be themed, and has one shape for two very different gravities.
 *
 * Nothing here reports success: the device confirms all three with a dump of
 * its own, the store consumes it, and the strip says the line (SPEC.md A.3).
 * This component composes no device message.
 */

/**
 * How long the question stands before it withdraws itself.
 *
 * Long enough to read the sentence and answer it, short enough that an armed
 * destructive button is never left lying under a hand that has moved on. Every
 * gesture *inside* the question renews it — copying the preset code is part of
 * answering, not a change of subject.
 */
const ARMED_MS = 5000;

/** How long "Copied." stands. It reports a clipboard, not a device. */
const COPIED_MS = 3000;

export function BankActions() {
  const runtime = useRuntime();
  const { parameters } = useAppState();
  const readOnly = useReadOnly();

  /**
   * A token rather than a boolean: renewing it restarts the countdown, which
   * is what keeps the question standing while the escape hatch is being used.
   */
  const [armed, setArmed] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const bank = bankNumber(parameters.values?.[BANK_ADDRESS] ?? 0);
  // A command already in flight is a ~165 ms round trip (SPEC.md 10.2): a
  // second click inside it would put a second flash write on the wire.
  const busy = readOnly || parameters.pendingCommand !== null;

  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // The wire went while the question stood. Nothing can be committed now, and
  // an armed button that cannot fire is a question with no answer.
  useEffect(() => {
    if (readOnly) setArmed(null);
  }, [readOnly]);

  function renew() {
    setArmed((token) => (token ?? 0) + 1);
  }

  function reset() {
    if (armed === null) {
      renew();
      return;
    }
    setArmed(null);
    runtime.resetBank();
  }

  /**
   * The honest escape hatch of SPEC.md 10.4: undoing a bank reset is rejected
   * outright — a 254-message bulk write does not self-confirm, so a partly
   * failed undo leaves a third state that is neither the old bank nor the
   * factory one, and the optimistic store would show it as if it had worked.
   * What the app offers instead is the state about to be destroyed, in one
   * line, and it is never a mandatory step.
   *
   * A clipboard that refuses goes to the console: it is a browser permission,
   * not something the panel can ask the user to do anything about (SPEC.md
   * 9.7), and the code itself has a home of its own in the maintenance area.
   */
  function copyPresetCode() {
    const values = parameters.values;
    if (!values) return;
    renew();
    void navigator.clipboard
      .writeText(encodePreset(values))
      .then(() => setCopied(true))
      .catch(() => {
        console.warn("minichord: the clipboard refused the preset code");
      });
  }

  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.key}
        disabled={busy}
        onClick={() => runtime.saveBank()}
      >
        Save to bank {bank}
      </button>

      <button
        type="button"
        className={styles.key}
        data-armed={armed !== null}
        disabled={busy}
        onClick={reset}
      >
        {armed === null
          ? `Reset bank ${bank}`
          : `Click again to reset bank ${bank} to factory`}
      </button>

      {armed !== null && (
        <>
          <button
            type="button"
            className={styles.hatch}
            onClick={copyPresetCode}
          >
            Copy this bank&apos;s preset code first
          </button>
          {copied && <span className={styles.copied}>Copied.</span>}
        </>
      )}
    </div>
  );
}
