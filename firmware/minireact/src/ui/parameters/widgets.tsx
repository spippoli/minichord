import type {
  CSSProperties,
  KeyboardEventHandler,
  MouseEventHandler,
  RefCallback,
} from "react";

import {
  BANK_COLOR_ADDRESS,
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

/** The hue the cap and the swatch are filled with, as a custom property. */
function capHue(value: number): CSSProperties {
  return { "--cap-hue": value } as CSSProperties;
}

/** The travel is continuous; the wire is not (SPEC.md 4.3). */
const POSITION_STEP = 0.0001;

/**
 * The fader: the continuous majority, and `bank color` (SPEC.md 8.5).
 *
 * `bank color` keeps its kind — the spectrum is a rendering, not a seventh
 * kind — and gains what the data cannot express: the slot carries the spectrum,
 * the cap is filled with the chosen hue, and a swatch at full saturation sits
 * beside it, because the firmware drives the physical LED at full saturation.
 * A 0..360 fader in a grey slot asks you to drag and guess.
 */
export function Fader({
  parameter,
  value,
  body,
  onChange,
  onDragStart,
}: SlotProps) {
  const hue = parameter.address === BANK_COLOR_ADDRESS;

  const fader = (
    <input
      {...body}
      className={`${styles.fader} ${hue ? styles.spectrum : ""}`}
      type="range"
      min={0}
      max={1}
      step={POSITION_STEP}
      value={wireToPosition(parameter, value)}
      aria-valuenow={value}
      aria-valuetext={format(parameter, value)}
      aria-valuemin={wireMin(parameter)}
      aria-valuemax={wireMax(parameter)}
      style={hue ? capHue(value) : undefined}
      onChange={(event) =>
        onChange(positionToWire(parameter, event.target.valueAsNumber))
      }
      onPointerDown={onDragStart}
    />
  );

  if (!hue) return fader;

  return (
    <span className={styles.withSwatch}>
      {fader}
      <span
        className={styles.swatch}
        style={capHue(value)}
        aria-hidden="true"
      />
    </span>
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
 * The menu: a small enumeration whose values have names (SPEC.md 8.6).
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
    <select
      {...body}
      className={styles.menu}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {unlabelled && <option value={value}>{format(parameter, value)}</option>}
      {labels.map((label, wire) => (
        <option key={label} value={wire}>
          {label}
        </option>
      ))}
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
 * names alone are ambiguous — `attack` and `waveform` exist in both the harp
 * and the chord — so the options are grouped by section and group, the same
 * structural fix the plates make for a screen reader (SPEC.md 12.5).
 *
 * The resting value is 0, **outside the slot's own declared minimum of 21**.
 * Nothing here clamps it into range.
 */
export function Picker({ value, body, onChange }: SlotProps) {
  const known =
    value === PICKER_RESTING_VALUE ||
    pickerTargets.some((target) => target.address === value);

  const groups = new Map<string, Parameter[]>();
  for (const target of pickerTargets) {
    const label = `${target.section} / ${target.group}`;
    const group = groups.get(label);
    if (group) group.push(target);
    else groups.set(label, [target]);
  }

  return (
    <select
      {...body}
      className={styles.menu}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      <option value={PICKER_RESTING_VALUE}>{RESTING_TARGET}</option>
      {!known && <option value={value}>address {value}</option>}
      {[...groups].map(([label, targets]) => (
        <optgroup key={label} label={label}>
          {targets.map((target) => (
            <option key={target.address} value={target.address}>
              {target.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
