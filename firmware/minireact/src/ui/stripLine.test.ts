import { describe, expect, it } from "vitest";

import { BANK_ADDRESS, FIRMWARE_VERSION_ADDRESS } from "../domain";
import { PARAMETER_COUNT } from "../transport";
import type { AppState } from "../state";
import { stripLine } from "./stripLine";

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
      dumpRetriesLeft: 0,
    },
    parameters: { values, stored: values, held: null, lastLossNotice: null },
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
      stripLine({
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
      stripLine({
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
      stripLine({
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

  it("says the wire is gone even with a notice still standing", () => {
    // A second interruption, before anything replaced the line the first one
    // left: what is true now wins over what was true a moment ago.
    const state = connected();
    expect(
      stripLine({
        connection: { ...state.connection, status: "interrupted" },
        parameters: {
          ...state.parameters,
          lastLossNotice: { kind: "reconnected", bank: 0, lost: 2 },
        },
      }),
    ).toContain("Disconnected");
  });
});
