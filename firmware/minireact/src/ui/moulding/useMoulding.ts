import { useMemo, useSyncExternalStore } from "react";

import {
  DARK_MOULDING_QUERY,
  mouldingOf,
  observeMoulding,
  type Moulding,
} from "./moulding";

/**
 * The moulding the panel root wears, kept in step with the OS (SPEC.md 7.4).
 *
 * `useSyncExternalStore` is the whole of it: the media query *is* an external
 * store, with a subscribe and a snapshot already shaped for it, and reading it
 * that way means no effect writes a piece of state that the first paint would
 * otherwise have to be wrong about.
 */
export function useMoulding(): Moulding {
  const media = useMemo(() => window.matchMedia(DARK_MOULDING_QUERY), []);

  return useSyncExternalStore(
    (notify) => observeMoulding(media, notify),
    () => mouldingOf(media),
  );
}
