import { describe, expect, it } from "vitest";

import { isCandidatePort } from "./ports";

describe("isCandidatePort", () => {
  it("accepts the names three operating systems invent for the same device", () => {
    // Linux is confirmed; the other two are what the one USB product string
    // plus a per-OS suffix produces (SPEC.md 9.3).
    for (const name of [
      "minichord MIDI 1",
      "minichord MIDI 2",
      "minichord Port 1",
      "minichord",
    ]) {
      expect(isCandidatePort(name)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isCandidatePort("MiniChord MIDI 1")).toBe(true);
    expect(isCandidatePort("MINICHORD")).toBe(true);
  });

  it("does not accept somebody else's synth on the same bus", () => {
    for (const name of ["Midi Through Port-0", "microKORG", "", "chord mini"]) {
      expect(isCandidatePort(name)).toBe(false);
    }
  });

  it("does not try to tell the two cables apart", () => {
    // Only a dump can, which is the whole point of the probe: the filter is a
    // blast radius, not a decision.
    expect(isCandidatePort("minichord MIDI 2")).toBe(
      isCandidatePort("minichord MIDI 1"),
    );
  });
});
