import type {
  ReactNode,
  KeyboardEventHandler,
  MouseEventHandler,
  RefCallback,
} from "react";

import {
  PICKER_RESTING_VALUE,
  format,
  labelsOf,
  nudge,
  pickerTargets,
  positionToWire,
  wireMax,
  wireMin,
  wireToPosition,
  type Parameter,
} from "../../domain";
import type { ParameterAnchor } from "../panel/focusParameter";
import styles from "./Control.module.css";

/**
 * The widget that stands in the slot — and nothing else (SPEC.md 6.1,
 * invariant 2).
 *
 * **No kind opts out of the repertoire.** The typeable value window, the arrows
 * moving the value, double-click to the factory default, hover-or-focus feeding
 * the readout, the tooltip travelling as `aria-describedby`, one tab stop on
 * the body and one focus ring are all owned by `Control` and arrive here as
 * `body`, which every widget spreads onto whatever element it makes the body.
 * Six autonomous per-kind components would mean writing those rules six times
 * over — which is how the focus ring came to exist on two kinds out of six.
 *
 * What a widget adds is what its own element cannot inherit: the value
 * semantics a screen reader needs from that role, and the names a menu lists.
 */

/** What the repertoire puts on the body of every kind. */
export type BodyAttributes = ParameterAnchor & {
  id: string;
  ref: RefCallback<HTMLElement>;
  /**
   * The visible label, by id. `htmlFor` reaches the labelable elements only,
   * and the stepper's body is a `div` with `role="spinbutton"`: without this it
   * announces as an unnamed spin button, and the name is part of the repertoire
   * no kind opts out of (SPEC.md 6.1, invariant 2).
   */
  "aria-labelledby": string;
  "aria-describedby": string;
  "aria-disabled": true | undefined;
  onKeyDown: KeyboardEventHandler;
  onDoubleClick: MouseEventHandler;
};

export type SlotProps = {
  parameter: Parameter;
  /** The raw wire value. */
  value: number;
  body: BodyAttributes;
  /** Already refused on an unequipped slot; a widget never checks for itself. */
  onChange: (value: number) => void;
  /** The window-level drag watch, for the kinds that drag. */
  onDragStart: () => void;
};

/** The travel is continuous; the wire is not (SPEC.md 4.3). */
const POSITION_STEP = 0.0001;

/** The fader: the continuous majority (SPEC.md 8.1). */
export function Fader({
  parameter,
  value,
  body,
  onChange,
  onDragStart,
}: SlotProps) {
  return (
    <input
      {...body}
      className={styles.fader}
      type="range"
      min={0}
      max={1}
      step={POSITION_STEP}
      value={wireToPosition(parameter, value)}
      aria-valuenow={value}
      aria-valuetext={format(parameter, value)}
      aria-valuemin={wireMin(parameter)}
      aria-valuemax={wireMax(parameter)}
      onChange={(event) =>
        onChange(positionToWire(parameter, event.target.valueAsNumber))
      }
      onPointerDown={onDragStart}
    />
  );
}

/** The interrupter: an on/off parameter is a switch, not a two-position fader. */
export function Switch({ parameter, value, body, onChange }: SlotProps) {
  const on = value >= parameter.max;

  return (
    <button
      {...body}
      type="button"
      className={styles.rocker}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(on ? parameter.min : parameter.max)}
    >
      <span className={styles.rockerCap} aria-hidden="true" />
    </button>
  );
}

/**
 * The menu: a small enumeration whose values have names (SPEC.md 8.5).
 *
 * The labels are the domain's, in wire order, and the option's value *is* the
 * wire value. A value with no label — which the device should never send — is
 * listed as itself rather than silently snapping to a neighbour.
 *
 * The native `<select>` stands, and the conditional of SPEC.md 8.2 was looked
 * at rather than decided: `text-align: right` **does** align the closed menu in
 * Chromium, verified in the panel. The open popup is Chromium's own surface,
 * outside the page and outside a screenshot, so it was not verifiable here and
 * a hand-drawn listbox was not built for a defect nobody has seen. If the open
 * list is found to ignore the alignment, that replacement is the remedy, and it
 * changes this file only — the repertoire is above it, in `Control`.
 */
export function Menu({ parameter, value, body, onChange }: SlotProps) {
  const labels = labelsOf(parameter.address) ?? [];
  const unlabelled = value < 0 || value >= labels.length;

  return (
    <Dropdown body={body} value={value} onChange={onChange}>
      {unlabelled && <option value={value}>{format(parameter, value)}</option>}
      {labels.map((label, wire) => (
        <option key={label} value={wire}>
          {label}
        </option>
      ))}
    </Dropdown>
  );
}

/**
 * The one dropdown, worn by both menu kinds: the widget is the same box and
 * only its options differ, so the box is written once (SPEC.md 8.2 — menus are
 * right-aligned, so a plate has one edge where values are found).
 */
function Dropdown({
  body,
  value,
  onChange,
  children,
}: {
  body: BodyAttributes;
  value: number;
  onChange: (value: number) => void;
  children: ReactNode;
}) {
  return (
    <select
      {...body}
      className={styles.menu}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {children}
    </select>
  );
}

/**
 * The stepper: a small ordinal with an order but no names.
 *
 * Its `−` / `+` buttons **drop out of the tab order** (SPEC.md 12.2): the arrow
 * keys already do that work by value, and the buttons are a pointer affordance.
 * The body is the one tab stop, and carries the value as a `spinbutton` — the
 * number itself is read out of the value window beside it.
 */
export function Stepper({ parameter, value, body, onChange }: SlotProps) {
  return (
    <div
      {...body}
      className={styles.stepper}
      role="spinbutton"
      tabIndex={0}
      aria-valuenow={value}
      aria-valuetext={format(parameter, value)}
      aria-valuemin={wireMin(parameter)}
      aria-valuemax={wireMax(parameter)}
    >
      <StepKey
        label="−"
        onPress={() => onChange(nudge(parameter, value, -1))}
      />
      <StepKey label="+" onPress={() => onChange(nudge(parameter, value, 1))} />
    </div>
  );
}

/** A pointer affordance, and never a tab stop (SPEC.md 12.2). */
function StepKey({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      className={styles.stepKey}
      tabIndex={-1}
      aria-hidden="true"
      onClick={onPress}
    >
      {label}
    </button>
  );
}

/** SPEC.md A.6: what a routing slot reads when it points at nothing. */
const RESTING_TARGET = "none";

/**
 * The target picker: the four potentiometer routing slots (SPEC.md 8.4).
 *
 * It lists its targets **by name**, which the legacy does not: there you choose
 * which parameter to control by dragging a cursor over an address number. The
 * order is the spec's, **address order**, and flat: a group is not a contiguous
 * run of addresses — the global Settings group is split around MIDI — so
 * bucketing the list into groups would quietly reorder it.
 *
 * The names alone repeat across sections (`attack` and `waveform` exist in both
 * the harp and the chord), so each option carries where it comes from after its
 * name. That is the plate's own heading, said per option because a flat list
 * has no plate to announce it.
 *
 * The resting value is 0, **outside the slot's own declared minimum of 21**.
 * Nothing here clamps it into range.
 */
export function Picker({ value, body, onChange }: SlotProps) {
  const known =
    value === PICKER_RESTING_VALUE ||
    pickerTargets.some((target) => target.address === value);

  return (
    <Dropdown body={body} value={value} onChange={onChange}>
      <option value={PICKER_RESTING_VALUE}>{RESTING_TARGET}</option>
      {/* A target the manifest does not know: shown as itself, never snapped
          to a neighbour. */}
      {!known && <option value={value}>address {value}</option>}
      {pickerTargets.map((target) => (
        <option key={target.address} value={target.address}>
          {target.name} — {target.section} / {target.group}
        </option>
      ))}
    </Dropdown>
  );
}
