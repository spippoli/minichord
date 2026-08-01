import { useCallback, useEffect, useRef, useState } from "react";

import { BANK_ADDRESS, bankNumber, encodePresetCode } from "../../domain";
import { useAppState, useReadOnly, useRuntime } from "../runtimeContext";
import { ARMED_MS, COPIED_MS } from "./arming";
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
 * **Nothing here takes the focus away either**, which is the same rule read
 * from the other side (SPEC.md 9.7, 10.4). A command in flight leaves both keys
 * mounted and focusable and refuses the click instead — `disabled` on the key
 * the hand just pressed drops focus to `<body>` for the length of a round trip
 * and never gives it back, on the app's most common gesture. When the question
 * withdraws itself, whatever it had put on screen goes with it, so the focus is
 * handed back to the key that raised it rather than dropped.
 *
 * Nothing here reports success: the device confirms all three with a dump of
 * its own, the store consumes it, and the strip says the line (SPEC.md A.3).
 * This component composes no device message.
 */
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
  const rowRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);

  const bank = bankNumber(parameters.values?.[BANK_ADDRESS] ?? 0);
  // A command already in flight is a ~165 ms round trip (SPEC.md 10.2): a
  // second click inside it would put a second flash write on the wire. The
  // reducer refuses it too, and that is where the rule lives; this only stops
  // the row from looking as though it would work.
  const busy = readOnly || parameters.pendingCommand !== null;

  /**
   * The question withdraws itself, and takes the focus back with it.
   *
   * The escape hatch unmounts with the question, so a reader standing on it
   * would be left on `<body>` by something it did not start — a timer running
   * out, or the wire going. The key that raised the question is where the hand
   * was a moment ago, and the only honest place to be put back to. Answering
   * the question does not come through here: the key is still under the finger.
   */
  const withdraw = useCallback(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== resetRef.current &&
      rowRef.current?.contains(active)
    ) {
      resetRef.current?.focus();
    }
    setArmed(null);
  }, []);

  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(withdraw, ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed, withdraw]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // The wire went while the question stood. Nothing can be committed now, and
  // an armed button that cannot fire is a question with no answer.
  useEffect(() => {
    if (readOnly) withdraw();
  }, [readOnly, withdraw]);

  function renew() {
    setArmed((token) => (token ?? 0) + 1);
  }

  function save() {
    if (busy) return;
    runtime.saveBank();
  }

  function reset() {
    if (busy) return;
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
   * **The refusal can also be a throw rather than a rejection** — over plain
   * `http` there is no `navigator.clipboard` at all to reject — so the call is
   * made inside the chain and not before it.
   */
  function copyPresetCode() {
    const values = parameters.values;
    if (!values) return;
    renew();
    const code = encodePresetCode(values);
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(code))
      .then(() => setCopied(true))
      .catch(() => {
        console.warn("minichord: the clipboard refused the preset code");
      });
  }

  return (
    <div className={styles.actions} ref={rowRef}>
      <button
        type="button"
        className={styles.key}
        aria-disabled={busy}
        onClick={save}
      >
        Save to bank {bank}
      </button>

      <button
        type="button"
        className={styles.key}
        ref={resetRef}
        data-armed={armed !== null}
        aria-disabled={busy}
        // The button holds a question it is in the middle of asking, and a name
        // that changes under a reader standing on it is not reliably announced
        // on its own.
        aria-pressed={armed !== null}
        onClick={reset}
      >
        {armed === null
          ? `Reset bank ${bank}`
          : `Click again to reset bank ${bank} to factory`}
      </button>

      {armed !== null && (
        <button type="button" className={styles.hatch} onClick={copyPresetCode}>
          Copy this bank&apos;s preset code first
        </button>
      )}

      {/*
        The one result on this row the user asked for by clicking, so it is
        announced — the strip's rule against live regions is about messages the
        *device* starts, which arrive over whatever a reader was doing (SPEC.md
        9.7). It stands empty rather than unmounting, because a region that
        appears with its text already in it announces nothing.
      */}
      <span className={styles.copied} role="status">
        {copied ? "Copied." : ""}
      </span>
    </div>
  );
}
