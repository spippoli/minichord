import { describe, expect, it, vi } from "vitest";

import {
  BANK_ADDRESS,
  FIRMWARE_VERSION_ADDRESS,
  MinichordSimulator,
  SIMULATED_FIRMWARE_VERSION,
} from "../dev/simulator";
import {
  MinichordTransport,
  PARAMETER_COUNT,
  type PortRef,
  type TransportEvent,
  type Unsubscribe,
} from "../transport";
import { Runtime, type RuntimeTransport } from "./runtime";

/**
 * The whole connect path, headless.
 *
 * Nothing here mounts React, and nothing here stubs the transport out on the
 * happy paths: the runtime drives the real `MinichordTransport` against the
 * simulator's fake bus, so the probe, the two round trips and the reconnection
 * are exercised through the same code the browser runs (SPEC.md 5.6, 2.5).
 */

function makeSimulator(portNames?: readonly [string, string]) {
  return new MinichordSimulator({ realisticTiming: false, portNames });
}

type Harness = {
  runtime: Runtime;
  transport: MinichordTransport;
  simulator: MinichordSimulator;
  accessCalls: () => number;
  setPermission: (state: PermissionState) => Promise<void>;
  /** Run the frame the write policy is waiting for, if it asked for one. */
  frame: () => void;
};

function harness(
  options: {
    simulator?: MinichordSimulator;
    permission?: PermissionState;
  } = {},
): Harness {
  const simulator = options.simulator ?? makeSimulator();
  let permission: PermissionState = options.permission ?? "granted";
  let accessCalls = 0;
  // The animation frame, held by hand: there is no rAF in the test
  // environment, and the point of the policy is *when* the wire is touched.
  let pendingFrame: (() => void) | null = null;

  const transport = new MinichordTransport({
    requestAccess: () => {
      accessCalls += 1;
      return simulator.requestAccess({ sysex: true });
    },
    queryPermission: () => Promise.resolve(permission),
  });

  return {
    // The windows are shortened, not removed: a mute candidate holds the
    // parallel fan-out open for the whole window, and 1 s per test is a second
    // spent proving nothing. The real numbers are asserted below, once.
    runtime: new Runtime(transport, {
      supported: true,
      probeTimeoutMs: 25,
      dumpRetryMs: 50,
      bulkDumpTimeoutMs: 200,
      scheduleFlush: (flush) => {
        pendingFrame = flush;
        return () => {
          pendingFrame = null;
        };
      },
    }),
    transport,
    simulator,
    accessCalls: () => accessCalls,
    frame: () => {
      const flush = pendingFrame;
      pendingFrame = null;
      flush?.();
    },
    /** Flip the permission as site settings would, then let it be noticed. */
    setPermission: async (state) => {
      permission = state;
      await transport.queryPermission();
    },
  };
}

/** Let promise chains and the simulator's microtask answers land. */
async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect.fail("the runtime never reached the expected state");
}

function statusOf(runtime: Runtime) {
  return runtime.getState().connection.status;
}

async function connect(h: Harness): Promise<void> {
  h.runtime.start();
  await until(() => statusOf(h.runtime) === "connected");
}

describe("the ordinary path: one minichord, permission already granted", () => {
  it("connects by itself and fills the store from the dump", async () => {
    const h = harness();
    await connect(h);

    const { connection, parameters } = h.runtime.getState();
    expect(connection.port?.name).toBe("minichord MIDI 1");
    expect(parameters.values).toHaveLength(PARAMETER_COUNT);
    expect(parameters.values?.[FIRMWARE_VERSION_ADDRESS]).toBe(
      SIMULATED_FIRMWARE_VERSION,
    );
    expect(parameters.values?.[BANK_ADDRESS]).toBe(0);
  });

  it("holds nothing at all until that dump lands", async () => {
    const h = harness();
    expect(h.runtime.getState().parameters.values).toBeNull();
    h.runtime.start();
    // The probe's own dump is discarded by the transport, so it cannot fill the
    // store: only the request that follows the bind does (SPEC.md 5.9).
    await until(() => statusOf(h.runtime) === "searching");
    await connect(h);
    expect(h.runtime.getState().parameters.values).not.toBeNull();
  });

  it("neutralises the five knob slots on every dump, without writing them back", async () => {
    const h = harness();
    await connect(h);

    // Stand in for the physical knobs having moved: the device now reports
    // something else in those five slots than the fiction the store holds.
    const drift = new Map([
      [2, 114],
      [3, 121],
      [4, 128],
      [5, 135],
      [6, 142],
    ]);
    for (const [address, value] of drift)
      h.runtime.setParameter(address, value);
    expect(h.runtime.getState().parameters.values?.[2]).toBe(114);
    h.frame();

    h.transport.requestDump();
    await until(() => h.runtime.getState().parameters.values?.[2] === 50);

    const values = h.runtime.getState().parameters.values;
    expect([2, 3, 4, 5, 6].map((at) => values?.[at])).toEqual([
      50, 50, 512, 512, 512,
    ]);
    // The device still reads what it read: the fiction is the store's alone,
    // and unlike the legacy nothing is sent back to make them agree.
    const device = h.simulator.device.snapshot();
    for (const [address, value] of drift) expect(device[address]).toBe(value);
  });

  it("lets a later unsolicited dump overrule the store", async () => {
    const h = harness();
    await connect(h);
    h.runtime.setParameter(40, 999);
    expect(h.runtime.getState().parameters.values?.[40]).toBe(999);

    h.simulator.pressPresetButton(1);
    await until(
      () => h.runtime.getState().parameters.values?.[BANK_ADDRESS] === 1,
    );
    expect(h.runtime.getState().parameters.values?.[40]).not.toBe(999);
  });

  it("notifies its subscribers, and stops when they leave", async () => {
    const h = harness();
    const listener = vi.fn();
    const unsubscribe = h.runtime.subscribe(listener);
    await connect(h);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const before = listener.mock.calls.length;
    h.runtime.setParameter(40, 12);
    expect(listener.mock.calls.length).toBe(before);
  });
});

describe("access (SPEC.md 9.2)", () => {
  it("shows the Connect button on prompt and asks for nothing before the click", async () => {
    const h = harness({ permission: "prompt" });
    h.runtime.start();
    await until(() => statusOf(h.runtime) === "idle");
    expect(h.accessCalls()).toBe(0);

    h.runtime.connect();
    await until(() => statusOf(h.runtime) === "connected");
    expect(h.accessCalls()).toBe(1);
  });

  it("never calls when denied, and recovers when the permission is flipped back", async () => {
    const h = harness({ permission: "denied" });
    h.runtime.start();
    await until(() => statusOf(h.runtime) === "blocked");
    expect(h.accessCalls()).toBe(0);

    await h.setPermission("granted");
    await until(() => statusOf(h.runtime) === "connected");
    expect(h.accessCalls()).toBe(1);
  });

  it("is a hard stop where there is no Web MIDI API", () => {
    const h = harness();
    const runtime = new Runtime(h.transport, { supported: false });
    runtime.start();
    expect(statusOf(runtime)).toBe("unsupported");
    expect(h.accessCalls()).toBe(0);
  });
});

describe("discovery (SPEC.md 9.3)", () => {
  it("lets the user choose when two minichords answer", async () => {
    // Two buses, two devices: the second answers on its own control port.
    const first = makeSimulator();
    const second = makeSimulator(["minichord MIDI 3", "minichord MIDI 4"]);
    const h = harness({ simulator: first });
    mergeBuses(first, second);

    h.runtime.start();
    await until(() => statusOf(h.runtime) === "choose");
    const candidates = h.runtime.getState().connection.candidates;
    expect(candidates.map((port) => port.name)).toEqual([
      "minichord MIDI 1",
      "minichord MIDI 3",
    ]);

    h.runtime.pick(candidates[1]);
    await until(() => statusOf(h.runtime) === "connected");
    expect(h.runtime.getState().connection.port?.name).toBe("minichord MIDI 3");
  });

  it("offers every output port when no name matches, and binds a manual pick", async () => {
    const h = harness({ simulator: makeSimulator(["Synth A", "Synth B"]) });
    h.runtime.start();
    await until(() => statusOf(h.runtime) === "no-device");
    expect(h.runtime.getState().connection.ports.map((p) => p.name)).toEqual([
      "Synth A",
      "Synth B",
    ]);

    const control = h.runtime
      .getState()
      .connection.ports.find((port) => port.name === "Synth A")!;
    h.runtime.pick(control);
    await until(() => statusOf(h.runtime) === "connected");
    expect(h.runtime.getState().parameters.values).not.toBeNull();
  });

  it("says so when a manually picked port stays mute, and stays disconnected", async () => {
    const h = harness({ simulator: makeSimulator(["Synth A", "Synth B"]) });
    h.runtime.start();
    await until(() => statusOf(h.runtime) === "no-device");

    const mute = h.runtime
      .getState()
      .connection.ports.find((port) => port.name === "Synth B")!;
    h.runtime.pick(mute);
    expect(h.runtime.getState().connection.probing?.name).toBe("Synth B");

    await until(() => h.runtime.getState().connection.mute !== null);
    expect(statusOf(h.runtime)).toBe("no-device");
    expect(h.runtime.getState().parameters.values).toBeNull();
  });

  it("re-discovers on its own when something is plugged in", async () => {
    const h = harness({ simulator: makeSimulator(["Synth A", "Synth B"]) });
    h.runtime.start();
    await until(() => statusOf(h.runtime) === "no-device");

    h.simulator.disconnect();
    h.simulator.reconnect();
    await until(() => statusOf(h.runtime) !== "no-device");
  });
});

describe("mid-session (SPEC.md 9.4, 9.5)", () => {
  it("goes read-only on a disconnect and refuses edits", async () => {
    const h = harness();
    await connect(h);
    const before = h.runtime.getState().parameters.values?.[40];

    h.simulator.disconnect();
    await until(() => statusOf(h.runtime) === "interrupted");

    h.runtime.setParameter(40, 999);
    expect(h.runtime.getState().parameters.values?.[40]).toBe(before);
  });

  it("comes back by itself, through the same dump request as a first connect", async () => {
    const h = harness();
    await connect(h);
    h.simulator.disconnect();
    await until(() => statusOf(h.runtime) === "interrupted");

    h.simulator.reconnect();
    await until(() => statusOf(h.runtime) === "connected");
    expect(h.runtime.getState().parameters.values).not.toBeNull();
  });
});

describe("the bulk write, through the wire (SPEC.md 5.8)", () => {
  it("lands every address and confirms it with a dump", async () => {
    const h = harness();
    await connect(h);

    const result = await h.runtime.bulkWrite(
      new Map([
        [40, 3],
        [41, 900],
      ]),
    );

    expect(result).toEqual({ applied: 2, diverged: [] });
    // The confirming dump overruled the store, so the panel is showing what the
    // device holds and not what the caller hoped for (SPEC.md 5.3).
    const { values } = h.runtime.getState().parameters;
    expect(values?.[40]).toBe(3);
    expect(values?.[41]).toBe(900);
  });

  it("goes out without waiting for a frame", async () => {
    // The coalescing queue exists to keep a 1000 Hz mouse off the wire; a bulk
    // write is distinct addresses that would each survive it anyway. No frame
    // is run here, and the write still lands.
    const h = harness();
    await connect(h);

    await h.runtime.bulkWrite(new Map([[40, 5]]));
    expect(h.runtime.getState().parameters.values?.[40]).toBe(5);
  });

  it("drains a queued write first, so the frame cannot land on top of it", async () => {
    // A slider let go in the same frame as the click leaves a value waiting for
    // its frame. Jumping that queue would put the bulk write on the wire first
    // and the stale value after it, re-applying exactly what was reverted.
    const h = harness();
    await connect(h);

    h.runtime.setParameter(40, 111);
    // The frame is deliberately *not* run: the write is still in the queue.
    const result = await h.runtime.bulkWrite(new Map([[40, 222]]));

    expect(result).toEqual({ applied: 1, diverged: [] });
    expect(h.runtime.getState().parameters.values?.[40]).toBe(222);

    // And the queue is empty rather than merely late. This has to be asked of
    // the device: a stale flush reaches the wire with no dump behind it, so the
    // store would go on showing 222 while the minichord held 111.
    h.frame();
    expect(h.simulator.device.snapshot()[40]).toBe(222);
  });

  it("does not take a dump from another bank as its answer", async () => {
    // The preset buttons reload the device from flash and it announces the new
    // bank unprompted (SPEC.md 1.3). That dump says nothing about the writes
    // just sent, and taking it would report every address as diverged and then
    // re-send the old bank's values over the new one.
    const h = harness();
    await connect(h);

    // Pressed and then written to in the same tick: the announcement is on its
    // way while the store still holds bank 0, so it reaches the waiter ahead of
    // the dump the write asked for.
    h.simulator.pressPresetButton(1);
    const result = await h.runtime.bulkWrite(new Map([[40, 7]]));

    // The bank moved under the write, so nothing it sent was ever confirmed:
    // the window closes on a count of zero rather than on the wrong dump.
    expect(result).toEqual({ applied: 0, diverged: [40] });
    // The store took the announcement all the same — that path is the
    // reducer's, and it is not what the bulk write was waiting for.
    expect(h.runtime.getState().parameters.values?.[BANK_ADDRESS]).toBe(1);
  });

  it("writes nothing with no wire, and says everything is unconfirmed", async () => {
    const h = harness();
    await connect(h);
    const before = h.runtime.getState().parameters.values?.[40];

    h.simulator.disconnect();
    await until(() => statusOf(h.runtime) === "interrupted");

    // The reducer refuses single edits while the connection is interrupted; a
    // bulk write going around that would be the one lie the rule prevents.
    const result = await h.runtime.bulkWrite(new Map([[40, 999]]));
    expect(result).toEqual({ applied: 0, diverged: [40] });
    expect(h.runtime.getState().parameters.values?.[40]).toBe(before);
  });
});

describe("the probe window (SPEC.md 9.3)", () => {
  it("asks every candidate at the same time, each with one second", async () => {
    const noop: Unsubscribe = () => {};
    const asked: Array<{ port: PortRef; timeoutMs: number }> = [];
    const answer: Array<(answered: boolean) => void> = [];
    const ports: PortRef[] = [
      { id: "1", name: "minichord MIDI 1" },
      { id: "2", name: "minichord MIDI 2" },
      { id: "3", name: "microKORG" },
    ];

    const transport: RuntimeTransport = {
      queryPermission: () => Promise.resolve("granted"),
      onPermissionChange: () => noop,
      requestAccess: () => Promise.resolve(),
      listPorts: () => ports,
      probe: (port, timeoutMs) => {
        asked.push({ port, timeoutMs });
        return new Promise<boolean>((resolve) => answer.push(resolve));
      },
      bind: () => {},
      requestDump: () => true,
      sendParameter: () => true,
      subscribe: () => noop,
      onPortsChanged: () => noop,
    };

    // No `probeTimeoutMs`: the default is the number the spec fixes.
    const runtime = new Runtime(transport, { supported: true });
    runtime.start();
    await until(() => asked.length > 0);

    // Both candidates in flight before either has answered, and the port that
    // is nobody's minichord was never touched.
    expect(asked.map((call) => call.port.name)).toEqual([
      "minichord MIDI 1",
      "minichord MIDI 2",
    ]);
    expect(asked.map((call) => call.timeoutMs)).toEqual([1000, 1000]);

    // Cable 2 stays silent and excludes itself, whatever its name.
    answer[0](true);
    answer[1](false);
    await until(() => runtime.getState().connection.port !== null);
    expect(runtime.getState().connection.port?.id).toBe("1");
    // Bound, and still not connected: only a dump moves it on.
    expect(statusOf(runtime)).toBe("searching");
  });
});

describe("the one-second retry (SPEC.md 5.9)", () => {
  /**
   * The one path the simulator cannot stage: a port that answers a probe and
   * then swallows the dump request. A double, and only here.
   */
  function deafTransport() {
    const port: PortRef = { id: "deaf", name: "minichord MIDI 1" };
    let listener: ((event: TransportEvent) => void) | null = null;
    const noop: Unsubscribe = () => {};
    let requests = 0;

    const transport: RuntimeTransport = {
      queryPermission: () => Promise.resolve("granted"),
      onPermissionChange: () => noop,
      requestAccess: () => Promise.resolve(),
      listPorts: () => [port],
      probe: () => Promise.resolve(true),
      bind: () => {},
      requestDump: () => {
        requests += 1;
        return true;
      },
      sendParameter: () => true,
      subscribe: (cb) => {
        listener = cb;
        return noop;
      },
      onPortsChanged: () => noop,
    };

    return {
      transport,
      requests: () => requests,
      dump: () => {
        listener?.({
          type: "dump",
          values: new Array<number>(PARAMETER_COUNT).fill(0),
        });
      },
    };
  }

  it("asks a second time one second later, and stops there", async () => {
    vi.useFakeTimers();
    try {
      const deaf = deafTransport();
      const runtime = new Runtime(deaf.transport, {
        supported: true,
        probeTimeoutMs: 1000,
        dumpRetryMs: 1000,
      });
      runtime.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(deaf.requests()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(deaf.requests()).toBe(2);

      await vi.advanceTimersByTimeAsync(5000);
      expect(deaf.requests()).toBe(2);
      expect(statusOf(runtime)).toBe("no-device");
    } finally {
      vi.useRealTimers();
    }
  });

  it("disarms the retry when the first dump arrives", async () => {
    vi.useFakeTimers();
    try {
      const deaf = deafTransport();
      const runtime = new Runtime(deaf.transport, {
        supported: true,
        dumpRetryMs: 1000,
      });
      runtime.start();
      await vi.advanceTimersByTimeAsync(0);
      deaf.dump();

      await vi.advanceTimersByTimeAsync(5000);
      expect(deaf.requests()).toBe(1);
      expect(statusOf(runtime)).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Put a second simulated device on the first one's bus.
 *
 * Two `MIDIAccess` objects cannot both be handed to one transport, and a real
 * machine with two minichords has one bus with four ports. Merging the maps is
 * the smallest thing that reproduces that.
 */
function mergeBuses(into: MinichordSimulator, other: MinichordSimulator): void {
  // Both simulators number their ports from one, and the transport keys its
  // pairing on the port id, so the second device's ids are renamed first.
  const rename = (port: MIDIPort) => {
    (port as { id: string }).id = `b-${port.id}`;
    return port.id;
  };
  for (const input of other.access.inputs.values()) {
    (into.access.inputs as Map<string, MIDIInput>).set(rename(input), input);
  }
  for (const output of other.access.outputs.values()) {
    (into.access.outputs as Map<string, MIDIOutput>).set(
      rename(output),
      output,
    );
  }
}

describe("the write policy (SPEC.md 5.7)", () => {
  /** Every parameter message the bound port actually saw, in order. */
  function wireLog(h: Harness) {
    const sent: Array<{ address: number; value: number }> = [];
    const send = h.transport.sendParameter.bind(h.transport);
    vi.spyOn(h.transport, "sendParameter").mockImplementation(
      (address, value) => {
        sent.push({ address, value });
        return send(address, value);
      },
    );
    return sent;
  }

  it("coalesces per address: one drag is one message a frame", async () => {
    const h = harness();
    await connect(h);
    const sent = wireLog(h);

    h.runtime.pointerDown(40);
    for (const value of [10, 11, 12, 13, 14]) h.runtime.setParameter(40, value);
    // Optimism is immediate; the wire is not.
    expect(h.runtime.getState().parameters.values?.[40]).toBe(14);
    expect(sent).toEqual([]);

    h.frame();
    expect(sent).toEqual([{ address: 40, value: 14 }]);
  });

  it("keeps one pending value per address, not one queue for all of them", async () => {
    const h = harness();
    await connect(h);
    const sent = wireLog(h);

    h.runtime.setParameter(40, 1);
    h.runtime.setParameter(41, 2);
    h.runtime.setParameter(40, 3);
    h.frame();

    expect(sent).toEqual([
      { address: 40, value: 3 },
      { address: 41, value: 2 },
    ]);
  });

  it("always flushes the last value of a drag on pointer-up", async () => {
    const h = harness();
    await connect(h);
    const sent = wireLog(h);

    h.runtime.pointerDown(40);
    h.runtime.setParameter(40, 99);
    h.runtime.pointerUp();

    // No frame was run: the end of a drag does not wait for one, or the last
    // position of the drag is the one that got coalesced away.
    expect(sent).toEqual([{ address: 40, value: 99 }]);
    expect(h.simulator.device.snapshot()[40]).toBe(99);

    // And the frame that was pending has nothing left to send.
    h.frame();
    expect(sent).toHaveLength(1);
  });

  it("asks for one frame at a time, however many values arrive", async () => {
    const h = harness();
    await connect(h);
    const sent = wireLog(h);

    h.runtime.setParameter(40, 1);
    h.frame();
    h.runtime.setParameter(40, 2);
    h.frame();

    expect(sent).toEqual([
      { address: 40, value: 1 },
      { address: 40, value: 2 },
    ]);
  });

  it("sends nothing the reducer refused", async () => {
    const h = harness();
    await connect(h);
    const sent = wireLog(h);

    h.simulator.disconnect();
    await until(() => statusOf(h.runtime) === "interrupted");
    h.runtime.setParameter(40, 5);
    h.runtime.pointerUp();
    h.frame();

    expect(sent).toEqual([]);
  });
});
