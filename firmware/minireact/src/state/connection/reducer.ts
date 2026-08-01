import type { PortRef } from "../../transport";
import type { Effect } from "../effects";
import type { AppEvent } from "../events";

/**
 * The eight states of SPEC.md 9.8, as a pure reducer.
 *
 * Six of them are the gate, before the first dump; two are the strip, after it.
 * The one thing to keep in mind reading this file: **being connected means
 * having received a dump**. A bind is not a connection, and there is no
 * "port found but mute" state to dress up as success — so binding leaves the
 * status at `searching` and only a dump moves it on.
 */
export type ConnectionStatus =
  /** No `requestMIDIAccess` on this platform. A hard stop, no button. */
  | "unsupported"
  /** Permission `denied`. We never call, and we wait for the flip back. */
  | "blocked"
  /** Permission `prompt`. The Connect button, so the prompt is an act. */
  | "idle"
  /** Access granted: asking the bus, or bound and waiting for the dump. */
  | "searching"
  /** No candidate by name, or candidates stayed mute. Same thing, same remedy. */
  | "no-device"
  /** Two or more minichords answered. Legitimate, not an error. */
  | "choose"
  /** A dump has landed. */
  | "connected"
  /** The wire went away mid-session. Read-only, never back to the gate. */
  | "interrupted";

/** The six states that are the gate: everything before the first dump. */
export type GateStatus = Exclude<ConnectionStatus, "connected" | "interrupted">;

/**
 * Whether the app is still the gate.
 *
 * The split of SPEC.md 9.8 — six states before the first dump, two after — as
 * the one predicate the top-level branch of SPEC.md 9.1 is made of.
 */
export function isGateStatus(status: ConnectionStatus): status is GateStatus {
  return status !== "connected" && status !== "interrupted";
}

export type ConnectionState = {
  readonly status: ConnectionStatus;
  /** Every output port on the bus, for the manual picker of `no-device`. */
  readonly ports: readonly PortRef[];
  /** The ports that answered, when more than one did. */
  readonly candidates: readonly PortRef[];
  /** The port we bound, once one was chosen. */
  readonly port: PortRef | null;
  /** A manually picked port currently being probed. */
  readonly probing: PortRef | null;
  /** The last manual pick that stayed mute. */
  readonly mute: PortRef | null;
  /**
   * A re-probe is already out on the bus, so another one would be a second.
   *
   * Only `interrupted` needs it. Everywhere else the status is the guard — a
   * discovery moves the gate to `searching`, and the next `ports-changed` finds
   * nothing to do — but a reconnection stays `interrupted` throughout, and one
   * unplug announces both halves of the device, so the bus event arrives twice
   * for one plug.
   */
  readonly rediscovering: boolean;
  /** Dump requests still to spend before giving up (SPEC.md 5.9). */
  readonly dumpRetriesLeft: number;
};

/**
 * One retry, one second later.
 *
 * The probe's own dump was discarded (SPEC.md 3.3), so connecting costs two
 * round trips. If the second one is lost too, the port answered once and has
 * stopped answering, which is `no-device` with the same remedy as any other
 * silence.
 */
const DUMP_RETRIES = 1;

export const initialConnectionState: ConnectionState = {
  status: "idle",
  ports: [],
  candidates: [],
  port: null,
  probing: null,
  mute: null,
  rediscovering: false,
  dumpRetriesLeft: 0,
};

type Result = { state: ConnectionState; effects: Effect[] };

function unchanged(state: ConnectionState): Result {
  return { state, effects: [] };
}

/**
 * Ask for the dump, and arm the retry in case it never comes.
 *
 * The one way into the store, and the same two effects every time: the
 * automatic probe, the manual picker and every reconnection fill it by this
 * path and no other (SPEC.md 5.9).
 */
function fillStore(): Effect[] {
  return [{ type: "request-dump" }, { type: "schedule-dump-retry" }];
}

/**
 * Bind a port and start the two round trips that fill the store.
 *
 * The status it lands on is the one it came from: from the gate a bind is
 * `searching` until the dump lands, and from `interrupted` it stays
 * `interrupted` — a reconnection re-probes and re-binds by the same path as a
 * first connect (SPEC.md 9.5), and `searching` is a gate state, which a
 * mid-session disconnect may never return to (SPEC.md 9.1).
 */
function bindTo(state: ConnectionState, port: PortRef): Result {
  return {
    state: {
      ...state,
      status: state.status === "interrupted" ? "interrupted" : "searching",
      port,
      probing: null,
      mute: null,
      rediscovering: false,
      candidates: [],
      dumpRetriesLeft: DUMP_RETRIES,
    },
    effects: [{ type: "bind", port }, ...fillStore()],
  };
}

export function connectionReducer(
  state: ConnectionState,
  event: AppEvent,
): Result {
  switch (event.type) {
    case "boot":
      // A capability question, never an identity one: one message for every
      // browser without the API, and no user-agent anywhere (SPEC.md 9.2).
      return event.supported
        ? { state, effects: [{ type: "query-permission" }] }
        : { state: { ...state, status: "unsupported" }, effects: [] };

    case "permission":
      return permission(state, event.state);

    case "connect":
      if (state.status !== "idle") return unchanged(state);
      return {
        state: { ...state, status: "searching" },
        effects: [{ type: "request-access" }],
      };

    case "retry":
      if (state.status !== "no-device") return unchanged(state);
      return {
        state: { ...state, status: "searching", mute: null, probing: null },
        effects: [{ type: "discover" }],
      };

    case "access-granted":
      // A `denied` that already landed as a transport error wins: nothing
      // climbs back out of `blocked` except the permission changing.
      if (state.status !== "searching") return unchanged(state);
      return { state, effects: [{ type: "discover" }] };

    case "probe-results":
      return probeResults(state, event.answered, event.ports);

    case "pick":
      return pick(state, event.port);

    case "manual-probe-result":
      if (state.probing?.id !== event.port.id) return unchanged(state);
      if (event.answered) return bindTo(state, event.port);
      return {
        state: { ...state, probing: null, mute: event.port },
        effects: [],
      };

    case "ports-changed":
      // The exit `no-device` is waiting for: something was plugged in, so ask
      // the bus again rather than making the user press Try again.
      if (state.status === "no-device" && !state.probing) {
        return {
          state: { ...state, status: "searching", mute: null },
          effects: [{ type: "discover" }],
        };
      }
      // And the exit `interrupted` is waiting for. A re-enumeration is not the
      // same port coming back: the bus hands out new ids, so the port we hold
      // is stale and asking it for a dump would write into nothing. We ask the
      // bus again instead — statechange, re-probe, bind, dump (SPEC.md 9.5).
      // Indefinitely, and with no button: this event is the only trigger.
      if (state.status === "interrupted") {
        if (state.rediscovering) return unchanged(state);
        return {
          state: { ...state, rediscovering: true },
          effects: [{ type: "discover" }],
        };
      }
      return unchanged(state);

    case "transport-connection":
      return connectionChanged(state, event.connected);

    case "dump":
      // The only way to `connected`, from wherever we were.
      return {
        state:
          state.status === "connected"
            ? state
            : { ...state, status: "connected", dumpRetriesLeft: 0 },
        effects: [{ type: "cancel-dump-retry" }],
      };

    case "dump-timeout":
      return dumpTimeout(state);

    case "transport-error":
      // Both are answers to `requestAccess`, which is only ever asked before
      // the first dump: past it, nothing re-opens the gate (SPEC.md 9.1).
      if (state.status === "connected" || state.status === "interrupted") {
        return unchanged(state);
      }
      if (event.reason === "unsupported") {
        return { state: { ...state, status: "unsupported" }, effects: [] };
      }
      if (event.reason === "access-denied") {
        return { state: { ...state, status: "blocked" }, effects: [] };
      }
      // `malformed-message` describes a bug of ours, not a human remedy: it
      // goes to the console, not to a screen (SPEC.md 9.7).
      return unchanged(state);

    default:
      return unchanged(state);
  }
}

/**
 * The three answers of SPEC.md 9.2, and their three behaviours.
 *
 * Only the gate listens. Once a dump has landed the connection is a fact about
 * the wire, and a permission reading arriving late must not undo it.
 */
function permission(state: ConnectionState, answer: PermissionState): Result {
  if (state.status !== "idle" && state.status !== "blocked") {
    return unchanged(state);
  }
  switch (answer) {
    case "granted":
      return {
        state: { ...state, status: "searching" },
        effects: [{ type: "request-access" }],
      };
    case "denied":
      return { state: { ...state, status: "blocked" }, effects: [] };
    default:
      return { state: { ...state, status: "idle" }, effects: [] };
  }
}

/** The 0 / 1 / 2+ decision table of SPEC.md 9.3. */
function probeResults(
  state: ConnectionState,
  answered: readonly PortRef[],
  ports: readonly PortRef[],
): Result {
  if (state.status === "interrupted") {
    return reconnectTo(state, answered, ports);
  }
  if (state.status !== "searching") return unchanged(state);
  const withPorts = { ...state, ports };
  if (answered.length === 0) {
    return {
      state: { ...withPorts, status: "no-device", candidates: [], port: null },
      effects: [],
    };
  }
  if (answered.length === 1) return bindTo(withPorts, answered[0]);
  return {
    state: { ...withPorts, status: "choose", candidates: answered, port: null },
    effects: [],
  };
}

/**
 * The same answers, read mid-session: who to bind so the editor comes back.
 *
 * The gate's table does not apply here, because two of its three outcomes are
 * gate states and this may not return to the gate (SPEC.md 9.1). Silence is not
 * `no-device` — the strip already says we are waiting and we wait indefinitely
 * — and several answers are not `choose`: the user picked a port before the
 * cable moved, and being asked again for a device that never went away would be
 * a question raised by our own bookkeeping.
 *
 * So the previous binding decides, by id and then by name: a reseated cable
 * keeps its id, a re-enumeration usually keeps the name the OS invented for it.
 * Failing both, only an unambiguous single answer is bound. Anything else waits
 * for the next `statechange`, which costs nothing and invents nothing.
 */
function reconnectTo(
  state: ConnectionState,
  answered: readonly PortRef[],
  ports: readonly PortRef[],
): Result {
  const previous = state.port;
  const port =
    answered.find((candidate) => candidate.id === previous?.id) ??
    answered.find((candidate) => candidate.name === previous?.name) ??
    (answered.length === 1 ? answered[0] : null);

  // Whatever it found, this probe is over: the next bus event is a new one.
  const withPorts = { ...state, ports, rediscovering: false };
  if (!port) return { state: withPorts, effects: [] };
  return bindTo(withPorts, port);
}

function pick(state: ConnectionState, port: PortRef): Result {
  // From `choose` the port has already answered a probe; from the manual picker
  // it has not, and asking it is the whole point of the picker.
  if (state.status === "choose") return bindTo(state, port);
  if (state.status !== "no-device") return unchanged(state);
  return {
    state: { ...state, probing: port, mute: null },
    effects: [{ type: "probe-port", port }],
  };
}

function connectionChanged(state: ConnectionState, connected: boolean): Result {
  if (!connected) {
    // The gate never comes back: by now there are values worth looking at.
    if (state.status !== "connected") return unchanged(state);
    return {
      state: { ...state, status: "interrupted", rediscovering: false },
      effects: [],
    };
  }
  // The bound port coming back raises nothing of its own. It is reported from
  // the same `statechange` as `ports-changed`, which arrives first and has
  // already started the re-probe; acting on both would put two discoveries on
  // the bus for one plug, and the second would bind a port already bound.
  return unchanged(state);
}

function dumpTimeout(state: ConnectionState): Result {
  if (state.status !== "searching" && state.status !== "interrupted") {
    return unchanged(state);
  }
  if (state.dumpRetriesLeft > 0) {
    return {
      state: { ...state, dumpRetriesLeft: state.dumpRetriesLeft - 1 },
      effects: fillStore(),
    };
  }
  // Mid-session there is nothing to fall back to and the strip already says we
  // are waiting; only the gate has somewhere to go.
  if (state.status === "interrupted") return unchanged(state);
  return {
    state: { ...state, status: "no-device", port: null, candidates: [] },
    effects: [],
  };
}
