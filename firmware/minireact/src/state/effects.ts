import type { PortRef } from "../transport";
import type { BankCommand } from "./events";

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
  | { type: "write"; address: number; value: number }
  /**
   * Send whatever is still pending now, without waiting for the frame.
   *
   * The write policy coalesces per address and flushes once per animation
   * frame (SPEC.md 5.7); the end of a drag is the moment where waiting would
   * mean the last position of the drag is the one that got coalesced away.
   */
  | { type: "flush-writes" }
  /**
   * One of the three flash commands, at the bank the reducer read (SPEC.md
   * 10.2, 10.4).
   *
   * The bank travels on the effect rather than being read again by the runtime:
   * what is saved is the bank the state was in when the button was clicked, and
   * a second reading — after a physical preset button landed in between — would
   * be a save into a bank nobody named. A wipe carries it too and ignores it;
   * the argument of command 1 is ignored by the firmware.
   */
  | { type: "device-command"; command: BankCommand; bank: number }
  /**
   * Give the command a window, past which it is treated as unanswered.
   *
   * The flag it raises is what disables the row while a ~165 ms round trip is
   * in flight, and a dump the wire dropped would otherwise leave that row dead
   * for the rest of the session with nothing but a replug to clear it — a
   * modal progress state by accident, which SPEC.md 10.2 rules out on purpose.
   */
  | { type: "schedule-command-timeout" };
