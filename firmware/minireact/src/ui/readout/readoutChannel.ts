import { createContext, useContext } from "react";

/**
 * The one channel the readout is fed through (SPEC.md 6.1, invariant 4).
 *
 * A readout that derived its content from focus is not available: **the DOM has
 * no `activeElement` for the pointer**. Hover and focus therefore push, through
 * this and through nothing else — no control has a private path to the readout,
 * and the tooltip is reachable with no mouse at all because both sources arrive
 * identically.
 *
 * Two sources need a priority, or leaving a hover empties the strip while
 * another control still holds the keyboard focus: **hover wins, and leaving a
 * hover falls back to the focus**, never to the resting line. That is the whole
 * of the extra field of state the provider holds.
 *
 * Two contexts rather than one, for the same reason the runtime has two: the
 * channel is stable and every control reads it, while the target changes on
 * every pointer move and only the single readout reads it.
 */

export type ReadoutSource = "hover" | "focus";

/**
 * What the readout is to explain — the address, not the sentence.
 *
 * The sentence has one producer (invariant 5) and both consumers call it; a
 * pushed sentence would go stale the moment the value under the pointer changed
 * the state it describes. A sequencer cell will add its step and note here.
 */
export type ReadoutTarget = { address: number };

export type ReadoutChannel = {
  show(source: ReadoutSource, target: ReadoutTarget): void;
  clear(source: ReadoutSource): void;
};

const NO_CHANNEL: ReadoutChannel = {
  show: () => {},
  clear: () => {},
};

export const ReadoutChannelContext = createContext<ReadoutChannel>(NO_CHANNEL);
export const ReadoutTargetContext = createContext<ReadoutTarget | null>(null);

/** For a control: what it pushes to on hover and on focus. */
export function useReadoutChannel(): ReadoutChannel {
  return useContext(ReadoutChannelContext);
}

/** For the one readout: what is under the hand right now, or nothing. */
export function useReadoutTarget(): ReadoutTarget | null {
  return useContext(ReadoutTargetContext);
}
