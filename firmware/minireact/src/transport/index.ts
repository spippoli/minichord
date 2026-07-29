/**
 * `transport/` -- the wire and the platform, nothing else (SPEC.md 3).
 *
 * Nothing here imports React or `domain/`, and nothing here carries a
 * user-facing string.
 */

export { MinichordTransport } from "./minichordTransport";
export type {
  PortRef,
  TransportErrorReason,
  TransportEvent,
  TransportListener,
  TransportSeams,
  Unsubscribe,
} from "./types";
/**
 * The three facts about the wire a caller above this layer has any use for: how
 * many values a dump holds, and the range an address and a raw value live in.
 * The framing itself stays inside `transport/`.
 */
export { MAX_ADDRESS, MAX_VALUE, PARAMETER_COUNT } from "./frame";
