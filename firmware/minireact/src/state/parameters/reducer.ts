import {
  BANK_ADDRESS,
  FIRMWARE_VERSION_ADDRESS,
  defaultWire,
  visibleParameters,
  type Parameter,
} from "../../domain";
import { PARAMETER_COUNT } from "../../transport";
import type { ConnectionStatus } from "../connection/reducer";
import type { Effect } from "../effects";
import type { AppEvent, BankCommand } from "../events";

/**
 * The 256 raw wire integers, undecoded.
 *
 * Two rules govern this slice and both are here rather than anywhere else: a
 * dump overrules the store outright (SPEC.md 5.3), and the store is optimistic
 * but subordinate to the connection — with no wire, an edit would move the
 * control, change the number on screen and leave the device knowing nothing, so
 * the reducer refuses it (SPEC.md 5.2). The refusal lives here because the
 * reducer is the thing that would lie; the UI drawing the controls read-only is
 * a rendering of that fact, not the authority for it.
 */
export type ParametersState = {
  /** 256 raw values, or `null` before the first dump: no device, no state. */
  readonly values: readonly number[] | null;
  /**
   * The address under an active pointer, or `null`.
   *
   * One field, not 188: the rule it serves is *per address and over time*, and
   * spread across the controls that read it, "the address under an active
   * pointer" becomes 188 pieces of local state (SPEC.md 6.1, invariant 1).
   */
  readonly held: number | null;
  /**
   * The last state known to have been **loaded** — what "edited" is measured
   * against (SPEC.md 10.3), or `null` before the first dump.
   *
   * A dump never says where it came from, and the two species carry opposite
   * meanings: the one closing `load_config` *is* the flash file, while the one
   * answering `(0, 0)` is live state with unsaved edits included. They are told
   * apart by what caused them, never by inspecting them, so the reference is
   * captured on exactly three events: the session's first dump, a dump whose
   * bank id differs from the store's, and a dump following a save or a reset we
   * issued — the third being `pendingCommand` below.
   */
  readonly stored: readonly number[] | null;
  /**
   * The flash command we issued and the device has not answered yet, or `null`.
   *
   * The third capture case of SPEC.md 10.3, and it is one field: **issuing a
   * save or a reset raises this, and the next dump consumes it** — captures the
   * reference and clears it. The alternative an implementer reaches for without
   * it is inspecting the incoming dump to guess where it came from, which is
   * the one thing SPEC.md 10.3 has established cannot be done.
   *
   * A wipe raises it too. It is not named in the acceptance of the ticket, and
   * it must: a wipe reloads the current bank out of freshly-factory flash, so a
   * reference left standing would light every amber LED in the panel against a
   * bank that no longer exists anywhere.
   *
   * It also carries *which* command, because the line the strip owes afterwards
   * differs by command and the dump cannot say which one it is closing. The
   * flag is here rather than in `connection` because a save is not a connection
   * event, and the one edge between the slices runs the other way (SPEC.md 5.5).
   */
  readonly pendingCommand: BankCommand | null;
  /**
   * What the strip has to say about the last dump, or `null`.
   *
   * The apparent back-edge from `parameters` to the connection, and it is not
   * one: the notice is a field here and the strip is the component that reads
   * both slices (SPEC.md 5.5). It lives here because only this slice can count
   * what was lost — the connection knows the wire came back, not what the
   * values were doing while it was gone.
   *
   * Every dump sets it, to `null` when there is nothing to say. That is what
   * "stated once" means in a store: the line stands until the next dump
   * replaces it, and no timer takes it away.
   */
  readonly lastLossNotice: StripNotice | null;
};

/**
 * A line the strip owes the user about something the device did (SPEC.md A.3).
 *
 * Data, not a sentence: the wording, the bank number and the singular of
 * "1 unsaved change" are `ui/`'s, and this slice does not compose text.
 *
 * It rides on the field SPEC.md 5.5 calls `lastLossNotice`, and it is named for
 * the strip rather than for the loss: a return that cost nothing is still one
 * of these, because what the strip owes the user about a return is one line
 * either way.
 */
export type StripNotice =
  /** The device came back after an interruption (SPEC.md 9.5). */
  | {
      readonly kind: "reconnected";
      /** The raw value at address 1 in the dump that came back. */
      readonly bank: number;
      /** How many unsaved changes did not survive. Zero says nothing was lost. */
      readonly lost: number;
    }
  /**
   * A physical preset button was pressed and the work was not saved first
   * (SPEC.md 10.5).
   *
   * Only ever raised with something lost: a clean switch says nothing, because
   * the bank number and the hue have already changed in that same strip and
   * speak for themselves. The count is the dock count in the instant before the
   * dump, which is the whole of what the press threw away.
   */
  | {
      readonly kind: "bank-changed";
      readonly bank: number;
      readonly lost: number;
    }
  /** A save we issued came back (SPEC.md 10.2): ~165 ms, acknowledged once. */
  | { readonly kind: "saved"; readonly bank: number }
  /** A bank reset we issued came back. */
  | { readonly kind: "reset"; readonly bank: number }
  /** A memory wipe we issued came back. It names no bank: it took all twelve. */
  | { readonly kind: "wiped" }
  /**
   * A preset code was written and the repair round is over (SPEC.md 11.3).
   *
   * `diverged` is what two rounds of bulk write could not get to stick, and
   * zero is the ordinary case rather than the absence of news: an import is a
   * gesture with no other acknowledgement, and 189 messages that all landed are
   * worth one line.
   */
  | { readonly kind: "preset-applied"; readonly diverged: number };

export const initialParametersState: ParametersState = {
  values: null,
  held: null,
  stored: null,
  pendingCommand: null,
  lastLossNotice: null,
};

/**
 * The firmware the device reports, or 0 with no store behind it.
 *
 * One reading rather than three: the strip shows it, the readout explains a
 * slot with it and every binding asks whether its parameter exists on this
 * device. Zero is the honest answer before the first dump — every parameter is
 * then newer than what is connected, which is what "no device, no state" means
 * for availability (SPEC.md 5.2, 9.6).
 */
export function firmwareVersion(state: ParametersState): number {
  return state.values?.[FIRMWARE_VERSION_ADDRESS] ?? 0;
}

/**
 * The five slots the store holds a fiction in (SPEC.md 5.4).
 *
 * Addresses 2 and 3 are the harp and chord volumes and 4, 5, 6 the
 * potentiometer storage: they arrive carrying wherever the physical knobs
 * happen to sit, and the store overwrites them so the knobs do not fight the
 * UI. The device reads something like 114/121/128/135/142 while the store
 * insists on these. Unlike the legacy, they are never written back.
 */
export const NEUTRALISED: ReadonlyMap<number, number> = new Map([
  [2, 50],
  [3, 50],
  [4, 512],
  [5, 512],
  [6, 512],
]);

/**
 * The slots no comparison may look at (SPEC.md 5.4, 7.3).
 *
 * The five of SPEC.md 5.4 hold a fiction the store forces, so they never differ
 * and would never be edited; the firmware version is healed by the device on
 * every write. Comparing any of them says nothing about what a human changed.
 */
const OUTSIDE_COMPARISON: ReadonlySet<number> = new Set([
  ...NEUTRALISED.keys(),
  FIRMWARE_VERSION_ADDRESS,
]);

/**
 * Whether a comparison may look at this address at all.
 *
 * **This is the layer's one copy of that question**, and it is derived from
 * `NEUTRALISED` rather than restated: the two LEDs above ask it, and so does
 * `bulkWrite` (SPEC.md 5.8), whose own documentation is explicit that its three
 * callers must not each carry a list of their own. Two encodings of the same
 * six addresses — one derived, one written out — is precisely the bug that
 * exclusion exists to prevent, arriving by another door.
 */
export function isComparable(address: number): boolean {
  return !OUTSIDE_COMPARISON.has(address);
}

/**
 * Whether this address now differs from the bank as it was loaded — the amber
 * LED of SPEC.md 7.3, and the plate's edited count.
 *
 * With no reference yet nothing is edited: before the first dump there is no
 * state at all, and a value cannot differ from nothing.
 */
export function isEdited(state: ParametersState, address: number): boolean {
  if (!state.values || !state.stored) return false;
  if (!isComparable(address)) return false;
  return state.values[address] !== state.stored[address];
}

/**
 * Whether this address now differs from the value `parameters.json` declares —
 * the blue LED of SPEC.md 7.3.
 *
 * The second magnification, and it answers a different question from the amber
 * one: amber says "you will lose this if you walk away", blue says "this sound
 * is not the factory sound". They are independent — a saved bank is amber-dark
 * and blue-lit all over.
 *
 * The same five slots plus the firmware version are excluded, for the same
 * reason: the store holds a fiction there, and the fiction is nobody's factory
 * default. So is anything the panel does not draw, `PARAMETER_AT` being the
 * source: an address with no control has no LED to light, and the bank hue is
 * the one such address the wire still carries a real value at.
 */
export function differsFromDefault(
  state: ParametersState,
  address: number,
): boolean {
  if (!state.values) return false;
  if (!isComparable(address)) return false;

  const parameter = PARAMETER_AT.get(address);
  if (!parameter) return false;
  return state.values[address] !== defaultWire(parameter);
}

/**
 * The 188 parameters a panel draws, by address.
 *
 * `visibleParameters` is deliberately the source rather than every address of
 * the manifest: what the panel does not draw, the dock does not list. That
 * covers the six hidden ones — the five physical knobs, which get the dock's
 * one line rather than a row each, and the firmware version (SPEC.md 7.3) — and
 * the bank hue, which is the bank's identity rather than an edit (SPEC.md 7.4).
 *
 * It is **not** the same set as `isComparable` above, and the two must not be
 * folded together: the hue is excluded here and comparable there, because a
 * bulk write still writes address 20 and still has to judge that it landed.
 */
const PARAMETER_AT: ReadonlyMap<number, Parameter> = new Map(
  visibleParameters.map((parameter) => [parameter.address, parameter]),
);

/** One row of the dock: what it was when the bank loaded, and what it is now. */
export interface EditedParameter {
  readonly parameter: Parameter;
  readonly stored: number;
  readonly current: number;
}

/**
 * Every parameter that differs from the loaded reference, in panel order — the
 * dock's whole model, and the count SPEC.md 10.5 reports on a bank change.
 *
 * It is one selector rather than a list built in the dock because the same
 * answer is the plate's count, the strip's loss notice and the map the
 * revert-all hands to `bulkWrite`: three readers of one fact.
 */
export function editBuffer(state: ParametersState): readonly EditedParameter[] {
  const { values, stored } = state;
  if (!values || !stored) return [];

  const edited: EditedParameter[] = [];
  for (const parameter of visibleParameters) {
    if (!isEdited(state, parameter.address)) continue;
    edited.push({
      parameter,
      stored: stored[parameter.address],
      current: values[parameter.address],
    });
  }
  return edited;
}

/**
 * Every dump, solicited or not, replaces every value — then the five slots of
 * SPEC.md 5.4 are forced.
 */
function neutralise(values: readonly number[]): readonly number[] {
  const next = values.slice(0, PARAMETER_COUNT);
  for (const [address, forced] of NEUTRALISED) next[address] = forced;
  return next;
}

/**
 * The one exception to a dump overruling the store: the address under an active
 * pointer keeps the value the finger put there (SPEC.md 5.3).
 *
 * A slider that jumps out from under the cursor mid-drag is the one failure
 * that is never acceptable. And the exception has an exception: **if the dump
 * carries a different bank id, the pointer loses too** — the value under the
 * finger belonged to the previous bank, and keeping it would display a number
 * that belongs to nothing. That comparison is also the only discriminator the
 * store has, since it cannot tell a solicited dump from an announcement.
 */
function protectHeld(
  state: ParametersState,
  incoming: readonly number[],
): readonly number[] {
  const { held, values } = state;
  if (held === null || values === null) return incoming;
  if (values[BANK_ADDRESS] !== incoming[BANK_ADDRESS]) return incoming;

  const next = incoming.slice();
  next[held] = values[held];
  return next;
}

/**
 * The connection around this same event: the one edge between the slices runs
 * `connection → parameters` and never back, which is why the root evaluates
 * them in that order (SPEC.md 5.1, 5.5).
 *
 * Both sides of the event are carried because a dump is read differently
 * depending on where it lands: the one that arrives on a connection that was
 * `interrupted` a moment ago is the reconnection dump, and it is the only one
 * this slice has anything to say about (SPEC.md 9.5).
 */
export type ConnectionView = {
  /** The status after this event. */
  readonly status: ConnectionStatus;
  /** The status before it. */
  readonly before: ConnectionStatus;
};

/**
 * What the strip owes the user about the dump that just landed (SPEC.md 9.5).
 *
 * Only a reconnection speaks. A re-enumeration is a reboot: the device reloads
 * its bank from flash and the unsaved edits vanish from both sides at once,
 * while the strip would otherwise read like good news. So the fact is stated,
 * with the bank it came back on and the count.
 *
 * **The count is what the dump did not bring back, not the dock count.** A
 * reseated cable on a device that never rebooted returns the values it was
 * holding, edits included, and nothing was lost — the loss line would then be
 * an invented alarm. The two cases are told apart by the only evidence there
 * is: whether the values came back changed. That is a comparison of the dump
 * against the store, which is the same question SPEC.md 5.3 already asks.
 */
function noticeForDump(
  state: ParametersState,
  values: readonly number[],
  connection: ConnectionView,
  bankChanged: boolean,
): StripNotice | null {
  if (connection.before === "interrupted") {
    const lost = editBuffer(state).filter(
      (row) => row.current !== values[row.parameter.address],
    ).length;
    return { kind: "reconnected", bank: values[BANK_ADDRESS], lost };
  }

  const bank = values[BANK_ADDRESS];

  // **A bank change is read before a command we issued, and that order is the
  // rule.** None of the three commands moves the bank — `save_config` writes
  // the bank the device is already in — so a dump that carries a different one
  // is a physical preset button, whatever we happened to have in flight. Read
  // the other way round, a press landing inside the command window would be
  // acknowledged as `Saved to bank {the new one}`: a save into a bank nobody
  // asked for, reported as done, while the one line SPEC.md 10.5 lets past the
  // silence — what the press cost — is never said. The count is taken from the
  // state *before* this dump lands, because the dump destroys the evidence.
  if (bankChanged) {
    const lost = editBuffer(state).length;
    return lost === 0 ? null : { kind: "bank-changed", bank, lost };
  }

  // The bank did not move, so the bank in this dump is the bank the command was
  // issued against: it is the store's own, and only a dump can change it.
  switch (state.pendingCommand) {
    case "save":
      return { kind: "saved", bank };
    case "reset":
      return { kind: "reset", bank };
    case "wipe":
      return { kind: "wiped" };
  }

  return null;
}

export function parametersReducer(
  state: ParametersState,
  event: AppEvent,
  connection: ConnectionView,
): { state: ParametersState; effects: Effect[] } {
  switch (event.type) {
    case "dump": {
      const values = protectHeld(state, neutralise(event.values));
      const bankChanged =
        state.values !== null &&
        state.values[BANK_ADDRESS] !== values[BANK_ADDRESS];
      // The three capture cases of SPEC.md 10.3, in the order they were
      // written: the session's first dump, a bank that changed under us, and
      // the answer to a command we issued.
      const loaded =
        state.values === null || bankChanged || state.pendingCommand !== null;

      return {
        state: {
          ...state,
          values,
          stored: loaded ? values : state.stored,
          // Consumed, whatever it was: this dump is the answer, and a flag left
          // standing would capture a reference off the next unrelated dump.
          pendingCommand: null,
          lastLossNotice: noticeForDump(state, values, connection, bankChanged),
        },
        effects: [],
      };
    }

    case "bank-command": {
      // The same refusal an edit gets, for the same reason (SPEC.md 5.2): with
      // no wire the command reaches nothing, and the acknowledgement would be
      // about a device that never heard it.
      if (connection.status !== "connected" || !state.values) {
        return { state, effects: [] };
      }
      // **At most one flash command is in flight, and it is refused here.** The
      // flag is one field and the next dump consumes it, so a second command
      // issued inside the window would overwrite the first: one dump would be
      // read as the second one's answer and the first would be acknowledged as
      // nothing, while two flash writes overlapped on a device that erases
      // sectors. The two buttons already disable themselves, but a rule the
      // components carry is a rule three of them can forget — this is the one
      // place it can be tested (SPEC.md 5.2, 10.2).
      if (state.pendingCommand !== null) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, pendingCommand: event.command },
        effects: [
          // What is being saved is what is on screen, and a value still waiting
          // for its frame (SPEC.md 5.7) is on screen and not yet on the device.
          // Without this, a control moved in the same frame as the click is
          // written *after* the save and is exactly the edit that goes missing.
          { type: "flush-writes" },
          {
            type: "device-command",
            command: event.command,
            bank: state.values[BANK_ADDRESS],
          },
          { type: "schedule-command-timeout" },
        ],
      };
    }

    case "command-timeout":
      // The device did not answer inside the window. The flag goes, and with it
      // the disabled row: the alternative is a save the wire dropped leaving
      // the two buttons dead for the rest of the session.
      //
      // **What is given up is stated rather than repaired**: a dump arriving
      // after the window will not capture the reference, so the amber LEDs will
      // claim edits against a bank that has them. That is the same bargain the
      // bulk write already makes with its own window (SPEC.md 1.6), and it is
      // the recoverable side of the two — one more save fixes it, while a dead
      // button is fixed only by a replug.
      if (state.pendingCommand === null) return { state, effects: [] };
      return { state: { ...state, pendingCommand: null }, effects: [] };

    case "preset-applied":
      // The notice is set here and nowhere else, on an event that by
      // construction arrives *after* the dump closing the bulk write: set
      // before it, the line would be replaced by that dump's own `null` and the
      // user would be told nothing about the 189 messages they just sent.
      //
      // The reference is deliberately left alone. An import is an edit like any
      // other — flash is untouched, the physical bank button gets the saved
      // sound back — so every address it moved is owed an amber LED and a dock
      // row (SPEC.md 10.3, 11.4).
      return {
        state: {
          ...state,
          lastLossNotice: {
            kind: "preset-applied",
            diverged: event.diverged,
          },
        },
        effects: [],
      };

    case "edit": {
      if (connection.status !== "connected" || !state.values) {
        return { state, effects: [] };
      }
      const values = state.values.slice();
      values[event.address] = event.value;
      return {
        state: { ...state, values },
        effects: [
          { type: "write", address: event.address, value: event.value },
        ],
      };
    }

    case "transport-connection":
      // The wire went before the device answered. A flag carried across the gap
      // would let the reconnection dump consume it, and the strip would say
      // "saved" about the reload from flash that is precisely the loss of
      // SPEC.md 9.5.
      if (event.connected || state.pendingCommand === null) {
        return { state, effects: [] };
      }
      return { state: { ...state, pendingCommand: null }, effects: [] };

    case "pointer-down":
      return { state: { ...state, held: event.address }, effects: [] };

    case "pointer-up":
      // The end of a drag is both the end of the exception above and the one
      // moment the write policy may not wait for a frame (SPEC.md 5.7). With
      // nothing held there was no drag, and the slice stays inert.
      if (state.held === null) return { state, effects: [] };
      return {
        state: { ...state, held: null },
        effects: [{ type: "flush-writes" }],
      };

    default:
      return { state, effects: [] };
  }
}
