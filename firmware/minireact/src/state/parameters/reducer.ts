import { BANK_ADDRESS, FIRMWARE_VERSION_ADDRESS } from "../../domain";
import { PARAMETER_COUNT } from "../../transport";
import type { ConnectionStatus } from "../connection/reducer";
import type { Effect } from "../effects";
import type { AppEvent } from "../events";

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
   * One field, not 189: the rule it serves is *per address and over time*, and
   * spread across the controls that read it, "the address under an active
   * pointer" becomes 189 pieces of local state (SPEC.md 6.1, invariant 1).
   */
  readonly held: number | null;
};

export const initialParametersState: ParametersState = {
  values: null,
  held: null,
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

export function parametersReducer(
  state: ParametersState,
  event: AppEvent,
  /**
   * The connection after this same event: the one edge between the slices runs
   * `connection → parameters` and never back, which is why the root evaluates
   * them in that order (SPEC.md 5.1, 5.5).
   */
  status: ConnectionStatus,
): { state: ParametersState; effects: Effect[] } {
  switch (event.type) {
    case "dump":
      return {
        state: {
          ...state,
          values: protectHeld(state, neutralise(event.values)),
        },
        effects: [],
      };

    case "edit": {
      if (status !== "connected" || !state.values) {
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
