import type { CSSProperties, ReactNode } from "react";

import { BANK_COLOR_ADDRESS } from "../domain";
import { isGateStatus } from "../state";
import { BankActions } from "./banks/BankActions";
import { Gate } from "./Gate";
import styles from "./App.module.css";
import "./moulding/moulding.css";
import { useMoulding } from "./moulding/useMoulding";
import { Panel } from "./panel/Panel";
import { Readout } from "./readout/Readout";
import { ReadoutProvider } from "./readout/ReadoutProvider";
import { useAppState } from "./runtimeContext";
import { Strip } from "./Strip";

/**
 * The application shell: a gate, or an editor. Never both.
 *
 * The branch is mutually exclusive at the top level on purpose (SPEC.md 9.1):
 * before the first dump the app *is* the connection screen, and after it the
 * editor is the app and the connection is one line of the top bar. The two
 * states after the dump — `connected` and `interrupted` — are both the editor;
 * a mid-session disconnect never re-opens the gate.
 *
 * Two single-instance channels stand here side by side, on different clocks and
 * deliberately unmerged (SPEC.md 6.1, invariant 7): the **strip** says what
 * happened to the device and is the app's only voice, while the **readout**
 * explains what is under the hand right now and is mute for a screen reader.
 * There is **exactly one** readout in the tree, and this is it.
 *
 * Both branches stand on the panel root, because the moulding is the app's
 * surface and not the editor's: a gate cast in a different plastic from the
 * panel behind it would be a second design (SPEC.md 7.4).
 */
export function App() {
  const { connection } = useAppState();

  if (isGateStatus(connection.status))
    return (
      <PanelRoot>
        <Gate status={connection.status} />
      </PanelRoot>
    );

  return (
    <PanelRoot>
      <ReadoutProvider>
        <Strip />
        <Readout />
        {/*
          The editing row stands between the two channels and the workbench:
          what it commits is the whole panel below it, and the maintenance area
          it must be away from is at the far end of that panel (SPEC.md 10.6).
        */}
        <BankActions />
        <Panel />
      </ReadoutProvider>
    </PanelRoot>
  );
}

/**
 * The panel root: where the moulding is cast and where the bank hue enters.
 *
 * The moulding arrives as an attribute — the two token sets are keyed on it —
 * and `--hue` inline from the live value of address 20 (SPEC.md 7.4). The hue
 * being declared here rather than on the strip is not a leak: it reaches
 * exactly one element, the bank LED, through the one tint rule, and nothing
 * else in the panel reads it.
 *
 * Before the first dump there is no bank to be the colour of, and the gate is
 * what is on screen; 0 is the resting hue rather than a fact about a bank.
 */
function PanelRoot({ children }: { children: ReactNode }) {
  const { parameters } = useAppState();
  const moulding = useMoulding();
  const hue = parameters.values?.[BANK_COLOR_ADDRESS] ?? 0;

  return (
    <div
      className={styles.root}
      data-moulding={moulding}
      style={{ "--hue": hue } as CSSProperties}
    >
      {children}
    </div>
  );
}
