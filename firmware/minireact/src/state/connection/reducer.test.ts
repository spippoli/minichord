import { describe, expect, it } from "vitest";

import type { PortRef } from "../../transport";
import type { Effect } from "../effects";
import type { AppEvent } from "../events";
import {
  connectionReducer,
  initialConnectionState,
  isGateStatus,
  type ConnectionState,
} from "./reducer";

const PORT_A: PortRef = { id: "a", name: "minichord MIDI 1" };
const PORT_B: PortRef = { id: "b", name: "minichord MIDI 2" };
const OTHER: PortRef = { id: "c", name: "microKORG" };

/** Feed a sequence of events and keep the last state and effect list. */
function run(
  events: readonly AppEvent[],
  from: ConnectionState = initialConnectionState,
) {
  let state = from;
  let effects: Effect[] = [];
  for (const event of events) {
    const result = connectionReducer(state, event);
    state = result.state;
    effects = result.effects;
  }
  return { state, effects };
}

const dump: AppEvent = { type: "dump", values: [] };

/** Straight to a bound-and-answering connection, the ordinary path. */
function connected(): ConnectionState {
  return run([
    { type: "boot", supported: true },
    { type: "permission", state: "granted" },
    { type: "access-granted" },
    { type: "probe-results", answered: [PORT_A], ports: [PORT_A, PORT_B] },
    dump,
  ]).state;
}

describe("capability and permission (SPEC.md 9.2)", () => {
  it("stops hard when there is no Web MIDI API, and asks nothing", () => {
    const { state, effects } = run([{ type: "boot", supported: false }]);
    expect(state.status).toBe("unsupported");
    expect(effects).toEqual([]);
  });

  it("reads the permission on boot rather than raising the prompt", () => {
    const { effects } = run([{ type: "boot", supported: true }]);
    expect(effects).toEqual([{ type: "query-permission" }]);
  });

  it("connects at once when the permission is already granted", () => {
    const { state, effects } = run([
      { type: "boot", supported: true },
      { type: "permission", state: "granted" },
    ]);
    expect(state.status).toBe("searching");
    expect(effects).toEqual([{ type: "request-access" }]);
  });

  it("waits for a click when the permission is prompt", () => {
    const { state, effects } = run([
      { type: "boot", supported: true },
      { type: "permission", state: "prompt" },
    ]);
    expect(state.status).toBe("idle");
    // Nothing is requested until the button is pressed: an unrequested prompt
    // two seconds after load is the one people deny by reflex.
    expect(effects).toEqual([]);
    expect(run([{ type: "connect" }], state).effects).toEqual([
      { type: "request-access" },
    ]);
  });

  it("never calls when the permission is denied", () => {
    const { state, effects } = run([
      { type: "boot", supported: true },
      { type: "permission", state: "denied" },
    ]);
    expect(state.status).toBe("blocked");
    expect(effects).toEqual([]);
  });

  it("leaves the blocked state on its own when the permission is flipped back", () => {
    const blocked = run([
      { type: "boot", supported: true },
      { type: "permission", state: "denied" },
    ]).state;
    const { state, effects } = run(
      [{ type: "permission", state: "granted" }],
      blocked,
    );
    expect(state.status).toBe("searching");
    expect(effects).toEqual([{ type: "request-access" }]);
  });

  it("blocks when the access request is refused, and ignores a late grant", () => {
    const refused = run([
      { type: "boot", supported: true },
      { type: "permission", state: "prompt" },
      { type: "connect" },
      { type: "transport-error", reason: "access-denied" },
    ]).state;
    expect(refused.status).toBe("blocked");
    expect(run([{ type: "access-granted" }], refused).effects).toEqual([]);
  });

  it("does not let a late permission reading undo a live connection", () => {
    const state = run(
      [{ type: "permission", state: "denied" }],
      connected(),
    ).state;
    expect(state.status).toBe("connected");
  });
});

describe("discovery (SPEC.md 9.3)", () => {
  const granted: AppEvent[] = [
    { type: "boot", supported: true },
    { type: "permission", state: "granted" },
    { type: "access-granted" },
  ];

  it("asks the bus once access is granted", () => {
    expect(run(granted).effects).toEqual([{ type: "discover" }]);
  });

  it("binds the single answer and starts the two round trips", () => {
    const { state, effects } = run([
      ...granted,
      { type: "probe-results", answered: [PORT_A], ports: [PORT_A, PORT_B] },
    ]);
    // Bound, but not connected: being connected means having received a dump.
    expect(state.status).toBe("searching");
    expect(state.port).toEqual(PORT_A);
    expect(effects).toEqual([
      { type: "bind", port: PORT_A },
      { type: "request-dump" },
      { type: "schedule-dump-retry" },
    ]);
  });

  it("offers the choice when two answer, with no invented tie-break", () => {
    const { state, effects } = run([
      ...granted,
      {
        type: "probe-results",
        answered: [PORT_A, PORT_B],
        ports: [PORT_A, PORT_B],
      },
    ]);
    expect(state.status).toBe("choose");
    expect(state.candidates).toEqual([PORT_A, PORT_B]);
    expect(state.port).toBeNull();
    expect(effects).toEqual([]);
  });

  it("binds the port clicked in choose without probing it again", () => {
    const choosing = run([
      ...granted,
      {
        type: "probe-results",
        answered: [PORT_A, PORT_B],
        ports: [PORT_A, PORT_B],
      },
    ]).state;
    const { state, effects } = run([{ type: "pick", port: PORT_B }], choosing);
    expect(state.status).toBe("searching");
    expect(state.port).toEqual(PORT_B);
    expect(effects[0]).toEqual({ type: "bind", port: PORT_B });
  });

  it("keeps every output port for the manual picker when none answers", () => {
    const { state, effects } = run([
      ...granted,
      { type: "probe-results", answered: [], ports: [PORT_A, OTHER] },
    ]);
    expect(state.status).toBe("no-device");
    expect(state.ports).toEqual([PORT_A, OTHER]);
    expect(effects).toEqual([]);
  });

  it("probes a manual pick, and says so when the port stays mute", () => {
    const empty = run([
      ...granted,
      { type: "probe-results", answered: [], ports: [PORT_A, OTHER] },
    ]).state;

    const picking = run([{ type: "pick", port: OTHER }], empty);
    expect(picking.state.probing).toEqual(OTHER);
    expect(picking.effects).toEqual([{ type: "probe-port", port: OTHER }]);

    const mute = run(
      [{ type: "manual-probe-result", port: OTHER, answered: false }],
      picking.state,
    );
    expect(mute.state.status).toBe("no-device");
    expect(mute.state.probing).toBeNull();
    expect(mute.state.mute).toEqual(OTHER);
    expect(mute.effects).toEqual([]);
  });

  it("binds a manual pick that answers", () => {
    const picking = run([
      ...granted,
      { type: "probe-results", answered: [], ports: [OTHER] },
      { type: "pick", port: OTHER },
    ]);
    const { state, effects } = run(
      [{ type: "manual-probe-result", port: OTHER, answered: true }],
      picking.state,
    );
    expect(state.port).toEqual(OTHER);
    expect(state.mute).toBeNull();
    expect(effects[0]).toEqual({ type: "bind", port: OTHER });
  });

  it("ignores the answer to a probe nobody is waiting for any more", () => {
    const empty = run([
      ...granted,
      { type: "probe-results", answered: [], ports: [PORT_A] },
    ]).state;
    const { state } = run(
      [{ type: "manual-probe-result", port: PORT_A, answered: true }],
      empty,
    );
    expect(state.status).toBe("no-device");
    expect(state.port).toBeNull();
  });

  it("re-discovers by itself when the bus changes, and on Try again", () => {
    const empty = run([
      ...granted,
      { type: "probe-results", answered: [], ports: [] },
    ]).state;

    for (const event of [
      { type: "ports-changed" } as const,
      { type: "retry" } as const,
    ]) {
      const { state, effects } = run([event], empty);
      expect(state.status).toBe("searching");
      expect(effects).toEqual([{ type: "discover" }]);
    }
  });

  it("does not re-discover under a manual probe, nor once connected", () => {
    const probing = run([
      ...granted,
      { type: "probe-results", answered: [], ports: [PORT_A] },
      { type: "pick", port: PORT_A },
    ]).state;
    expect(run([{ type: "ports-changed" }], probing).effects).toEqual([]);
    expect(run([{ type: "ports-changed" }], connected()).effects).toEqual([]);
  });
});

describe("the dump, and the one retry (SPEC.md 5.9)", () => {
  const bound = run([
    { type: "boot", supported: true },
    { type: "permission", state: "granted" },
    { type: "access-granted" },
    { type: "probe-results", answered: [PORT_A], ports: [PORT_A] },
  ]).state;

  it("only a dump reaches connected, and it disarms the retry", () => {
    const { state, effects } = run([dump], bound);
    expect(state.status).toBe("connected");
    expect(effects).toEqual([{ type: "cancel-dump-retry" }]);
  });

  it("asks a second time when the first request goes unanswered", () => {
    const { state, effects } = run([{ type: "dump-timeout" }], bound);
    expect(state.status).toBe("searching");
    expect(effects).toEqual([
      { type: "request-dump" },
      { type: "schedule-dump-retry" },
    ]);
  });

  it("gives up after exactly one retry, back to the gate's no-device", () => {
    const { state, effects } = run(
      [{ type: "dump-timeout" }, { type: "dump-timeout" }],
      bound,
    );
    expect(state.status).toBe("no-device");
    expect(state.port).toBeNull();
    expect(effects).toEqual([]);
  });
});

/** Connected, then the cable went away: read-only, and waiting (SPEC.md 9.4). */
function interrupted(): ConnectionState {
  return run([{ type: "transport-connection", connected: false }], connected())
    .state;
}

describe("mid-session (SPEC.md 9.4, 9.8)", () => {
  it("goes read-only rather than back to the gate", () => {
    const { state } = run(
      [{ type: "transport-connection", connected: false }],
      connected(),
    );
    expect(state.status).toBe("interrupted");
    expect(state.port).toEqual(PORT_A);
  });

  it("re-probes the bus when it changes, rather than asking a stale port", () => {
    const back = run([{ type: "ports-changed" }], interrupted());
    expect(back.state.status).toBe("interrupted");
    expect(back.effects).toEqual([{ type: "discover" }]);
  });

  it("binds what answered and stays interrupted until its dump lands", () => {
    // A re-enumeration: the same device, on ids the bus has just invented.
    const REBORN: PortRef = { id: "a2", name: "minichord MIDI 1" };
    const back = run(
      [
        { type: "ports-changed" },
        { type: "probe-results", answered: [REBORN], ports: [REBORN] },
      ],
      interrupted(),
    );
    expect(back.state.status).toBe("interrupted");
    expect(back.state.port).toEqual(REBORN);
    expect(back.effects).toEqual([
      { type: "bind", port: REBORN },
      { type: "request-dump" },
      { type: "schedule-dump-retry" },
    ]);
    expect(run([dump], back.state).state.status).toBe("connected");
  });

  it("puts one probe on the bus per plug, not one per announcement", () => {
    // A real bus announces both halves of the device, and one unplug is one
    // event: a second discovery would collide with the first inside its window.
    const twice = run(
      [{ type: "ports-changed" }, { type: "ports-changed" }],
      interrupted(),
    );
    expect(twice.effects).toEqual([]);

    // And the next plug is a new one, once the probe has answered.
    const answered = run(
      [
        { type: "probe-results", answered: [], ports: [] },
        { type: "ports-changed" },
      ],
      twice.state,
    );
    expect(answered.effects).toEqual([{ type: "discover" }]);
  });

  it("raises nothing of its own when the bound port reports itself back", () => {
    // One plug, one discovery: `ports-changed` comes off the same statechange
    // and has already started it.
    const back = run(
      [{ type: "transport-connection", connected: true }],
      interrupted(),
    );
    expect(back.effects).toEqual([]);
  });

  it("waits indefinitely rather than falling back to the gate, whatever answers", () => {
    const silence = run(
      [
        { type: "ports-changed" },
        { type: "probe-results", answered: [], ports: [OTHER] },
        { type: "dump-timeout" },
        { type: "dump-timeout" },
      ],
      interrupted(),
    );
    expect(silence.state.status).toBe("interrupted");
    expect(silence.state.port).toEqual(PORT_A);
  });

  it("goes back to the port it had when two answer, and asks nobody", () => {
    const OTHER_CHORD: PortRef = { id: "z", name: "minichord MIDI 1 (2)" };
    const back = run(
      [
        { type: "ports-changed" },
        {
          type: "probe-results",
          answered: [OTHER_CHORD, PORT_A],
          ports: [OTHER_CHORD, PORT_A],
        },
      ],
      interrupted(),
    );
    expect(back.state.status).toBe("interrupted");
    expect(back.state.port).toEqual(PORT_A);
    expect(back.effects[0]).toEqual({ type: "bind", port: PORT_A });
  });

  it("says nothing on screen about a malformed message", () => {
    const before = connected();
    const { state, effects } = run(
      [{ type: "transport-error", reason: "malformed-message" }],
      before,
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });

  it("never re-opens the gate, whatever the transport reports", () => {
    for (const reason of ["access-denied", "unsupported"] as const) {
      for (const from of [
        connected(),
        run([{ type: "transport-connection", connected: false }], connected())
          .state,
      ]) {
        const { state } = run([{ type: "transport-error", reason }], from);
        expect(isGateStatus(state.status)).toBe(false);
      }
    }
  });
});

describe("the gate and the editor are exclusive (SPEC.md 9.1)", () => {
  it("splits the eight states six and two, at the first dump", () => {
    const gate = [
      "unsupported",
      "blocked",
      "idle",
      "searching",
      "no-device",
      "choose",
    ] as const;
    for (const status of gate) expect(isGateStatus(status)).toBe(true);
    for (const status of ["connected", "interrupted"] as const) {
      expect(isGateStatus(status)).toBe(false);
    }
  });
});
