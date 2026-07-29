import { createContext, useContext } from "react";

import type { AppState, Runtime } from "../state";

/**
 * The two contexts the provider fills, and the two hooks that read them.
 *
 * Separate from the component so that a file exporting components exports only
 * components — the condition Vite's fast refresh works under.
 *
 * There is one subscription to the runtime in the whole app and it lives in the
 * provider (SPEC.md 5.6); these hooks are context reads, never new
 * subscriptions.
 */
export const RuntimeContext = createContext<Runtime | null>(null);
export const StateContext = createContext<AppState | null>(null);

/** The intents a component may express: connect, retry, pick, edit. */
export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("useRuntime outside RuntimeProvider");
  return runtime;
}

/** The current state, as of the provider's last read. */
export function useAppState(): AppState {
  const state = useContext(StateContext);
  if (!state) throw new Error("useAppState outside RuntimeProvider");
  return state;
}
