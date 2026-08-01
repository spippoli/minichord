/**
 * `state/` — the 256 values, the connection machine, the runtime (SPEC.md 5).
 *
 * Two pure slices with one edge between them, `connection → parameters` and
 * never back, plus the one impure thing in the layer: `Runtime`, which holds
 * the transport and performs what a reducer can only describe. Nothing here
 * imports React.
 *
 * What crosses the seam is what `ui/` and `main.tsx` read: the motor, and the
 * shape of what it holds. The reducers, the events and the effects are the
 * layer's own business — their tests import them by path.
 */

export { Runtime } from "./runtime";
export type { RuntimeOptions, RuntimeTransport } from "./runtime";

export type { AppState } from "./reducer";
export { isGateStatus } from "./connection/reducer";
export type {
  ConnectionState,
  ConnectionStatus,
  GateStatus,
} from "./connection/reducer";
export {
  differsFromDefault,
  editBuffer,
  firmwareVersion,
  isEdited,
} from "./parameters/reducer";
export type {
  EditedParameter,
  LossNotice,
  ParametersState,
} from "./parameters/reducer";

export type { BulkWriteResult } from "./bulkWrite";
