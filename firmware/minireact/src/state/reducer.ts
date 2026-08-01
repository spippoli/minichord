import {
  connectionReducer,
  initialConnectionState,
  type ConnectionState,
} from "./connection/reducer";
import type { Effect } from "./effects";
import type { AppEvent } from "./events";
import {
  initialParametersState,
  parametersReducer,
  type ParametersState,
} from "./parameters/reducer";

export type AppState = {
  readonly connection: ConnectionState;
  readonly parameters: ParametersState;
};

export const initialAppState: AppState = {
  connection: initialConnectionState,
  parameters: initialParametersState,
};

/**
 * The root: it composes the two slices and owns nothing else.
 *
 * **Evaluation order is fixed rather than left implicit: `connection` first,
 * always**, because `parameters` takes `connection.status` as an argument
 * (SPEC.md 5.1). The two slices stay separately testable — a merged reducer
 * would drag 256 values through every connection test.
 */
export function root(
  state: AppState,
  event: AppEvent,
): { state: AppState; effects: Effect[] } {
  const connection = connectionReducer(state.connection, event);
  const parameters = parametersReducer(state.parameters, event, {
    status: connection.state.status,
    before: state.connection.status,
  });

  const changed =
    connection.state !== state.connection ||
    parameters.state !== state.parameters;

  return {
    state: changed
      ? { connection: connection.state, parameters: parameters.state }
      : state,
    effects: [...connection.effects, ...parameters.effects],
  };
}
