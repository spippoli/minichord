import { useState } from "react";

import type { ConnectionState, GateStatus } from "../state";
import { useAppState, useRuntime } from "./runtimeContext";
import styles from "./Gate.module.css";

/**
 * Before the first dump the app is nothing but a connection screen.
 *
 * The store holds nothing until then (SPEC.md 5.2), so there is nothing for an
 * editor to draw: a panel of 189 empty controls is noise imitating an
 * interface. Once the dump lands this is gone for good — a mid-session
 * disconnect does not bring it back, because by then there are values worth
 * looking at (SPEC.md 9.1).
 *
 * Every string here is Appendix A.2, verbatim. They are normative: this is the
 * one part of the app an implementer would otherwise invent without noticing
 * they were deciding.
 */
const TEXT: Record<GateStatus, { heading: string; body: string }> = {
  unsupported: {
    heading: "This browser cannot reach the minichord",
    body: "The minichord is edited over the Web MIDI API, which this browser does not implement. Open this page in Chrome or Edge.",
  },
  blocked: {
    heading: "MIDI access is blocked",
    body: "This site is not allowed to use MIDI. Click the icon at the left of the address bar, set MIDI to Allow, and this page will carry on by itself.",
  },
  idle: {
    heading: "Connect your minichord",
    body: "Plug the minichord in, turn it on, and press Connect. Your browser will ask for permission to use MIDI.",
  },
  searching: {
    heading: "Looking for the minichord…",
    body: "Asking every MIDI port whether it is a minichord.",
  },
  "no-device": {
    heading: "No minichord answered",
    body: "Check that it is plugged in and turned on. If it is, pick its port below — some systems name it in a way this page does not recognise.",
  },
  choose: {
    heading: "More than one minichord answered",
    body: "Pick the one you want to edit.",
  },
};

export function Gate({ status }: { status: GateStatus }) {
  const { connection } = useAppState();
  const { heading, body } = TEXT[status];

  return (
    <main className={styles.gate}>
      <div className={styles.card}>
        <h1 className={styles.heading}>{heading}</h1>
        <p className={styles.body}>{body}</p>
        <Actions connection={connection} />
      </div>
    </main>
  );
}

function Actions({ connection }: { connection: ConnectionState }) {
  const runtime = useRuntime();

  switch (connection.status) {
    case "idle":
      // The prompt is the visible consequence of an act: an unrequested prompt
      // two seconds after load is the one people deny by reflex, and `denied`
      // is sticky (SPEC.md 9.2).
      return (
        <button
          type="button"
          className={styles.action}
          onClick={() => runtime.connect()}
        >
          Connect
        </button>
      );

    case "choose":
      // No invented tie-break: "the first one" means nothing.
      return (
        <ul className={styles.ports}>
          {connection.candidates.map((port) => (
            <li key={port.id}>
              <button
                type="button"
                className={styles.action}
                onClick={() => runtime.pick(port)}
              >
                {port.name}
              </button>
            </li>
          ))}
        </ul>
      );

    case "no-device":
      return <Picker connection={connection} />;

    default:
      // `unsupported` gets no button at all, and `blocked` gets no button
      // either: the recovery is in the address bar, and the page leaves the
      // state by itself when the permission is flipped back.
      return null;
  }
}

/**
 * The manual picker over *all* MIDI output ports.
 *
 * Port names are invented by each operating system, so a name this page does
 * not recognise is an ordinary outcome rather than an error. Picking a port
 * probes it, and a port that stays mute says so and leaves us disconnected —
 * never "connected blind" (SPEC.md 9.3).
 */
function Picker({ connection }: { connection: ConnectionState }) {
  const runtime = useRuntime();
  const [chosen, setChosen] = useState<string>("");
  const selected =
    connection.ports.find((port) => port.id === chosen) ?? connection.ports[0];

  return (
    <div className={styles.picker}>
      {connection.probing ? (
        <p className={styles.note}>Asking that port…</p>
      ) : null}
      {connection.mute ? (
        <p className={styles.note}>
          That port did not answer. It is either not a minichord, or not its
          control port.
        </p>
      ) : null}

      {connection.ports.length > 0 ? (
        <p className={styles.field}>
          <label className={styles.label} htmlFor="gate-port">
            MIDI output port
          </label>
          <select
            id="gate-port"
            className={styles.select}
            value={selected?.id ?? ""}
            onChange={(event) => setChosen(event.target.value)}
          >
            {connection.ports.map((port) => (
              <option key={port.id} value={port.id}>
                {port.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.action}
            disabled={!selected || connection.probing !== null}
            onClick={() => selected && runtime.pick(selected)}
          >
            Pick a port
          </button>
        </p>
      ) : null}

      <button
        type="button"
        className={styles.action}
        disabled={connection.probing !== null}
        onClick={() => runtime.retry()}
      >
        Try again
      </button>
    </div>
  );
}
