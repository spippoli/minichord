import { describe, expect, it } from "vitest";

import { BANK_ADDRESS, byAddress, defaultWire } from "../../domain";
import { PARAMETER_COUNT } from "../../transport";
import type { ConnectionStatus } from "../connection/reducer";
import type { AppEvent } from "../events";
import {
  NEUTRALISED,
  differsFromDefault,
  editBuffer,
  firmwareVersion,
  isEdited,
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

describe("the reference the edited count compares against (SPEC.md 10.3)", () => {
  it("captures the session's first dump", () => {
    const state = dumped();

    expect(state.stored).toEqual(state.values);
    expect(isEdited(state, 40)).toBe(false);
  });

  it("counts an edit as edited, and only against the reference", () => {
    const state = apply(
      { type: "edit", address: 40, value: 999 },
      "connected",
      dumped(),
    ).state;

    expect(isEdited(state, 40)).toBe(true);
    expect(isEdited(state, 41)).toBe(false);
  });

  it("leaves the reference alone on a dump that only answers our own probe", () => {
    const edited = apply(
      { type: "edit", address: 40, value: 999 },
      "connected",
      dumped(),
    ).state;
    const values = identityDump();
    values[40] = 999;

    const after = apply({ type: "dump", values }, "connected", edited).state;

    // Live state with an unsaved edit in it. Baselining here would silently
    // declare everything saved on every connection probe and every retry.
    expect(isEdited(after, 40)).toBe(true);
  });

  it("captures a new reference when the dump carries another bank", () => {
    const edited = apply(
      { type: "edit", address: 40, value: 999 },
      "connected",
      dumped(),
    ).state;
    const values = identityDump();
    values[BANK_ADDRESS] = 4;

    const after = apply({ type: "dump", values }, "connected", edited).state;

    expect(after.stored?.[BANK_ADDRESS]).toBe(4);
    expect(isEdited(after, 40)).toBe(false);
  });

  it("never compares the five fictions or the firmware version", () => {
    const state = dumped();
    const drifted = {
      ...state,
      values: state.values!.map((value, address) =>
        address === 7 || NEUTRALISED.has(address) ? value + 1 : value,
      ),
    };

    for (const address of [...NEUTRALISED.keys(), 7]) {
      expect(isEdited(drifted, address)).toBe(false);
    }
  });

  it("has nothing edited before the first dump", () => {
    expect(isEdited(initialParametersState, 40)).toBe(false);
  });
});

describe("the blue LED, against the factory default (SPEC.md 7.3)", () => {
  /** A dump putting every parameter at the value `parameters.json` declares. */
  function factoryDump(): number[] {
    const values = identityDump();
    for (const [address, parameter] of byAddress) {
      values[address] = defaultWire(parameter);
    }
    return values;
  }

  it("is dark when the value is the one the file declares", () => {
    const state = dumped(factoryDump());
    for (const address of [40, 120, 220]) {
      expect(differsFromDefault(state, address)).toBe(false);
    }
  });

  it("lights on a value the file does not declare", () => {
    const parameter = byAddress.get(40)!;
    const state = apply(
      { type: "edit", address: 40, value: defaultWire(parameter) + 1 },
      "connected",
      dumped(factoryDump()),
    ).state;

    expect(differsFromDefault(state, 40)).toBe(true);
  });

  it("is independent of the amber one: a saved bank can still be off default", () => {
    // The reference is captured from the dump itself, so nothing is edited —
    // and the values are deliberately not the factory ones.
    const state = dumped();
    expect(isEdited(state, 40)).toBe(false);
    expect(differsFromDefault(state, 40)).toBe(
      state.values![40] !== defaultWire(byAddress.get(40)!),
    );
  });

  it("never compares the five fictions or the firmware version", () => {
    const state = dumped(factoryDump());
    for (const address of [...NEUTRALISED.keys(), 7]) {
      expect(differsFromDefault(state, address)).toBe(false);
    }
  });

  it("says nothing about an address no parameter claims", () => {
    expect(differsFromDefault(dumped(), 18)).toBe(false);
  });

  it("has nothing off default before the first dump", () => {
    expect(differsFromDefault(initialParametersState, 40)).toBe(false);
  });
});

describe("the edit buffer the dock lists (SPEC.md 7.3, A.6)", () => {
  it("is empty on the dump that captured the reference", () => {
    expect(editBuffer(dumped())).toEqual([]);
  });

  it("carries what the value was and what it is", () => {
    const state = apply(
      { type: "edit", address: 40, value: 999 },
      "connected",
      dumped(),
    ).state;

    const rows = editBuffer(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].parameter.address).toBe(40);
    expect(rows[0].stored).toBe(40);
    expect(rows[0].current).toBe(999);
  });

  it("never lists the five physical knobs, which get one line instead", () => {
    // They are the `hidden` group, so they are not among the 189 the panel
    // draws — and the dock's fiction line is the whole of what it says of them.
    const drifted = (() => {
      const state = dumped();
      return {
        ...state,
        values: state.values!.map((value, address) =>
          address <= 7 ? value + 1 : value,
        ),
      };
    })();

    for (const row of editBuffer(drifted)) {
      expect(row.parameter.address).toBeGreaterThan(7);
    }
  });

  it("holds nothing before the first dump", () => {
    expect(editBuffer(initialParametersState)).toEqual([]);
  });
});
