import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { decodePresetCode, encodePresetCode } from "../../domain";
import { editBuffer } from "../../state";
import { unsavedChanges } from "../counts";
import { useAppState, useReadOnly, useRuntime } from "../runtimeContext";
import { ARMED_MS, COPIED_MS } from "./arming";
import styles from "./Banks.module.css";
import { presetRejectionMessage } from "./presetMessage";

/**
 * The two preset fields of SPEC.md 11.4: the bank as a line of text that can
 * leave, and a line of text that can become the bank.
 *
 * **Plain fields, and that is the design.** The legacy does all of this through
 * `prompt()` and `alert()` — a modal to paste into, a modal to say it worked, a
 * modal to say it did not. None of them can be themed, all of them steal the
 * focus, and the one carrying the exported code hands the user a string they
 * must copy out of a dialog they cannot resize. Here the code is always on
 * screen, always current, and the refusal is written under the field that
 * caused it (SPEC.md 9.7).
 *
 * **Import arms in place only when the bank is dirty**, per the blast-radius
 * rule of SPEC.md 10.4. Flash is untouched by an import — the physical bank
 * button gets the saved sound back — so a clean bank has nothing to lose and
 * applies on the first click. A dirty one turns the button into its own
 * question carrying the count of edits about to die. The safety net is the
 * field above: it holds the code of the state that is about to be replaced.
 *
 * There is no offline branch. The whole editor exists only after the first dump
 * (SPEC.md 9.1), so there is never a moment here with no state to export; with
 * the wire out, `readOnly` refuses the apply for the same reason the reducer
 * refuses an edit.
 */
export function PresetCodes() {
  const runtime = useRuntime();
  const { parameters } = useAppState();
  const readOnly = useReadOnly();

  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  /** A token rather than a boolean, so renewing it restarts the countdown. */
  const [armed, setArmed] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  const exportId = useId();
  const importId = useId();
  const messageId = useId();

  // The code of the state on screen, recomputed only when the store moves: it
  // is 255 fields joined and base64'd, and the panel above it re-renders on
  // every pointer move of every slider.
  const code = useMemo(
    () => (parameters.values ? encodePresetCode(parameters.values) : ""),
    [parameters.values],
  );

  // Validated as you type, and an empty field is not a refusal: it is a field
  // nobody has typed in yet, and a red sentence under it would be the app
  // telling the user off for not having started.
  const reading = useMemo(
    () => (pasted.trim() === "" ? null : decodePresetCode(pasted)),
    [pasted],
  );

  const dirty = useMemo(() => editBuffer(parameters).length, [parameters]);
  const busy = readOnly || applying;
  const valid = reading?.ok === true;

  /**
   * The question withdraws itself, and nothing moves when it does.
   *
   * Unlike the bank reset, this question puts nothing extra on screen — the
   * button stays where it is and only its sentence changes — so there is no
   * focus to hand back. A name that changes under a reader standing on it is
   * why the button carries `aria-pressed` below.
   */
  const withdraw = useCallback(() => {
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

  // The wire went, or the code was edited into something else: either way the
  // question standing on screen is no longer the question that was asked.
  useEffect(() => {
    if (readOnly) withdraw();
  }, [readOnly, withdraw]);

  /**
   * A clipboard that refuses goes to the console, never to the panel: it is a
   * browser permission and there is nothing the user can do about it here
   * (SPEC.md 9.7). The field beside the button still holds the code, selectable
   * by hand, which is the fallback. The call is made *inside* the chain because
   * over plain `http` there is no `navigator.clipboard` at all to reject.
   */
  function copy() {
    if (!code) return;
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(code))
      .then(() => setCopied(true))
      .catch(() => {
        console.warn("minichord: the clipboard refused the preset code");
      });
  }

  function apply() {
    if (!reading?.ok || busy) return;
    // A clean bank has nothing to lose, so it goes on the first click. A dirty
    // one gets one question, and the second click is the answer.
    if (dirty > 0 && armed === null) {
      setArmed((token) => (token ?? 0) + 1);
      return;
    }
    setArmed(null);
    setApplying(true);
    // Nothing is reported here: the count comes back through the store and the
    // strip says the line, like every other thing the device did (SPEC.md A.3).
    void runtime.applyPreset(reading.values).finally(() => setApplying(false));
  }

  return (
    <section className={styles.presets}>
      <label className={styles.fieldLabel} htmlFor={exportId}>
        Preset code for this bank
      </label>
      <div className={styles.maintenanceRow}>
        <input
          id={exportId}
          className={`${styles.field} ${styles.codeField}`}
          type="text"
          readOnly
          value={code}
          // The field is the fallback for a clipboard that refuses, so a click
          // in it offers the whole code rather than a caret in the middle of it.
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className={styles.key} onClick={copy}>
          Copy
        </button>
        {/*
          Announced, because the user asked for it by clicking. It stands empty
          rather than unmounting: a region that appears with its text already in
          it announces nothing.
        */}
        <span className={styles.copied} role="status">
          {copied ? "Copied." : ""}
        </span>
      </div>

      <label className={styles.fieldLabel} htmlFor={importId}>
        Paste a preset code
      </label>
      <div className={styles.maintenanceRow}>
        <input
          id={importId}
          className={`${styles.field} ${styles.codeField}`}
          type="text"
          value={pasted}
          spellCheck={false}
          aria-invalid={reading !== null && !reading.ok}
          // `aria-describedby` and not a live region: the message changes on
          // every keystroke of a paste being corrected, and a region would read
          // each intermediate refusal over the typing that is fixing it.
          aria-describedby={messageId}
          onChange={(event) => {
            setPasted(event.target.value);
            // The code under the question changed, so the question is stale.
            setArmed(null);
          }}
        />
        <button
          type="button"
          className={styles.key}
          data-armed={armed !== null}
          // Never `disabled`: the apply that fires disables itself for the
          // length of a round trip, and `disabled` on the button under the hand
          // drops the focus to `<body>` and never gives it back (SPEC.md 9.7).
          aria-disabled={!valid || busy}
          aria-pressed={armed !== null}
          onClick={apply}
        >
          {applying
            ? "Applying…"
            : armed !== null
              ? `Click again to replace ${unsavedChanges(dirty).phrase}`
              : "Apply"}
        </button>
      </div>

      {/*
        Under the field that caused it, and never in an alert. It is empty far
        more often than not, and takes no space when it is.
      */}
      <p id={messageId} className={styles.refusal}>
        {reading && !reading.ok
          ? presetRejectionMessage(reading.rejection)
          : ""}
      </p>
    </section>
  );
}
