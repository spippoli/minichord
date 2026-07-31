import { describe, expect, it } from "vitest";

import { FIRST_CELL, moveCursor, sameCell } from "./sequencerGrid";

describe("moving inside the grid (SPEC.md 12.4)", () => {
  it("moves one step with the left and right arrows", () => {
    expect(moveCursor({ step: 3, note: 2 }, "ArrowRight")).toEqual({
      step: 4,
      note: 2,
    });
    expect(moveCursor({ step: 3, note: 2 }, "ArrowLeft")).toEqual({
      step: 2,
      note: 2,
    });
  });

  it("moves one row with the up and down arrows", () => {
    expect(moveCursor({ step: 3, note: 2 }, "ArrowDown")).toEqual({
      step: 3,
      note: 3,
    });
    expect(moveCursor({ step: 3, note: 2 }, "ArrowUp")).toEqual({
      step: 3,
      note: 1,
    });
  });

  it("goes to the ends of the row, and only of the row", () => {
    expect(moveCursor({ step: 7, note: 5 }, "Home")).toEqual({
      step: 0,
      note: 5,
    });
    expect(moveCursor({ step: 7, note: 5 }, "End")).toEqual({
      step: 15,
      note: 5,
    });
  });

  it("clamps at the edges rather than wrapping", () => {
    expect(moveCursor({ step: 0, note: 0 }, "ArrowLeft")).toEqual(FIRST_CELL);
    expect(moveCursor({ step: 0, note: 0 }, "ArrowUp")).toEqual(FIRST_CELL);
    expect(moveCursor({ step: 15, note: 6 }, "ArrowRight")).toEqual({
      step: 15,
      note: 6,
    });
    expect(moveCursor({ step: 15, note: 6 }, "ArrowDown")).toEqual({
      step: 15,
      note: 6,
    });
  });

  it("leaves every other key to whatever else wants it", () => {
    // `Space` toggles the cell, and it does so as the button's own activation:
    // a `keydown` handler here would have to suppress the click the browser
    // raises on `keyup`, and the two would flip the same bit twice.
    expect(moveCursor(FIRST_CELL, " ")).toBeNull();
    expect(moveCursor(FIRST_CELL, "Tab")).toBeNull();
    expect(moveCursor(FIRST_CELL, "Enter")).toBeNull();
  });

  it("reaches the steps past any cycle length, which is why it knows none", () => {
    // Skipping them would make them editable by mouse and not by keyboard —
    // the exact disparity SPEC.md 12.4 exists to remove.
    let cursor = FIRST_CELL;
    for (let move = 0; move < 15; move += 1) {
      cursor = moveCursor(cursor, "ArrowRight")!;
    }
    expect(cursor).toEqual({ step: 15, note: 0 });
  });
});

describe("sameCell", () => {
  it("compares the step and the note, and nothing else", () => {
    expect(sameCell({ step: 2, note: 3 }, { step: 2, note: 3 })).toBe(true);
    expect(sameCell({ step: 2, note: 3 }, { step: 3, note: 2 })).toBe(false);
  });
});
