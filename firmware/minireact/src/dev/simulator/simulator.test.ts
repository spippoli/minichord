import { describe, expect, it } from "vitest";

import { DEFAULT_BANKS, PARAMETER_SIZE } from "./defaultBanks";
import { MinichordDevice, SIMULATED_FIRMWARE_VERSION } from "./minichordDevice";
import { MinichordSimulator } from "./fakeMidiAccess";

/** The 6-byte wire frame, built the way the transport will build it. */
function frame(address: number, value: number): Uint8Array {
  return Uint8Array.from([
    0xf0,
    address % 128,
    Math.floor(address / 128),
    value % 128,
    Math.floor(value / 128),
    0xf7,
  ]);
}

/** Decode a 512-byte dump payload the way the transport will decode it. */
function decode(payload: Uint8Array): number[] {
  return Array.from(
    { length: PARAMETER_SIZE },
    (_, i) => payload[2 * i] + 128 * payload[2 * i + 1],
  );
}

function dumpOf(device: MinichordDevice): number[] {
  const payload = device.receive(frame(0, 0));
  expect(payload).not.toBeNull();
  return decode(payload!);
}

describe("MinichordDevice", () => {
  it("answers the (0, 0) command with a dump of all 256 values", () => {
    const values = dumpOf(new MinichordDevice());
    expect(values).toHaveLength(PARAMETER_SIZE);
    expect(values[1]).toBe(0);
    expect(values[7]).toBe(SIMULATED_FIRMWARE_VERSION);
  });

  it("starts from the firmware factory content of the selected bank", () => {
    const values = dumpOf(new MinichordDevice({ initialBank: 3 }));
    // Addresses 0, 1 and 7 are overwritten on load; the rest is the bank file.
    expect(values.slice(8)).toEqual(DEFAULT_BANKS[3].slice(8));
    expect(values[1]).toBe(3);
  });

  it("reflects a parameter write in the next dump", () => {
    const device = new MinichordDevice();
    device.receive(frame(42, 1234));
    expect(dumpOf(device)[42]).toBe(1234);
  });

  it("applies writes to addresses the editor calls protected", () => {
    // The firmware has no address protection whatsoever; only the editor does.
    const device = new MinichordDevice();
    device.receive(frame(2, 77));
    device.receive(frame(4, 512));
    expect(dumpOf(device)[2]).toBe(77);
    expect(dumpOf(device)[4]).toBe(512);
  });

  it("heals a write to the firmware-version address, as apply_audio_parameter does", () => {
    // sysex_handler.h `case 7` restores version_ID after the store. A preset
    // load writes every address from 2 to 255, and byte 7 of a shared preset is
    // usually 0 -- without the heal, the version would stay wrong for good.
    const device = new MinichordDevice();
    device.receive(frame(7, 0));
    expect(dumpOf(device)[7]).toBe(SIMULATED_FIRMWARE_VERSION);
  });

  it("reports the configured firmware version, for introduction_version gating", () => {
    const device = new MinichordDevice({ firmwareVersion: 5 });
    expect(dumpOf(device)[7]).toBe(5);
    device.receive(frame(7, 99));
    expect(dumpOf(device)[7]).toBe(5);
  });

  it("ignores anything that is not a 6-byte SysEx frame", () => {
    const device = new MinichordDevice();
    expect(device.receive([0xf0, 42, 0, 1, 0, 0, 0xf7])).toBeNull();
    expect(device.receive([0x90, 60, 100])).toBeNull();
    expect(dumpOf(device)[42]).toBe(DEFAULT_BANKS[0][42]);
  });

  it("refuses an address past the end of the parameter array", () => {
    // On the device this is an out-of-bounds write; the transport is specified
    // to throw long before, and this is the backstop.
    const device = new MinichordDevice();
    expect(device.receive(frame(300, 1))).toBeNull();
    expect(dumpOf(device)).toHaveLength(PARAMETER_SIZE);
  });

  describe("rhythm bitmasks at 220..235", () => {
    it("round-trips a 7-bit voice mask", () => {
      const device = new MinichordDevice();
      device.receive(frame(220, 0b1010101));
      expect(dumpOf(device)[220]).toBe(0b1010101);
    });
  });

  describe("commands", () => {
    it("saves the live values into a bank and switches to it", () => {
      const device = new MinichordDevice();
      device.receive(frame(42, 999));
      // Address 0, command 2, argument 5: save the live values into bank 5.
      const dump = device.receive(Uint8Array.from([0xf0, 0, 0, 2, 5, 0xf7]));
      // save_config assigns current_bank_number then reloads, so a save both
      // persists and switches -- and answers with an unsolicited dump.
      expect(dump).not.toBeNull();
      expect(decode(dump!)[1]).toBe(5);
      expect(device.currentBank).toBe(5);
      expect(dumpOf(device)[42]).toBe(999);
    });

    it("resets a bank to the firmware defaults", () => {
      const device = new MinichordDevice();
      device.receive(frame(42, 999));
      const dump = device.receive(Uint8Array.from([0xf0, 0, 0, 3, 0, 0xf7]));
      expect(dump).not.toBeNull();
      expect(decode(dump!)[42]).toBe(DEFAULT_BANKS[0][42]);
    });

    it("wipes memory back to factory content and loads bank 0", () => {
      const device = new MinichordDevice({ initialBank: 4 });
      device.receive(Uint8Array.from([0xf0, 0, 0, 2, 4, 0xf7])); // dirty a bank
      device.receive(frame(42, 999));
      const dump = device.receive(Uint8Array.from([0xf0, 0, 0, 1, 0, 0xf7]));
      expect(dump).not.toBeNull();
      expect(decode(dump!)[1]).toBe(0);
      expect(decode(dump!).slice(8)).toEqual(DEFAULT_BANKS[0].slice(8));
    });

    it("emits a dump nobody asked for when the preset button is pressed", () => {
      const device = new MinichordDevice();
      const dump = device.switchBank(2);
      expect(decode(dump)[1]).toBe(2);
    });
  });
});

describe("MinichordSimulator", () => {
  it("exposes two ports named the way Linux ALSA names them", async () => {
    const simulator = new MinichordSimulator();
    const access = await simulator.requestAccess({ sysex: true });
    expect([...access.outputs.values()].map((p) => p.name)).toEqual([
      "minichord MIDI 1",
      "minichord MIDI 2",
    ]);
    // The legacy matching rule has to pick the first one.
    const matched = [...access.outputs.values()].filter(
      (p) =>
        (p.name!.includes("minichord") && p.name!.includes("1")) ||
        p.name === "minichord",
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe("minichord MIDI 1");
  });

  it("refuses access without sysex, as the browser does", async () => {
    const simulator = new MinichordSimulator();
    await expect(simulator.requestAccess({ sysex: false })).rejects.toThrow();
  });

  it("delivers the dump as a full F0..F7 frame on the input port", async () => {
    const simulator = new MinichordSimulator({ realisticTiming: false });
    const access = await simulator.requestAccess({ sysex: true });
    const input = [...access.inputs.values()][0];
    const output = [...access.outputs.values()][0];

    const received = new Promise<Uint8Array>((resolve) => {
      input.onmidimessage = (event) => resolve(new Uint8Array(event.data!));
    });
    output.send([0xf0, 0, 0, 0, 0, 0xf7]);

    const data = await received;
    expect(data).toHaveLength(PARAMETER_SIZE * 2 + 2);
    expect(data[0]).toBe(0xf0);
    expect(data.at(-1)).toBe(0xf7);
    expect(decode(data.slice(1, -1))[7]).toBe(SIMULATED_FIRMWARE_VERSION);
  });

  it("throws when sending to a disconnected port", async () => {
    const simulator = new MinichordSimulator({ realisticTiming: false });
    const access = await simulator.requestAccess({ sysex: true });
    const output = [...access.outputs.values()][0];
    simulator.disconnect();
    expect(() => output.send([0xf0, 0, 0, 0, 0, 0xf7])).toThrow();
  });

  it("fires statechange on unplug and replug", async () => {
    const simulator = new MinichordSimulator({ realisticTiming: false });
    const access = await simulator.requestAccess({ sysex: true });
    const states: string[] = [];
    access.onstatechange = (event) => {
      states.push((event as MIDIConnectionEvent).port!.state);
    };
    simulator.disconnect();
    simulator.reconnect();
    expect(states).toEqual(["disconnected", "connected"]);
  });

  describe("command latency", () => {
    /** Wall time from sending `command` to the dump it provokes. */
    async function timeCommand(
      command: number,
      argument: number,
    ): Promise<number> {
      const simulator = new MinichordSimulator();
      const access = await simulator.requestAccess({ sysex: true });
      const input = [...access.inputs.values()][0];
      const output = [...access.outputs.values()][0];

      const arrived = new Promise<number>((resolve) => {
        const started = performance.now();
        input.onmidimessage = () => resolve(performance.now() - started);
      });
      output.send([0xf0, 0, 0, command, argument, 0xf7]);
      return arrived;
    }

    it("answers a plain dump out of RAM, in well under a millisecond of device time", async () => {
      // setTimeout clamps to ~1 ms, so assert the shape, not the 0.81 ms figure.
      expect(await timeCommand(0, 0)).toBeLessThan(50);
    });

    it.each([
      ["wipe", 1],
      ["save", 2],
      ["reset bank", 3],
    ])(
      "makes %s pay for the flash write and the reload",
      async (_name, command) => {
        // Only the save was timed on hardware; 1 and 3 do the same work or more,
        // and modelling them as fast as a dump would hide a 200x difference.
        expect(await timeCommand(command, 0)).toBeGreaterThan(100);
      },
    );
  });

  it("drains a burst at the measured rate rather than instantly", async () => {
    const simulator = new MinichordSimulator();
    const access = await simulator.requestAccess({ sysex: true });
    const input = [...access.inputs.values()][0];
    const output = [...access.outputs.values()][0];

    const arrived = new Promise<number>((resolve) => {
      const started = performance.now();
      input.onmidimessage = () => resolve(performance.now() - started);
    });
    // A 254-message preset load, then ask for the state back.
    for (let address = 2; address < 256; address += 1)
      output.send([...frame(address, 1)]);
    output.send([0xf0, 0, 0, 0, 0, 0xf7]);

    // 255 messages at 0.581 ms each is ~148 ms of device time; assert the
    // shape (clearly not instant) rather than the exact figure.
    expect(await arrived).toBeGreaterThan(100);
  });
});
