import { Gate } from "./Gate";
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
 * The editor itself is a placeholder here. It arrives one control at a time,
 * starting with the tracer bullet of the next ticket.
 */
export function App() {
  const { connection } = useAppState();
  const onDevice =
    connection.status === "connected" || connection.status === "interrupted";

  if (!onDevice) return <Gate />;

  return (
    <>
      <Strip />
      <main>
        <p>The editor goes here.</p>
      </main>
    </>
  );
}
