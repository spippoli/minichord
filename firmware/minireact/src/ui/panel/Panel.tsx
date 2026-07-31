import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { byAddress, type Section } from "../../domain";
import { focusParameter, setParameterReveal } from "./focusParameter";
import styles from "./Panel.module.css";
import { Plate } from "./Plate";
import { matchesQuery, plateKey, platesOf, sectionMatchCount } from "./plates";

/**
 * The workbench: three sections, plates in a packed flow, and a search box
 * (SPEC.md 7.1–7.3).
 *
 * **Exactly one section is mounted at a time** — the assumption the render cost
 * of SPEC.md 7.6 was measured under, which is also why nothing here is
 * virtualised and no control is memoised: the worst case this design allows
 * costs React 2.5 ms median against a 16 ms frame.
 *
 * Search is scoped to the section on screen, and that is only admissible
 * because **the tab of every other section lights with its own match count**,
 * so a hit elsewhere is never invisible. **While a search is running, folding
 * is ignored**: a hit inside a folded plate is a hit nobody can see.
 */

/** The three sections, in the order their tabs stand (SPEC.md A.6). */
const SECTIONS: readonly { section: Section; label: string }[] = [
  { section: "global", label: "Global" },
  { section: "harp", label: "Harp" },
  { section: "chord", label: "Chord" },
];

export function Panel() {
  const [section, setSection] = useState<Section>("global");
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const searching = query.trim() !== "";
  const tabId = useId();
  const search = useRef<HTMLInputElement>(null);
  const tabs = useRef<HTMLDivElement>(null);

  /**
   * The whole of `focusParameter`'s "switch section, unfold the plate" — the
   * behaviour it carries behind a signature of one argument (SPEC.md 6.1,
   * invariant 6). Its callers learn none of it.
   *
   * A running search is the third way a control can be off screen, and it is
   * the panel's own state exactly as the fold is: a query the target does not
   * match is dropped, or the DOM query after the commit finds nothing and the
   * focus silently stays where it was — the failure the invariant is worded
   * against. A query it *does* match is left alone, so `Ctrl+K` then `Tab` does
   * not empty the box the user has just typed into.
   */
  useEffect(
    () =>
      setParameterReveal((address) => {
        const parameter = byAddress.get(address);
        if (!parameter) return;

        setSection(parameter.section);
        setQuery((current) =>
          current.trim() === "" || matchesQuery(parameter, current)
            ? current
            : "",
        );
        setFolded((current) => {
          const key = plateKey(parameter);
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }),
    [],
  );

  /** `Ctrl+K` focuses the search, from anywhere in the panel (SPEC.md 12.3). */
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (!event.ctrlKey || event.key !== "k") return;
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const plates = platesOf(section);
  const visible = plates.map((plate) => ({
    plate,
    parameters: searching
      ? plate.parameters.filter((parameter) => matchesQuery(parameter, query))
      : plate.parameters,
  }));

  /** Where `Ctrl+K` then `Tab` goes: the first *matching* control. */
  const firstMatch = searching
    ? visible.flatMap((each) => each.parameters)[0]
    : undefined;

  /**
   * `Fold all` / `Open all` act on the current section (SPEC.md 7.2) — which is
   * why the fold state is keyed by section and group, and why opening this
   * section subtracts its own keys rather than emptying the set: the two
   * sections not on screen keep the shape the user left them in.
   */
  function foldAll(fold: boolean) {
    setFolded((current) => {
      const next = new Set(current);
      for (const plate of plates) {
        if (fold) next.add(plateKey(plate));
        else next.delete(plateKey(plate));
      }
      return next;
    });
  }

  function toggleFold(key: string) {
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  /** The tabs are a real `tablist`: one tab stop, arrows change section. */
  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const at = SECTIONS.findIndex((each) => each.section === section);
    const next = SECTIONS[(at + step + SECTIONS.length) % SECTIONS.length];
    setSection(next.section);
    tabs.current
      ?.querySelector<HTMLElement>(`[data-section="${next.section}"]`)
      ?.focus();
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      return;
    }
    // Without this, Tab crosses `fold all`, `open all`, the strip and the
    // readout first — four or five stops of friction on every search.
    if (event.key === "Tab" && !event.shiftKey && firstMatch) {
      event.preventDefault();
      focusParameter(firstMatch.address);
    }
  }

  return (
    <main className={styles.panel}>
      <div className={styles.chrome}>
        <div
          ref={tabs}
          className={styles.tabs}
          role="tablist"
          onKeyDown={onTabKeyDown}
        >
          {SECTIONS.map((tab) => {
            const matches = searching
              ? sectionMatchCount(tab.section, query)
              : 0;
            return (
              <button
                key={tab.section}
                type="button"
                role="tab"
                id={`${tabId}-${tab.section}`}
                data-section={tab.section}
                className={styles.tab}
                aria-selected={tab.section === section}
                aria-controls={`${tabId}-panel`}
                tabIndex={tab.section === section ? 0 : -1}
                title={matches > 0 ? `${matches} matches` : undefined}
                onClick={() => setSection(tab.section)}
              >
                {tab.label}
                {/* The count itself is the LED (SPEC.md A.6). */}
                {matches > 0 && (
                  <span className={styles.tabMatches}>{matches}</span>
                )}
              </button>
            );
          })}
        </div>

        <label className={styles.search}>
          Search
          <input
            ref={search}
            type="search"
            placeholder="Search this section"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </label>

        <div className={styles.folds}>
          <button type="button" onClick={() => foldAll(true)}>
            Fold all
          </button>
          <button type="button" onClick={() => foldAll(false)}>
            Open all
          </button>
        </div>
      </div>

      <div
        id={`${tabId}-panel`}
        className={styles.flow}
        role="tabpanel"
        aria-labelledby={`${tabId}-${section}`}
      >
        {visible.map(({ plate, parameters }) => {
          // A search finding nothing in a plate removes the plate, rather than
          // leaving an empty one to be read as a plate with nothing in it.
          if (searching && parameters.length === 0) return null;

          return (
            <Plate
              key={plateKey(plate)}
              plate={plate}
              // Folding is ignored while a search is running (SPEC.md 7.3).
              folded={!searching && folded.has(plateKey(plate))}
              onFold={() => toggleFold(plateKey(plate))}
              matching={parameters}
            />
          );
        })}
      </div>
    </main>
  );
}
