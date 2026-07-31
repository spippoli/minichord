/**
 * What a section is made of, and what a search finds in it — the pure half of
 * the panel's information architecture (SPEC.md 7.2, 7.3).
 *
 * It is a module rather than component state because both answers are facts
 * about `parameters.json` and a string, and because the plates of SPEC.md 7.2
 * are a table that can then be asserted rather than described.
 *
 * The one data quirk absorbed here: **groups are merged by name.** `group` is
 * not contiguous in the file — the global "Settings" group appears in two
 * blocks, and the legacy generator, grouping without sorting, draws it twice
 * (6 parameters, then 4). One plate of 10. That is a quirk to absorb, not a
 * structure to reproduce.
 */

import { visibleParameters, type Parameter, type Section } from "../../domain";

/** A group of the section, drawn as one collapsible plate. */
export interface Plate {
  section: Section;
  group: string;
  parameters: readonly Parameter[];
}

/** What identifies a plate to the fold state, across a section switch. */
export function plateKey(plate: Plate): string {
  return `${plate.section}/${plate.group}`;
}

function buildPlates(section: Section): readonly Plate[] {
  const plates: Plate[] = [];
  const byGroup = new Map<string, Parameter[]>();

  // In the order the groups first appear in the file, which is the order the
  // panel draws them in (SPEC.md 7.2).
  for (const parameter of visibleParameters) {
    if (parameter.section !== section) continue;

    const merged = byGroup.get(parameter.group);
    if (merged) {
      merged.push(parameter);
      continue;
    }

    const first: Parameter[] = [parameter];
    byGroup.set(parameter.group, first);
    plates.push({ section, group: parameter.group, parameters: first });
  }

  return plates;
}

const PLATES: Readonly<Record<Section, readonly Plate[]>> = {
  global: buildPlates("global"),
  harp: buildPlates("harp"),
  chord: buildPlates("chord"),
};

/** The plates of one section, in the order of SPEC.md 7.2. */
export function platesOf(section: Section): readonly Plate[] {
  return PLATES[section];
}

/**
 * Whether a search finds this parameter: name, group, tooltip or raw address
 * (SPEC.md 7.3).
 *
 * An empty query is **not** a search. The section is being browsed, folding
 * still applies, and no tab lights with a count.
 */
export function matchesQuery(parameter: Parameter, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return false;

  return (
    parameter.name.toLowerCase().includes(needle) ||
    parameter.group.toLowerCase().includes(needle) ||
    parameter.tooltip.toLowerCase().includes(needle) ||
    String(parameter.address).includes(needle)
  );
}

/**
 * How many parameters of a section a query finds.
 *
 * This is what makes scoping the search to the section on screen admissible:
 * **the tab of every other section lights with its own match count**, so a hit
 * elsewhere is never invisible (SPEC.md 7.3).
 */
export function sectionMatchCount(section: Section, query: string): number {
  let found = 0;
  for (const plate of platesOf(section)) {
    for (const parameter of plate.parameters) {
      if (matchesQuery(parameter, query)) found += 1;
    }
  }
  return found;
}
