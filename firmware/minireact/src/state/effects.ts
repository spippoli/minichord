import type { PortRef } from "../transport";

/**
 * What a pure reducer asks the world to do.
 *
 * A reducer cannot await a probe, hold a one-second timer or touch the wire, so
 * it returns descriptions of those things and `runtime.ts` performs them
 * (SPEC.md 5.6). Every effect here is data: two reducers returning the same
 * effect list are the same reducer, which is what makes the connect path
 * testable without a transport at all.
 */
export type Effect =
  /** Read the permission without raising the prompt (SPEC.md 9.2). */
  | { type: "query-permission" }
  /** Call `requestMIDIAccess`. Only ever the consequence of an intent. */
  | { type: "request-access" }
  /** List the bus, filter by name, probe every candidate in parallel. */
  | { type: "discover" }
  /** Probe one port the user picked by hand. */
  | { type: "probe-port"; port: PortRef }
  | { type: "bind"; port: PortRef }
  | { type: "request-dump" }
  /** Arm the one-second retry of SPEC.md 5.9. */
  | { type: "schedule-dump-retry" }
  /** Disarm it: a dump arrived, or we gave up. */
  | { type: "cancel-dump-retry" }
  /** Put one raw value at one address on the wire. */
  | { type: "write"; address: number; value: number };
