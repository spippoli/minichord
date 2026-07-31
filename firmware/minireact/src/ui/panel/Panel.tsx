import { kindOf, visibleParameters, type Section } from "../../domain";
import { ParameterBinding } from "../parameters/ParameterBinding";
import styles from "./Panel.module.css";

/**
 * The workbench, at its first size: one section, a flat list.
 *
 * The section is picked here in code and the information architecture — the
 * tabs, the plates, the folding and the search of SPEC.md 7.2 — comes with the
 * ticket that owns it. What is already true of it is that **exactly one section
 * is mounted at a time**, which is the assumption the render cost of SPEC.md
 * 7.6 was measured under.
 *
 * Every kind is drawn but the sequencer: the rhythm masks are one grid and not
 * sixteen controls (SPEC.md 8.3), and the grid arrives with its own ticket.
 */
const SECTION: Section = "global";

const drawn = visibleParameters.filter(
  (parameter) =>
    parameter.section === SECTION && kindOf(parameter) !== "sequencer",
);

export function Panel() {
  return (
    <main className={styles.panel}>
      <div className={styles.flow}>
        {drawn.map((parameter) => (
          <ParameterBinding key={parameter.address} parameter={parameter} />
        ))}
      </div>
    </main>
  );
}
