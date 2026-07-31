import { useMemo, useState, type ReactNode } from "react";

import {
  ReadoutChannelContext,
  ReadoutTargetContext,
  type ReadoutSource,
  type ReadoutTarget,
} from "./readoutChannel";

type Sources = Readonly<Record<ReadoutSource, ReadoutTarget | null>>;

const NOTHING: Sources = { hover: null, focus: null };

/**
 * The two fields behind the push channel, and the priority between them.
 *
 * Hover wins; leaving the hover falls back to the focus rather than to the
 * resting line (SPEC.md 6.1, invariant 4). Nothing else in the app decides
 * this, and no control knows another control exists.
 */
export function ReadoutProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<Sources>(NOTHING);

  const channel = useMemo(
    () => ({
      show(source: ReadoutSource, target: ReadoutTarget) {
        // No comparison against what is already there: `pointerenter` and
        // `focus` each fire once per control, so there is nothing to dedupe,
        // and a comparison on the address alone would drop a move between two
        // cells of one sequencer column (SPEC.md 12.4).
        setSources((previous) => ({ ...previous, [source]: target }));
      },
      clear(source: ReadoutSource) {
        setSources((previous) =>
          previous[source] === null
            ? previous
            : { ...previous, [source]: null },
        );
      },
    }),
    [],
  );

  return (
    <ReadoutChannelContext value={channel}>
      <ReadoutTargetContext value={sources.hover ?? sources.focus}>
        {children}
      </ReadoutTargetContext>
    </ReadoutChannelContext>
  );
}
