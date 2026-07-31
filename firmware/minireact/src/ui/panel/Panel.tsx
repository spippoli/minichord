import { kindOf, visibleParameters, type Section } from "../../domain";
import { ParameterBinding } from "../parameters/ParameterBinding";
import styles from "./Panel.module.css";

/**
 * The workbench, at its first size: one section, one kind, a flat list.
 *
 * The section is picked here in code and the information architecture — the
 * tabs, the plates, the folding and the search of SPEC.md 7.2 — comes with the
 * ticket that owns it. What is already true of it is that **exactly one section
 * is mounted at a time**, which is the assumption the render cost of SPEC.md
 * 7.6 was measured under.
 *
 * Only the faders are drawn: the kind is derived from the parameter (SPEC.md
 * 8.1), and the five other kinds put a different widget in the same slot
 * without touching the repertoire the control already owns.
 */
const SECTION: Section = "global";

const drawn = visibleParameters.filter(
  (parameter) =>
    parameter.section === SECTION && kindOf(parameter) === "slider",
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
