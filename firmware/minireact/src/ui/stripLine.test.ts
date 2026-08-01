import { describe, expect, it } from "vitest";

import { BANK_ADDRESS, FIRMWARE_VERSION_ADDRESS } from "../domain";
import { PARAMETER_COUNT } from "../transport";
import type { AppState, StripNotice } from "../state";
import { stripLine, stripNotice } from "./stripLine";

/** Connected to a port, on bank 3, with a store behind it. */
function connected(): AppState {
  const values = Array.from({ length: PARAMETER_COUNT }, () => 0);
  values[BANK_ADDRESS] = 2;
  values[FIRMWARE_VERSION_ADDRESS] = 8;

  return {
    connection: {
      status: "connected",
      ports: [],
      candidates: [],
      port: { id: "a", name: "minichord MIDI 1" },
      probing: null,
      mute: null,
      rediscovering: false,
      dumpRetriesLeft: 0,
    },
    parameters: {
      values,
      stored: values,
      held: null,
      pendingCommand: null,
      lastLossNotice: null,
    },
  };
}

describe("the strip (SPEC.md A.3)", () => {
  it("names the port, the firmware and the bank at rest", () => {
    expect(stripLine(connected())).toBe(
      "minichord MIDI 1 · firmware 8 · bank 3",
    );
  });

  it("says the wire is gone and the edits cannot be sent", () => {
    const state = connected();
    expect(
      stripLine({
        ...state,
        connection: { ...state.connection, status: "interrupted" },
      }),
    ).toBe(
      "Disconnected — waiting for the minichord to come back. Your edits are on screen but cannot be sent.",
    );
  });

  it("says only the bank when the reconnection cost nothing", () => {
    const state = connected();
    expect(
      stripNotice({
        ...state,
        parameters: {
          ...state.parameters,
          lastLossNotice: { kind: "reconnected", bank: 2, lost: 0 },
        },
      }),
    ).toBe("Reconnected — bank 3.");
  });

  it("states the reboot, the bank and what it took", () => {
    const state = connected();
    expect(
      stripNotice({
        ...state,
        parameters: {
          ...state.parameters,
          lastLossNotice: { kind: "reconnected", bank: 6, lost: 4 },
        },
      }),
    ).toBe(
      "Reconnected on bank 7. The minichord restarted and reloaded from flash, so 4 unsaved changes are gone.",
    );
  });

  it("spells out the singular", () => {
    const state = connected();
    expect(
      stripNotice({
        ...state,
        parameters: {
          ...state.parameters,
          lastLossNotice: { kind: "reconnected", bank: 0, lost: 1 },
        },
      }),
    ).toBe(
      "Reconnected on bank 1. The minichord restarted and reloaded from flash, so 1 unsaved change is gone.",
    );
  });

  it("has nothing to say by itself, nearly always", () => {
    expect(stripNotice(connected())).toBeNull();
  });

  it("drops the notice while the wire is out, and says so instead", () => {
    // A second interruption, before anything replaced the line the first one
    // left: "Reconnected" beside "Disconnected" is the app contradicting itself.
    const state = connected();
    const gone = {
      connection: { ...state.connection, status: "interrupted" as const },
      parameters: {
        ...state.parameters,
        lastLossNotice: { kind: "reconnected" as const, bank: 0, lost: 2 },
      },
    };
    expect(stripNotice(gone)).toBeNull();
    expect(stripLine(gone)).toContain("Disconnected");
  });

  it("keeps saying where the connection stands under a notice", () => {
    // Nothing clears a notice but the next dump, and the firmware version is
    // the only explanation for an unequipped slot (SPEC.md 9.6).
    const state = connected();
    expect(
      stripLine({
        ...state,
        parameters: {
          ...state.parameters,
          lastLossNotice: { kind: "reconnected", bank: 2, lost: 3 },
        },
      }),
    ).toBe("minichord MIDI 1 · firmware 8 · bank 3");
  });
});

describe("the bank lines (SPEC.md 10.5, A.3)", () => {
  function saying(notice: StripNotice): string | null {
    const state = connected();
    return stripNotice({
      ...state,
      parameters: { ...state.parameters, lastLossNotice: notice },
    });
  }

  it("acknowledges the save, naming the bank it went into", () => {
    // The whole conversation a save has: it asked nothing before acting.
    expect(saying({ kind: "saved", bank: 6 })).toBe("Saved to bank 7.");
  });

  it("acknowledges a bank reset and a memory wipe", () => {
    expect(saying({ kind: "reset", bank: 0 })).toBe("Bank 1 reset to factory.");
    // A wipe took all twelve, so it names none of them.
    expect(saying({ kind: "wiped" })).toBe("All banks reset to factory.");
  });

  it("states what a bank change cost, in the count the dock held", () => {
    expect(saying({ kind: "bank-changed", bank: 4, lost: 3 })).toBe(
      "Bank 5 loaded — 3 unsaved changes lost.",
    );
  });

  it("spells out the singular there too", () => {
    expect(saying({ kind: "bank-changed", bank: 4, lost: 1 })).toBe(
      "Bank 5 loaded — 1 unsaved change lost.",
    );
  });
});
