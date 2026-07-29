/**
 * The seam between the wire and everything above it.
 *
 * No Web MIDI type appears here on purpose: `MIDIInput`, `MIDIOutput` and
 * `navigator` never leave `transport/`, which is what lets `state/` be tested
 * with no DOM shim (SPEC.md 3.1, 3.2).
 */

/** An opaque handle on a port: an identity and a name, never the port itself. */
export type PortRef = { id: string; name: string };

export type TransportEvent =
  | { type: "connection"; connected: boolean }
  /** The 256 raw integers of a dump, exactly as the device sent them. */
  | { type: "dump"; values: readonly number[] }
  | { type: "error"; reason: TransportErrorReason };

/**
 * A code, never a sentence. The transport carries no user-facing string; the
 * text is composed above it, and only some of these ever reach a screen
 * (SPEC.md 3.4, 9.7).
 */
export type TransportErrorReason =
  "access-denied" | "unsupported" | "malformed-message";

export type TransportListener = (event: TransportEvent) => void;

/** Undo whatever the call that returned it did. */
export type Unsubscribe = () => void;

/**
 * The two platform entry points, injectable so tests can point the transport at
 * the simulator instead of a browser (SPEC.md 2.5).
 */
export type TransportSeams = {
  /**
   * Stands in for `navigator.requestMIDIAccess({ sysex: true })`, already
   * configured: the sysex option is the injection site's business, so no Web
   * MIDI option type crosses this seam.
   */
  requestAccess?: () => Promise<MIDIAccess>;
  /**
   * Stands in for `navigator.permissions.query({ name: 'midi', sysex: true })`,
   * reduced to its answer. Every reading taken through it is compared with the
   * previous one, which is what makes `onPermissionChange` work with no DOM.
   */
  queryPermission?: () => Promise<PermissionState>;
};
