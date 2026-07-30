import type { PortRef, TransportErrorReason } from "../transport";

/**
 * Everything that can happen to the app, as one closed union.
 *
 * Three sources feed it and the names say which: `boot`/`connect`/`pick`/
 * `retry`/`edit` come from the user or from the runtime starting up, the
 * `transport-*` and `dump` events come off the wire, and `probe-*` are the
 * answers to the effects the reducer asked for. Nothing else reaches `root`.
 */
export type AppEvent =
  /** The runtime started. `supported` is `MinichordTransport.isSupported()`. */
  | { type: "boot"; supported: boolean }
  /** A permission reading, from the first query or from a later change. */
  | { type: "permission"; state: PermissionState }
  /** The Connect button of the `idle` gate. */
  | { type: "connect" }
  /** The Try again button of the `no-device` gate. */
  | { type: "retry" }
  /** MIDI access was granted; the bus can be listed. */
  | { type: "access-granted" }
  /** The parallel probe of every candidate port has finished (SPEC.md 9.3). */
  | {
      type: "probe-results";
      /** The candidates that answered with a dump, in port order. */
      answered: readonly PortRef[];
      /** Every output port on the bus, for the manual picker. */
      ports: readonly PortRef[];
    }
  /** A port was clicked: one of the candidates, or one from the manual picker. */
  | { type: "pick"; port: PortRef }
  /** The answer to probing a manually picked port. */
  | { type: "manual-probe-result"; port: PortRef; answered: boolean }
  /** The bus changed: a port appeared or went away. */
  | { type: "ports-changed" }
  /** The bound port went away, or came back (SPEC.md 9.4, 9.5). */
  | { type: "transport-connection"; connected: boolean }
  /** 256 raw wire integers. The only way into the store (SPEC.md 5.9). */
  | { type: "dump"; values: readonly number[] }
  /** No dump arrived inside the window after a bind (SPEC.md 5.9). */
  | { type: "dump-timeout" }
  /** An operating condition the transport reports (SPEC.md 3.4). */
  | { type: "transport-error"; reason: TransportErrorReason }
  /** A control was moved: one address, one raw wire value. */
  | { type: "edit"; address: number; value: number }
  /** A pointer went down on a control: that address is now held (SPEC.md 5.3). */
  | { type: "pointer-down"; address: number }
  /** The pointer came up. There is only ever one, so it carries no address. */
  | { type: "pointer-up" };
