import { describe, expect, it } from "vitest";

import { BANK_ADDRESS } from "../../domain";
import { PARAMETER_COUNT } from "../../transport";
import type { ConnectionStatus } from "../connection/reducer";
import type { AppEvent } from "../events";
import {
  NEUTRALISED,
  firmwareVersion,
  initialParametersState,
  parametersReducer,
  type ParametersState,
} from "./reducer";

/** A dump where every value is its own address, so a slot names itself. */
function identityDump(): number[] {
  return Array.from({ length: PARAMETER_COUNT }, (_, address) => address);
}

function apply(
  event: AppEvent,
  status: ConnectionStatus = "connected",
  state: ParametersState = initialParametersState,
) {
  return parametersReducer(state, event, status);
}

function dumped(values = identityDump()): ParametersState {
  return apply({ type: "dump", values }).state;
}

describe("no device, no state (SPEC.md 5.2)", () => {
  it("holds nothing before the first dump", () => {
    expect(initialParametersState.values).toBeNull();
  });

  it("refuses an edit with nothing to edit", () => {
    const { state, effects } = apply({ type: "edit", address: 40, value: 12 });
    expect(state.values).toBeNull();
    expect(effects).toEqual([]);
  });
});

describe("a dump overrules the store (SPEC.md 5.3)", () => {
  it("replaces all 256 values", () => {
    const edited = apply(
      { type: "edit", address: 40, value: 999 },
      "connected",
      dumped(),
    ).state;
    expect(edited.values?.[40]).toBe(999);

    const values = identityDump().map((value) => value + 1);
    const after = apply({ type: "dump", values }, "connected", edited).state;
    expect(after.values).toHaveLength(PARAMETER_COUNT);
    expect(after.values?.[40]).toBe(41);
  });

  it("keeps every other value verbatim", () => {
    const values = dumped().values;
    for (let address = 8; address < PARAMETER_COUNT; address += 1) {
      expect(values?.[address]).toBe(address);
    }
  });
});

describe("the neutralisation (SPEC.md 5.4)", () => {
  it("forces the five slots carrying the physical knobs, on every dump", () => {
    // What a real device sends there is wherever the knobs happen to sit.
    const values = identityDump();
    values[2] = 114;
    values[3] = 121;
    values[4] = 128;
    values[5] = 135;
    values[6] = 142;

    for (const state of [
      dumped(values),
      apply({ type: "dump", values }, "connected", dumped(values)).state,
    ]) {
      expect(state.values?.[2]).toBe(50);
      expect(state.values?.[3]).toBe(50);
      expect(state.values?.[4]).toBe(512);
      expect(state.values?.[5]).toBe(512);
      expect(state.values?.[6]).toBe(512);
    }
  });

  it("is the fiction of exactly five addresses", () => {
    expect([...NEUTRALISED.keys()]).toEqual([2, 3, 4, 5, 6]);
  });

  it("never writes those five values back to the device", () => {
    // Unlike the legacy, which sends them from inside its receive handler.
    const { effects } = apply({ type: "dump", values: identityDump() });
    expect(effects).toEqual([]);
  });

  it("leaves the firmware version alone", () => {
    expect(dumped().values?.[7]).toBe(7);
    expect(firmwareVersion(dumped())).toBe(7);
  });

  it("reads the firmware as 0 with no store behind it", () => {
    // Before the first dump every parameter is newer than what is connected.
    expect(firmwareVersion(initialParametersState)).toBe(0);
  });
});

describe("the store is optimistic, and subordinate (SPEC.md 5.2)", () => {
  it("takes an edit at once and puts it on the wire", () => {
    const { state, effects } = apply(
      { type: "edit", address: 40, value: 7 },
      "connected",
      dumped(),
    );
    expect(state.values?.[40]).toBe(7);
    expect(effects).toEqual([{ type: "write", address: 40, value: 7 }]);
  });

  it("refuses the edit outright while the connection is interrupted", () => {
    const before = dumped();
    const { state, effects } = apply(
      { type: "edit", address: 40, value: 7 },
      "interrupted",
      before,
    );
    // The reducer refuses; drawing the control read-only is a rendering of
    // that, not the authority for it.
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });
});

describe("the address under an active pointer (SPEC.md 5.3)", () => {
  /** A dump of the same bank, with every value moved by one. */
  function movedDump(bank = 0): number[] {
    const values = identityDump().map((value) => value + 1);
    values[BANK_ADDRESS] = bank;
    return values;
  }

  function holding(address: number): ParametersState {
    const base = identityDump();
    base[BANK_ADDRESS] = 0;
    const held = apply(
      { type: "pointer-down", address },
      "connected",
      dumped(base),
    );
    return apply({ type: "edit", address, value: 777 }, "connected", held.state)
      .state;
  }

  it("survives a dump: a slider never jumps out from under the cursor", () => {
    const state = holding(40);
    const after = apply(
      { type: "dump", values: movedDump() },
      "connected",
      state,
    ).state;

    expect(after.values?.[40]).toBe(777);
    // Every other value is the device's again.
    expect(after.values?.[41]).toBe(42);
  });

  it("loses the exception when the pointer comes up", () => {
    const state = apply({ type: "pointer-up" }, "connected", holding(40)).state;
    const after = apply(
      { type: "dump", values: movedDump() },
      "connected",
      state,
    ).state;

    expect(after.values?.[40]).toBe(41);
  });

  it("flushes the last value of the drag on pointer-up", () => {
    // The final position of a drag is never the one coalescing threw away.
    const { effects } = apply({ type: "pointer-up" }, "connected", holding(40));
    expect(effects).toEqual([{ type: "flush-writes" }]);
  });

  it("asks for nothing when no pointer was down", () => {
    const before = dumped();
    const { state, effects } = apply(
      { type: "pointer-up" },
      "connected",
      before,
    );
    expect(state).toBe(before);
    expect(effects).toEqual([]);
  });

  it("loses the exception too when the dump carries another bank", () => {
    // The value under the finger belonged to the previous bank; keeping it
    // would display a number that belongs to nothing.
    const state = holding(40);
    const after = apply(
      { type: "dump", values: movedDump(3) },
      "connected",
      state,
    ).state;

    expect(after.values?.[40]).toBe(41);
    expect(after.values?.[BANK_ADDRESS]).toBe(3);
  });

  it("holds one address at a time and forgets it with the values", () => {
    const state = apply(
      { type: "pointer-down", address: 40 },
      "connected",
      dumped(),
    ).state;
    expect(
      apply({ type: "pointer-up" }, "connected", state).state.held,
    ).toBeNull();
  });
});
