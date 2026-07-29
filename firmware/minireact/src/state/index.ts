/**
 * `state/` — the 256 values, the connection machine, the runtime (SPEC.md 5).
 *
 * Two pure slices with one edge between them, `connection → parameters` and
 * never back, plus the one impure thing in the layer: `Runtime`, which holds
 * the transport and performs what a reducer can only describe. Nothing here
 * imports React.
 */

export type { AppEvent } from "./events";
export type { Effect } from "./effects";

export { isCandidatePort } from "./connection/ports";
export {
  connectionReducer,
  initialConnectionState,
} from "./connection/reducer";
export type { ConnectionState, ConnectionStatus } from "./connection/reducer";

export {
  NEUTRALISED,
  initialParametersState,
  parametersReducer,
} from "./parameters/reducer";
export type { ParametersState } from "./parameters/reducer";

export { initialAppState, root } from "./reducer";
export type { AppState } from "./reducer";

export { Runtime } from "./runtime";
export type { RuntimeOptions, RuntimeTransport } from "./runtime";
