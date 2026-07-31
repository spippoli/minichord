import { describe, expect, it, vi } from "vitest";

import {
  DARK_MOULDING_QUERY,
  mouldingOf,
  observeMoulding,
  type MouldingMedia,
} from "./moulding";

/** A `MediaQueryList` the test can flip, which is all the rule ever reads. */
function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>();

  const media = {
    matches,
    addEventListener: vi.fn((_type: "change", listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: "change", listener: () => void) => {
      listeners.delete(listener);
    }),
    /** The OS changing its mind. */
    flip() {
      media.matches = !media.matches;
      for (const listener of listeners) listener();
    },
    listeners,
  };

  return media as MouldingMedia & typeof media;
}

describe("the moulding", () => {
  it("is chosen by `prefers-color-scheme` and nothing else", () => {
    expect(DARK_MOULDING_QUERY).toBe("(prefers-color-scheme: dark)");
    expect(mouldingOf({ matches: true })).toBe("dark");
    expect(mouldingOf({ matches: false })).toBe("light");
  });

  it("is subscribed to, so an OS flip re-moulds without a reload", () => {
    const media = fakeMedia(false);
    const onChange = vi.fn();

    observeMoulding(media, onChange);
    expect(mouldingOf(media)).toBe("light");

    media.flip();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(mouldingOf(media)).toBe("dark");
  });

  it("stops listening when the root goes away", () => {
    const media = fakeMedia(true);
    const onChange = vi.fn();

    observeMoulding(media, onChange)();
    media.flip();

    expect(media.listeners.size).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
