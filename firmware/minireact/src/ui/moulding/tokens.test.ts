import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The moulding's own rules, asserted rather than left to discipline.
 *
 * "No colour literal at a use site" and "the two sets share nothing" (SPEC.md
 * 7.4) are the kind of property that holds on the day it is written and rots
 * quietly afterwards — one `#333` in a hurry and the light moulding is a bug
 * nobody sees on a dark screen. So the stylesheets are read as text, which is
 * the only way to check a claim about CSS from a test that has no DOM.
 *
 * They are read from disk, and this file is therefore the one thing under
 * `src/` that belongs to `tsconfig.node.json` rather than to the app: Vitest
 * stubs CSS imports to the empty string, so `?raw` and `import.meta.glob`
 * both come back with nothing, and the app project carries no Node types on
 * purpose. Excluding one test is cheaper than handing every module in `src/`
 * a `process` it should not be able to reach.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI = join(HERE, "..");
const INDEX = join(UI, "..", "index.css");
const MOULDING = join(HERE, "moulding.css");

/** Comments carry the words `currentColor` and `canvas` on purpose. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function read(path: string): string {
  return withoutComments(readFileSync(path, "utf8"));
}

/** Every file under `ui/` with one of these extensions, plus what is passed. */
function sources(extension: string, ...extra: string[]): string[] {
  const found = [...extra];

  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(extension)) found.push(path);
    }
  }
  walk(UI);

  return found;
}

const moulding = read(MOULDING);

/** The custom properties declared by one rule of `moulding.css`. */
function tokensOf(selector: string): Map<string, string> {
  const at = moulding.indexOf(`${selector} {`);
  expect(at, `${selector} declares tokens`).toBeGreaterThanOrEqual(0);

  const body = moulding.slice(
    at + selector.length + 2,
    moulding.indexOf("}", at),
  );
  const tokens = new Map<string, string>();

  for (const declaration of body.split(";")) {
    const [name, ...rest] = declaration.split(":");
    if (!name.trim().startsWith("--")) continue;
    tokens.set(name.trim(), rest.join(":").replace(/\s+/g, " ").trim());
  }

  return tokens;
}

const dark = tokensOf('[data-moulding="dark"]');
const light = tokensOf('[data-moulding="light"]');

/** The relative brightness of a `#rrggbb`, which is all the swaps need. */
function brightness(hex: string): number {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("the two token sets", () => {
  it("are two complete sets under the same names", () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
    // "Roughly 55 tokens each" (SPEC.md 7.4) — a floor, not a budget.
    expect(dark.size).toBeGreaterThanOrEqual(50);
  });

  it("share no value at all", () => {
    const sameRole = [...dark].filter(
      ([name, value]) => light.get(name) === value,
    );
    expect(sameRole).toEqual([]);

    // Not even across roles: a "shared neutral" is how the light moulding
    // becomes the dark one lightened (SPEC.md 7.4).
    const lightValues = new Set(light.values());
    const anyRole = [...new Set(dark.values())].filter((value) =>
      lightValues.has(value),
    );
    expect(anyRole).toEqual([]);
  });

  it("swap the cap: light on the dark plastic, dark on the cream", () => {
    expect(brightness(dark.get("--cap")!)).toBeGreaterThan(
      brightness(dark.get("--plastic")!),
    );
    expect(brightness(light.get("--cap")!)).toBeLessThan(
      brightness(light.get("--plastic")!),
    );
  });

  it("swap the LCD: negative and glowing, positive and not", () => {
    // Dark moulding: ink brighter than the glass, and a glow around it.
    expect(brightness(dark.get("--lcd-ink")!)).toBeGreaterThan(
      brightness(dark.get("--lcd")!),
    );
    expect(dark.get("--lcd-glow")).not.toMatch(/^inset/);

    // Light moulding: dark ink on grey-green, and no glow — a printed recess
    // instead, which is what the `inset` says.
    expect(brightness(light.get("--lcd-ink")!)).toBeLessThan(
      brightness(light.get("--lcd")!),
    );
    expect(light.get("--lcd-glow")).toMatch(/^inset/);
    expect(light.get("--window-glow")).toMatch(/^inset/);

    // Cream plastic, which is what makes the positive LCD the right object.
    expect(brightness(light.get("--plastic")!)).toBeGreaterThan(200);
  });

  it("swap the window and the LED with it", () => {
    expect(brightness(dark.get("--window-ink")!)).toBeGreaterThan(
      brightness(dark.get("--window")!),
    );
    expect(brightness(light.get("--window-ink")!)).toBeLessThan(
      brightness(light.get("--window")!),
    );
    expect(brightness(dark.get("--led-ink")!)).toBeLessThan(
      brightness(dark.get("--led")!),
    );
    expect(brightness(light.get("--led-ink")!)).toBeGreaterThan(
      brightness(light.get("--led")!),
    );
  });
});

describe("the panel's colour", () => {
  it("is never a literal at a use site", () => {
    const literals =
      /#[0-9a-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?|color-mix|light-dark)\(/i;
    // Hyphen-aware, or `white-space` reads as a colour.
    const named =
      /(?<![\w-])(?:currentColor|canvas(?:text)?|white|black|red|blue|gray|grey)(?![\w-])/i;

    for (const path of sources(".css", INDEX)) {
      if (path === MOULDING) continue;
      expect(read(path), path).not.toMatch(literals);
      expect(read(path), path).not.toMatch(named);
    }
  });

  it("is never a literal in a component either", () => {
    const literals = /#[0-9a-f]{3,8}["'`]|(?<![\w-])(?:rgba?|hsla?)\(/i;

    for (const path of sources(".tsx")) {
      expect(read(path), path).not.toMatch(literals);
    }
  });

  it("names only tokens the moulding declares", () => {
    const declared = new Set([
      ...(moulding.match(/--[a-z-]+(?=\s*:)/g) ?? []),
      // Set inline on the root and on the `bank color` control, which is where
      // a value that *is* a colour comes from (SPEC.md 7.4, 8.5).
      "--hue",
      "--cap-hue",
    ]);

    for (const path of sources(".css", INDEX)) {
      for (const used of read(path).matchAll(/var\((--[a-z-]+)/g)) {
        expect(declared, `${used[1]} in ${path}`).toContain(used[1]);
      }
    }
  });
});

describe("the focus ring", () => {
  it("is the LCD's own ink, and there is one of it", () => {
    expect(moulding).toMatch(/--focus-ring:\s*var\(--lcd-ink\)/);

    const global = read(INDEX);
    expect(global).toMatch(
      /\*:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/,
    );
    expect(global).toMatch(/outline-offset:\s*2px/);
    // Inset on a sequencer cell, where a 2 px ring outside a 12 px square
    // invades its neighbours (SPEC.md 12.7).
    expect(global).toMatch(/data-step.*:focus-visible/);
    expect(global).toMatch(/outline-offset:\s*-2px/);
  });

  it("is never redeclared, so no control falls back to the system blue", () => {
    for (const path of sources(".css")) {
      // The ring itself: drawn once, globally, and nowhere else.
      expect(read(path), path).not.toMatch(/outline/);
      // And `:focus-visible` throughout, never bare `:focus`, or a window lights
      // up under the mouse. A module may still key layout off the focus — the
      // skip link leaves its clipped state that way — as long as it leaves the
      // ring alone, which the assertion above is what enforces.
      expect(read(path), path).not.toMatch(/:focus(?!-visible)/);
    }
  });
});

describe("the bank hue", () => {
  it("reaches the bank LED in the strip, and nothing else", () => {
    const users = sources(".css").filter((path) =>
      /var\(--tint\)/.test(read(path)),
    );
    expect(users).toEqual([join(UI, "Strip.module.css")]);
  });
});
