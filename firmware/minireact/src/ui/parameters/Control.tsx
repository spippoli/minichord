import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import {
  defaultWire,
  format,
  nudge,
  parse,
  positionToWire,
  wireMax,
  wireMin,
  wireToPosition,
  type Parameter,
  type ParameterDescription,
} from "../../domain";
import { parameterAnchor } from "../panel/focusParameter";
import { useReadoutChannel } from "../readout/readoutChannel";
import styles from "./Control.module.css";

/**
 * One parameter under the hand: the repertoire, and nothing about the store.
 *
 * **This component owns the whole shared repertoire of SPEC.md 8.2 and 12.2**,
 * because the six kinds must not rewrite it six times — which is precisely how
 * the focus ring came to exist on two kinds out of six with the repertoire
 * already nominally shared (SPEC.md 6.1, invariant 2). The typeable value
 * window, the arrows moving the *value*, double-click to the factory default,
 * hover-or-focus feeding the readout, the tooltip travelling as
 * `aria-describedby`, one tab stop on the body and one focus ring all live
 * here. **The kind chooses the widget in the slot and nothing else**; today
 * there is one kind, the fader, and the rest arrive in the slot marked below.
 *
 * It reads no store: the value is a prop, from the binding (invariant 1).
 */

/** The travel is continuous; the wire is not (SPEC.md 4.3). */
const POSITION_STEP = 0.0001;

/** The arrows move the value by one, and by ten with Shift (SPEC.md 8.2). */
const COARSE_STEP = 10;

export type ControlProps = {
  parameter: Parameter;
  /** The raw wire value. Never read here — it arrives from the binding. */
  value: number;
  /** The one producer's output; this component composes no text of its own. */
  description: ParameterDescription;
  /** The device is older than the parameter: the slot stays, empty. */
  unequipped: boolean;
  onChange: (value: number) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
};

export function Control({
  parameter,
  value,
  description,
  unequipped,
  onChange,
  onPointerDown,
  onPointerUp,
}: ControlProps) {
  const readout = useReadoutChannel();
  const bodyId = useId();
  const descriptionId = useId();
  const bodyRef = useRef<HTMLInputElement>(null);

  /** The draft in the value window, or `null` when the window is read-only. */
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  /** Set when the window closes by keyboard: the body is where focus belongs. */
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    bodyRef.current?.focus();
  }, [editing]);

  /** Undo the window-level pointer watch, whoever ends the drag. */
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  function change(next: number) {
    if (unequipped) return;
    onChange(next);
  }

  /**
   * The drag is watched on the window, not on the input: a pointer released
   * outside the control still ends the drag, and the store must never be left
   * holding an address under a pointer that is long gone (SPEC.md 5.3).
   */
  function beginDrag() {
    if (unequipped) return;
    release.current?.();
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      release.current = null;
      onPointerUp();
    };
    release.current = end;
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    onPointerDown();
  }

  function onBodyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const step = event.shiftKey ? COARSE_STEP : 1;
    const by = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
    };

    if (event.key in by) {
      // The arrows move the value, not the position: near the top of a 0..5000
      // exponential one step of travel is nine wire values (SPEC.md 8.2).
      event.preventDefault();
      change(nudge(parameter, value, by[event.key as keyof typeof by]));
      return;
    }

    if (event.key === "Enter") {
      // The one place focus movement is a control's business (SPEC.md 12.2).
      event.preventDefault();
      if (!unequipped) setDraft(format(parameter, value));
    }
  }

  function closeWindow(commit: boolean) {
    if (commit && draft !== null) {
      const parsed = parse(parameter, draft);
      if (parsed !== null) change(parsed);
    }
    setDraft(null);
  }

  function onWindowKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    // Escape discards the draft; it never commits it (SPEC.md 12.2).
    returnFocus.current = true;
    closeWindow(event.key === "Enter");
  }

  return (
    // Hover and focus reach the readout through the same channel, and the
    // handlers sit on the row so the value window feeds it too (invariant 4).
    <div
      className={styles.control}
      data-unequipped={unequipped || undefined}
      onPointerEnter={() =>
        readout.show("hover", { address: parameter.address })
      }
      onPointerLeave={() => readout.clear("hover")}
      onFocus={() => readout.show("focus", { address: parameter.address })}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        readout.clear("focus");
      }}
    >
      <label className={styles.name} htmlFor={bodyId}>
        {parameter.name}
      </label>
      <span className={styles.address} aria-hidden="true">
        {parameter.address}
      </span>

      {/* The slot. The kind chooses what stands here, and nothing else. */}
      <input
        ref={bodyRef}
        id={bodyId}
        className={styles.fader}
        type="range"
        // How the panel finds this control again (SPEC.md 6.1, invariant 6).
        {...parameterAnchor(parameter.address)}
        min={0}
        max={1}
        step={POSITION_STEP}
        value={wireToPosition(parameter, value)}
        aria-valuenow={value}
        aria-valuetext={format(parameter, value)}
        aria-valuemin={wireMin(parameter)}
        aria-valuemax={wireMax(parameter)}
        aria-describedby={descriptionId}
        aria-disabled={unequipped || undefined}
        onChange={(event) =>
          change(positionToWire(parameter, event.target.valueAsNumber))
        }
        onKeyDown={onBodyKeyDown}
        onPointerDown={beginDrag}
        // The other origin the dock does not offer (SPEC.md 8.2).
        onDoubleClick={() => change(defaultWire(parameter))}
      />

      {editing ? (
        <ValueWindow
          className={styles.window}
          draft={draft}
          onDraft={setDraft}
          onKeyDown={onWindowKeyDown}
          onBlur={() => closeWindow(true)}
          label={parameter.name}
        />
      ) : (
        // A read-only window is `aria-hidden`, and it is deliberately not an
        // `<output>`: that maps to `role="status"`, a live region firing on
        // every value change — the antipattern SPEC.md 12.5 rejects, and the
        // one that was already written once.
        <span
          className={styles.window}
          aria-hidden="true"
          onClick={() => {
            if (!unequipped) setDraft(format(parameter, value));
          }}
        >
          {format(parameter, value)}
        </span>
      )}

      {/* The description the reader hears, from the single producer. It is
          itself `aria-hidden`: Chromium computes the description from hidden
          text, and without this the sentence is *also* read as loose text in
          the plate (SPEC.md 12.5). */}
      <span id={descriptionId} className={styles.offscreen} aria-hidden="true">
        {description.sentence}
      </span>
    </div>
  );
}

/**
 * The value window while it is being typed in.
 *
 * Not a tab stop: `Enter` enters it and `Escape` leaves it (SPEC.md 12.2), so
 * it takes the focus when it appears and gives it back when it goes.
 */
function ValueWindow({
  className,
  draft,
  label,
  onDraft,
  onKeyDown,
  onBlur,
}: {
  className: string;
  draft: string;
  label: string;
  onDraft: (draft: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
    ref.current?.focus();
  }, []);

  return (
    <input
      ref={ref}
      className={className}
      type="text"
      inputMode="decimal"
      tabIndex={-1}
      aria-label={`${label} value`}
      value={draft}
      onChange={(event) => onDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}
