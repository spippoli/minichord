import { isGateStatus } from "../state";
import { Gate } from "./Gate";
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
 */
export function App() {
  const { connection } = useAppState();

  if (isGateStatus(connection.status))
    return <Gate status={connection.status} />;

  return (
    <ReadoutProvider>
      <Strip />
      <Readout />
      <Panel />
    </ReadoutProvider>
  );
}
