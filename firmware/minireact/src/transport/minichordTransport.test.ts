import { beforeEach, describe, expect, it, vi } from "vitest";

import { MinichordSimulator } from "../dev/simulator";
import { PARAMETER_COUNT } from "./frame";
import { MinichordTransport } from "./minichordTransport";
import type { PortRef, TransportEvent } from "./types";

/**
 * Everything here runs against the checked-in simulator with
 * `realisticTiming: false`, so every device answer lands on a microtask and no
 * test needs a timer to be deterministic (SPEC.md 2.5).
 */
function makeSimulator(portNames?: readonly [string, string]) {
  return new MinichordSimulator({ realisticTiming: false, portNames });
}

/**
 * The seam takes no arguments (SPEC.md 3.2), so the sysex option -- which both
 * the platform and the simulator require -- is bound at the injection site.
 */
function accessSeam(simulator: MinichordSimulator) {
  return () => simulator.requestAccess({ sysex: true });
}

async function connected(simulator: MinichordSimulator) {
  const transport = new MinichordTransport({
    requestAccess: accessSeam(simulator),
  });
  await transport.requestAccess();
  return transport;
}

/** Let the simulator's microtask-scheduled answers land. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function record(transport: MinichordTransport): TransportEvent[] {
  const events: TransportEvent[] = [];
  transport.subscribe((event) => events.push(event));
  return events;
}

/** The port the simulator answers on: the first of the two. */
function controlPort(transport: MinichordTransport): PortRef {
  return transport.listPorts()[0];
}

async function boundTransport(simulator: MinichordSimulator) {
  const transport = await connected(simulator);
  transport.bind(controlPort(transport));
  return transport;
}

/** The next dump the transport emits, as 256 raw integers. */
function nextDump(transport: MinichordTransport): Promise<readonly number[]> {
  return new Promise((resolve) => {
    const unsubscribe = transport.subscribe((event) => {
      if (event.type !== "dump") return;
      unsubscribe();
      resolve(event.values);
    });
  });
}

/** Reach the fake input to push bytes the device would never send. */
function deliver(simulator: MinichordSimulator, bytes: number[]): void {
  const input = simulator.access.inputs.get("sim-in-1") as unknown as {
    onmidimessage: ((event: { data: Uint8Array }) => void) | null;
  };
  input.onmidimessage?.({ data: Uint8Array.from(bytes) });
}

/** Watch the bytes the transport actually puts on the wire. */
function tapOutput(simulator: MinichordSimulator): number[][] {
  const output = simulator.access.outputs.get("sim-out-1") as MIDIOutput;
  const sent: number[][] = [];
  const send = output.send.bind(output);
  output.send = (data: number[] | Uint8Array, at?: number) => {
    sent.push(Array.from(data));
    send(data, at);
  };
  return sent;
}

/**
 * Fire a `statechange` for one port, the way a real bus fires one for each half
 * of a device: the simulator only announces the input half by itself.
 */
function fireStateChange(simulator: MinichordSimulator, portId: string): void {
  const port =
    simulator.access.inputs.get(portId) ?? simulator.access.outputs.get(portId);
  const event = new Event("statechange");
  Object.defineProperty(event, "port", { value: port, configurable: true });
  simulator.access.dispatchEvent(event);
}

let simulator: MinichordSimulator;

beforeEach(() => {
  simulator = makeSimulator();
});

describe("ports", () => {
  it("hands out an id and a name and nothing else", async () => {
    const transport = await connected(simulator);
    const ports = transport.listPorts();
    expect(ports).toHaveLength(2);
    for (const port of ports) {
      expect(Object.keys(port).sort()).toEqual(["id", "name"]);
      expect(typeof port.id).toBe("string");
      expect(typeof port.name).toBe("string");
    }
    expect(ports.map((p) => p.name)).toEqual([
      "minichord MIDI 1",
      "minichord MIDI 2",
    ]);
  });

  it("lists nothing before access has been granted", () => {
    const transport = new MinichordTransport({
      requestAccess: accessSeam(simulator),
    });
    expect(transport.listPorts()).toEqual([]);
  });

  it("hands out a copy, so a caller cannot rewrite the port list", async () => {
    const transport = await connected(simulator);
    const ports = transport.listPorts();
    expect(ports).not.toBe(transport.listPorts());
    (ports as PortRef[]).length = 0;
    expect(transport.listPorts()).toHaveLength(2);
  });

  it("stays unbound when asked to bind a port it does not know", async () => {
    const transport = await boundTransport(simulator);
    expect(transport.requestDump()).toBe(true);
    transport.bind({ id: "nothing", name: "nothing" });
    expect(transport.requestDump()).toBe(false);
  });
});

describe("probe", () => {
  it("resolves true when a dump arrives inside the window", async () => {
    const transport = await connected(simulator);
    await expect(transport.probe(controlPort(transport), 50)).resolves.toBe(
      true,
    );
  });

  it("never emits the dump it consumed", async () => {
    const transport = await connected(simulator);
    const events = record(transport);
    await transport.probe(controlPort(transport), 50);
    await settle();
    expect(events.filter((e) => e.type === "dump")).toHaveLength(0);
  });

  it("resolves false when the port stays mute", async () => {
    const transport = await connected(simulator);
    const silent = transport.listPorts()[1];
    await expect(transport.probe(silent, 20)).resolves.toBe(false);
  });

  it("resolves false for a port it does not know", async () => {
    const transport = await connected(simulator);
    await expect(
      transport.probe({ id: "nothing", name: "nothing" }, 20),
    ).resolves.toBe(false);
  });

  it("leaves later dumps to the subscribers", async () => {
    const transport = await connected(simulator);
    const port = controlPort(transport);
    await transport.probe(port, 50);
    transport.bind(port);
    const dump = nextDump(transport);
    expect(transport.requestDump()).toBe(true);
    expect(await dump).toHaveLength(PARAMETER_COUNT);
  });
});

describe("dumps", () => {
  it("reports 256 raw integers, verbatim", async () => {
    const transport = await boundTransport(simulator);
    const dump = nextDump(transport);
    transport.requestDump();
    const values = await dump;
    expect(values).toHaveLength(PARAMETER_COUNT);
    expect(values).toEqual(simulator.device.snapshot());
    // Raw means raw: no neutralisation of the potentiometer slots (SPEC.md 3.5).
    expect(values[7]).toBe(8);
  });

  it("reports the dumps nobody asked for", async () => {
    const transport = await boundTransport(simulator);
    const dump = nextDump(transport);
    simulator.pressPresetButton(1);
    expect((await dump)[1]).toBe(1);
  });

  it("ignores a message of any length other than 513 bytes", async () => {
    const transport = await boundTransport(simulator);
    const events = record(transport);
    deliver(simulator, [0x90, 60, 100]);
    deliver(simulator, [0xf0, 0, 0, 0, 0, 0xf7]);
    deliver(simulator, new Array<number>(600).fill(0));
    await settle();
    expect(events.filter((e) => e.type === "dump")).toHaveLength(0);
  });

  it("reports a malformed sysex frame as a typed reason, and stays quiet about other MIDI", async () => {
    const transport = await boundTransport(simulator);
    const events = record(transport);
    deliver(simulator, [0x90, 60, 100]);
    expect(events).toHaveLength(0);
    deliver(simulator, [0xf0, 0, 0, 0, 0, 0xf7]);
    expect(events).toEqual([{ type: "error", reason: "malformed-message" }]);
  });

  it("stays quiet on a port it is not bound to", async () => {
    const transport = await connected(simulator);
    const events = record(transport);
    transport.requestDump();
    simulator.pressPresetButton(1);
    await settle();
    expect(events.filter((e) => e.type === "dump")).toHaveLength(0);
  });
});

describe("sending", () => {
  it("returns false while unbound and true once bound", async () => {
    const transport = await connected(simulator);
    expect(transport.requestDump()).toBe(false);
    expect(transport.sendParameter(40, 300)).toBe(false);
    expect(transport.sendCommand(0, 0)).toBe(false);
    transport.bind(controlPort(transport));
    expect(transport.requestDump()).toBe(true);
    transport.unbind();
    expect(transport.requestDump()).toBe(false);
  });

  it("writes a parameter the device reads back", async () => {
    const transport = await boundTransport(simulator);
    expect(transport.sendParameter(40, 300)).toBe(true);
    expect(transport.sendParameter(219, 16383)).toBe(true);
    const dump = nextDump(transport);
    transport.requestDump();
    const values = await dump;
    expect(values[40]).toBe(300);
    expect(values[219]).toBe(16383);
  });

  it("throws on an address or value the wire cannot carry, bound or not", async () => {
    const transport = await connected(simulator);
    expect(() => transport.sendParameter(256, 0)).toThrow(RangeError);
    expect(() => transport.sendParameter(-1, 0)).toThrow(RangeError);
    expect(() => transport.sendParameter(0, 16384)).toThrow(RangeError);
    expect(() => transport.sendParameter(1.5, 0)).toThrow(TypeError);
    expect(() => transport.sendParameter(0, 2.5)).toThrow(TypeError);
    expect(() => transport.sendCommand(128, 0)).toThrow(RangeError);
    expect(() => transport.sendCommand(0, -1)).toThrow(RangeError);
    transport.bind(controlPort(transport));
    expect(() => transport.sendParameter(256, 0)).toThrow(RangeError);
  });

  it("puts nothing but six-byte frames on the wire", async () => {
    const transport = await boundTransport(simulator);
    const sent = tapOutput(simulator);
    transport.sendParameter(200, 16383);
    await transport.probe(controlPort(transport), 50);
    transport.requestDump();
    transport.wipeMemory();
    transport.saveToBank(3);
    transport.resetBank(11);

    expect(sent).toEqual([
      [0xf0, 72, 1, 127, 127, 0xf7],
      [0xf0, 0, 0, 0, 0, 0xf7],
      [0xf0, 0, 0, 0, 0, 0xf7],
      [0xf0, 0, 0, 1, 0, 0xf7],
      [0xf0, 0, 0, 2, 3, 0xf7],
      [0xf0, 0, 0, 3, 11, 0xf7],
    ]);
  });

  it("names the four commands", async () => {
    const transport = await boundTransport(simulator);
    expect(transport.sendParameter(40, 1234)).toBe(true);

    // Saving switches to the target bank and answers with a dump nobody asked for.
    const saved = nextDump(transport);
    expect(transport.saveToBank(3)).toBe(true);
    expect((await saved)[1]).toBe(3);
    expect(simulator.device.currentBank).toBe(3);
    expect(simulator.device.snapshot()[40]).toBe(1234);

    const reset = nextDump(transport);
    expect(transport.resetBank(3)).toBe(true);
    await reset;
    expect(simulator.device.snapshot()[40]).not.toBe(1234);

    const wiped = nextDump(transport);
    expect(transport.wipeMemory()).toBe(true);
    expect((await wiped)[1]).toBe(0);
  });
});

describe("subscribe", () => {
  it("serves several listeners, each with its own unsubscribe", async () => {
    const transport = await boundTransport(simulator);
    const first: TransportEvent[] = [];
    const second: TransportEvent[] = [];
    const third: TransportEvent[] = [];
    const stopFirst = transport.subscribe((e) => first.push(e));
    transport.subscribe((e) => second.push(e));
    const stopThird = transport.subscribe((e) => third.push(e));
    stopThird();

    let dump = nextDump(transport);
    transport.requestDump();
    await dump;
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(third).toHaveLength(0);

    stopFirst();
    dump = nextDump(transport);
    transport.requestDump();
    await dump;
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });

  it("survives a listener unsubscribing twice", async () => {
    const transport = await boundTransport(simulator);
    const seen: TransportEvent[] = [];
    const stop = transport.subscribe((e) => seen.push(e));
    stop();
    stop();
    const dump = nextDump(transport);
    transport.requestDump();
    await dump;
    expect(seen).toHaveLength(0);
  });
});

describe("connection", () => {
  it("reports unplugging and replugging", async () => {
    const transport = await boundTransport(simulator);
    const events = record(transport);
    simulator.disconnect();
    simulator.reconnect();
    expect(events).toEqual([
      { type: "connection", connected: false },
      { type: "connection", connected: true },
    ]);
  });

  it("reports one unplug once, whichever half of the device announces it", async () => {
    const transport = await boundTransport(simulator);
    const events = record(transport);
    simulator.disconnect();
    // The real bus announces the output half too; it is the same unplug.
    fireStateChange(simulator, "sim-out-1");
    expect(events).toEqual([{ type: "connection", connected: false }]);
  });

  it("says nothing when a port it is not bound to comes and goes", async () => {
    const transport = await connected(simulator);
    // Bind the second port, so the first one is somebody else's device.
    transport.bind(transport.listPorts()[1]);
    const events = record(transport);
    simulator.disconnect();
    simulator.reconnect();
    expect(events).toEqual([]);
  });

  it("says nothing at all while unbound", async () => {
    const transport = await connected(simulator);
    const events = record(transport);
    simulator.disconnect();
    simulator.reconnect();
    expect(events).toEqual([]);
  });

  it("reports the bus changing even with nothing bound", async () => {
    // The other half of the same event: `connection` is about the bound
    // device, and with none bound the gate still has to notice a minichord
    // being plugged in (SPEC.md 9.8).
    const transport = await connected(simulator);
    const changes: number[] = [];
    const stop = transport.onPortsChanged(() => changes.push(1));
    simulator.disconnect();
    simulator.reconnect();
    expect(changes).toHaveLength(2);

    stop();
    simulator.disconnect();
    expect(changes).toHaveLength(2);
  });

  it("cannot send while the wire is gone, and can again afterwards", async () => {
    const transport = await boundTransport(simulator);
    simulator.disconnect();
    expect(transport.requestDump()).toBe(false);
    simulator.reconnect();
    expect(transport.requestDump()).toBe(true);
  });
});

describe("access", () => {
  it("reports a refusal as a typed reason", async () => {
    const transport = new MinichordTransport({
      requestAccess: () =>
        Promise.reject(new DOMException("no", "SecurityError")),
    });
    const events = record(transport);
    await transport.requestAccess();
    expect(events).toEqual([{ type: "error", reason: "access-denied" }]);
    expect(transport.listPorts()).toEqual([]);
  });

  it("reports a platform without Web MIDI as a typed reason", async () => {
    const transport = new MinichordTransport();
    const events = record(transport);
    await transport.requestAccess();
    expect(events).toEqual([{ type: "error", reason: "unsupported" }]);
  });

  it("answers the capability question without asking for anything", () => {
    expect(MinichordTransport.isSupported()).toBe(false);
    vi.stubGlobal("navigator", { requestMIDIAccess: () => Promise.resolve() });
    expect(MinichordTransport.isSupported()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("permission", () => {
  /** A permission whose answer can be flipped, as site settings would flip it. */
  function seamPermission(initial: PermissionState) {
    let state = initial;
    return {
      set(next: PermissionState) {
        state = next;
      },
      query: () => Promise.resolve(state),
    };
  }

  it("answers from the injected seam", async () => {
    const transport = new MinichordTransport({
      requestAccess: accessSeam(simulator),
      queryPermission: () => Promise.resolve("granted"),
    });
    await expect(transport.queryPermission()).resolves.toBe("granted");
  });

  it("answers 'prompt' where the permission cannot be queried", async () => {
    const transport = new MinichordTransport();
    await expect(transport.queryPermission()).resolves.toBe("prompt");
  });

  it("reports a change read through the injected seam", async () => {
    const permission = seamPermission("prompt");
    const transport = new MinichordTransport({
      queryPermission: permission.query,
    });
    const seen: PermissionState[] = [];
    transport.onPermissionChange((state) => seen.push(state));

    // The first reading is the baseline, not a change.
    await expect(transport.queryPermission()).resolves.toBe("prompt");
    expect(seen).toEqual([]);

    permission.set("granted");
    await expect(transport.queryPermission()).resolves.toBe("granted");
    expect(seen).toEqual(["granted"]);

    // Reading the same answer twice is not a second change.
    await transport.queryPermission();
    expect(seen).toEqual(["granted"]);
  });

  it("serves several watchers, each with its own unsubscribe", async () => {
    const permission = seamPermission("denied");
    const transport = new MinichordTransport({
      queryPermission: permission.query,
    });
    const first: PermissionState[] = [];
    const second: PermissionState[] = [];
    const stopFirst = transport.onPermissionChange((s) => first.push(s));
    transport.onPermissionChange((s) => second.push(s));
    await transport.queryPermission();

    permission.set("granted");
    await transport.queryPermission();
    expect(first).toEqual(["granted"]);
    expect(second).toEqual(["granted"]);

    stopFirst();
    permission.set("prompt");
    await transport.queryPermission();
    expect(first).toEqual(["granted"]);
    expect(second).toEqual(["granted", "prompt"]);
  });

  it("hands out a harmless unsubscribe where there is no permission to watch", () => {
    const transport = new MinichordTransport();
    const stop = transport.onPermissionChange(() => {});
    expect(typeof stop).toBe("function");
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });
});
