import { useSyncExternalStore, type ReactNode } from "react";

import type { Runtime } from "../state";
import { RuntimeContext, StateContext } from "./runtimeContext";

/**
 * The one place React meets the machine.
 *
 * The runtime is a plain class that holds the transport, dispatches into the
 * reducer and performs the effects; **React is a reader, not the motor**
 * (SPEC.md 5.6). That reading is this single `useSyncExternalStore`, and the
 * state travels down as context — so no component subscribes on its own and
 * there is exactly one subscription to keep in one's head.
 *
 * The runtime is created outside React, in `main.tsx`, and handed in: a page
 * has one motor for its whole life, which neither StrictMode's double mount nor
 * a hot reload should be able to duplicate.
 */
export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: Runtime;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(
    (onChange) => runtime.subscribe(onChange),
    () => runtime.getState(),
  );

  return (
    <RuntimeContext value={runtime}>
      <StateContext value={state}>{children}</StateContext>
    </RuntimeContext>
  );
}
