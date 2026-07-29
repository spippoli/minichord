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
};

export const initialParametersState: ParametersState = { values: null };

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
      return { state: { values: neutralise(event.values) }, effects: [] };

    case "edit": {
      if (status !== "connected" || !state.values) {
        return { state, effects: [] };
      }
      const values = state.values.slice();
      values[event.address] = event.value;
      return {
        state: { values },
        effects: [
          { type: "write", address: event.address, value: event.value },
        ],
      };
    }

    default:
      return { state, effects: [] };
  }
}
