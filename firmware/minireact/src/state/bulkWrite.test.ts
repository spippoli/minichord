import { describe, expect, it } from "vitest";

import { PARAMETER_COUNT } from "../transport";
import { makeBulkWrite, type BulkWriteWire } from "./bulkWrite";

/**
 * The module written once and used three times (SPEC.md 5.8).
 *
 * Everything here is driven through the seam rather than through a transport:
 * the point of the module is *what it sends and how many rounds it does*, and a
 * fake wire is the only way to see a message that was never sent.
 */

type Round = { sent: [number, number][]; dumped: boolean };

/**
 * A device that applies what it is told, except for the addresses it is asked
 * to swallow — which is the ≈2.5% silent loss of SPEC.md 1.6, made exact.
 */
function fakeWire(options: {
  /** Addresses this device drops, per round, in order. */
  swallow?: readonly (readonly number[])[];
  /** Addresses the firmware heals back to a value of its own. */
  heal?: ReadonlyMap<number, number>;
  /** Stop answering dumps after this many. */
  dumpsAnswered?: number;
}) {
  const values = Array.from({ length: PARAMETER_COUNT }, () => 0);
  const rounds: Round[] = [{ sent: [], dumped: false }];
  let round = 0;
  let dumps = 0;

  const wire: BulkWriteWire = {
    send(address, value) {
      rounds[round].sent.push([address, value]);
      if (options.swallow?.[round]?.includes(address)) return;
      values[address] = options.heal?.get(address) ?? value;
    },
    requestDump() {
      rounds[round].dumped = true;
    },
    nextDump() {
      dumps += 1;
      const answered = dumps <= (options.dumpsAnswered ?? Infinity);
      const snapshot = answered ? values.slice() : null;
      round += 1;
      rounds.push({ sent: [], dumped: false });
      return Promise.resolve(snapshot);
    },
  };

  return { wire, rounds, values };
}

/** Three ordinary parameter addresses, none of them in the excluded range. */
const MAP = new Map([
  [40, 11],
  [41, 22],
  [120, 33],
]);

describe("what a bulk write puts on the wire (SPEC.md 5.7, 5.8)", () => {
  it("sends every address it was given, then asks for a dump", async () => {
    const { wire, rounds } = fakeWire({});
    await makeBulkWrite(wire)(MAP);

    expect(rounds[0].sent).toEqual([
      [40, 11],
      [41, 22],
      [120, 33],
    ]);
    expect(rounds[0].dumped).toBe(true);
  });

  it("sends unpaced: nothing is awaited between two writes", async () => {
    // Pacing only makes a bulk write slower — 254 messages at zero interval
    // lost nothing when it was measured (SPEC.md 1.6). The observable form of
    // "unpaced" is that the whole map is on the wire before the first await.
    const { wire, rounds } = fakeWire({});
    const pending = makeBulkWrite(wire)(MAP);

    expect(rounds[0].sent).toHaveLength(MAP.size);
    await pending;
  });

  it("stops at one round when the dump agrees with what it sent", async () => {
    const { wire, rounds } = fakeWire({});
    const result = await makeBulkWrite(wire)(MAP);

    expect(result).toEqual({ applied: 3, diverged: [] });
    // One round of writes, one dump. The repair round exists only because a
    // bulk write is not self-confirming; with nothing to repair it is noise.
    expect(rounds[1].sent).toEqual([]);
  });
});

describe("the repair round (SPEC.md 11.3, 5.8)", () => {
  it("re-sends only what diverged, and only that", async () => {
    const { wire, rounds } = fakeWire({ swallow: [[41]] });
    const result = await makeBulkWrite(wire)(MAP);

    expect(rounds[1].sent).toEqual([[41, 22]]);
    expect(rounds[1].dumped).toBe(true);
    expect(result).toEqual({ applied: 3, diverged: [] });
  });

  it("stops after the second round and states what is left", async () => {
    // A second loss on the same address is under 0.1% given the ≈2.5% bound, so
    // a third round would be fighting the firmware, not packet loss.
    const { wire, rounds } = fakeWire({ swallow: [[41], [41]] });
    const result = await makeBulkWrite(wire)(MAP);

    expect(result).toEqual({ applied: 2, diverged: [41] });
    expect(rounds[2].sent).toEqual([]);
  });

  it("counts a value the firmware normalised as diverged, not as lost", async () => {
    const { wire } = fakeWire({ heal: new Map([[120, 1]]) });
    const result = await makeBulkWrite(wire)(MAP);

    expect(result).toEqual({ applied: 2, diverged: [120] });
  });

  it("confirms nothing when no dump comes back", async () => {
    const { wire } = fakeWire({ dumpsAnswered: 0 });
    const result = await makeBulkWrite(wire)(MAP);

    expect(result).toEqual({ applied: 0, diverged: [40, 41, 120] });
  });
});

describe("addresses 2–7 are outside the comparison (SPEC.md 5.4, 5.8)", () => {
  /**
   * The bug this module exists to stop being written three times: without the
   * exclusion every round reports five or six phantom divergences — the store's
   * fiction at 2–6 and the firmware healing 7 — and the repair never converges.
   */
  const WITH_EXCLUDED = new Map([
    [2, 50],
    [3, 50],
    [4, 512],
    [5, 512],
    [6, 512],
    [7, 8],
    [40, 11],
  ]);

  it("never reports one of them as diverged, whatever comes back", async () => {
    // A device that swallows all six, which is the shape a real one takes:
    // 2–6 answer with the physical knobs and 7 is healed.
    const { wire, rounds } = fakeWire({ swallow: [[2, 3, 4, 5, 6, 7]] });
    const result = await makeBulkWrite(wire)(WITH_EXCLUDED);

    expect(result).toEqual({ applied: 1, diverged: [] });
    expect(rounds[1].sent).toEqual([]);
  });

  it("counts them in neither number: nothing can be said about them", async () => {
    const { wire } = fakeWire({});
    const result = await makeBulkWrite(wire)(WITH_EXCLUDED);

    expect(result.applied).toBe(1);
  });

  it("still sends them, because which addresses are written is the caller's", async () => {
    // The import declines to write them (SPEC.md 11.3); the exclusion here is
    // of the *comparison* only, and conflating the two is how a caller would
    // silently lose an address it meant to send.
    const { wire, rounds } = fakeWire({});
    await makeBulkWrite(wire)(WITH_EXCLUDED);

    expect(rounds[0].sent.map(([address]) => address)).toEqual([
      2, 3, 4, 5, 6, 7, 40,
    ]);
  });
});
