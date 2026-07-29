import { useEffect, useRef, useState } from "react";

import { MinichordSimulator, PARAMETER_SIZE } from "./simulator";

/**
 * A bench for the protocol simulator, not a user interface.
 *
 * Deliberately unstyled and unstructured: the information architecture (#9)
 * and the parameter control (#10) are open questions, and nothing here should
 * be mistaken for an answer to either. It exists to prove the simulator runs
 * in the browser and to give a prototype something to copy from.
 *
 * The legacy port-matching rule is inlined here because the transport module
 * does not exist yet -- this map is a specification, not an implementation.
 */
const matchLegacyPort = (name: string): boolean =>
  (name.includes("minichord") && name.includes("1")) || name === "minichord";

interface Log {
  at: number;
  text: string;
}

export function SimulatorConsole() {
  const simulator = useRef<MinichordSimulator | null>(null);
  if (simulator.current === null) simulator.current = new MinichordSimulator();
  const sim = simulator.current;

  const [values, setValues] = useState<number[] | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [connected, setConnected] = useState(true);
  const started = useRef(performance.now());

  const log = (text: string) =>
    setLogs((previous) =>
      [{ at: performance.now() - started.current, text }, ...previous].slice(
        0,
        40,
      ),
    );

  const outputRef = useRef<MIDIOutput | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const access = await sim.requestAccess({ sysex: true });
      if (cancelled) return;

      for (const input of access.inputs.values()) {
        if (!matchLegacyPort(input.name ?? "")) continue;
        input.onmidimessage = (event) => {
          const data = new Uint8Array(event.data!);
          if (data.length !== PARAMETER_SIZE * 2 + 2) {
            log(`ignored a ${data.length}-byte message`);
            return;
          }
          const payload = data.slice(1, -1);
          const decoded = Array.from(
            { length: PARAMETER_SIZE },
            (_, i) => payload[2 * i] + 128 * payload[2 * i + 1],
          );
          setValues(decoded);
          log(`dump: bank ${decoded[1]}, firmware ${decoded[7]}`);
        };
      }
      for (const output of access.outputs.values()) {
        if (matchLegacyPort(output.name ?? "")) outputRef.current = output;
      }
      access.onstatechange = (event) => {
        const port = (event as MIDIConnectionEvent).port;
        setConnected(port?.state === "connected");
        log(`statechange: ${port?.name} is ${port?.state}`);
      };
      log("access granted");
      requestDump();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (bytes: number[]) => {
    try {
      outputRef.current?.send(bytes);
    } catch (error) {
      log(`send failed: ${(error as Error).message}`);
    }
  };

  const requestDump = () => send([0xf0, 0, 0, 0, 0, 0xf7]);

  const presetLoad = () => {
    const started = performance.now();
    for (let address = 2; address < PARAMETER_SIZE; address += 1) {
      send([0xf0, address % 128, Math.floor(address / 128), 1, 0, 0xf7]);
    }
    send([0xf0, 0, 0, 0, 0, 0xf7]);
    log(
      `queued a 254-message preset load in ${(performance.now() - started).toFixed(1)} ms`,
    );
  };

  return (
    <main
      style={{
        fontFamily: "monospace",
        padding: "1rem",
        display: "grid",
        gap: "1rem",
      }}
    >
      <h1 style={{ font: "inherit", fontWeight: 700 }}>
        minichord protocol simulator &mdash; bench, not UI
      </h1>

      <p>
        device is <strong>{connected ? "connected" : "disconnected"}</strong>
      </p>

      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        <button onClick={requestDump}>request dump (0, 0)</button>
        <button onClick={presetLoad}>load a 254-message preset</button>
        <button onClick={() => send([0xf0, 0, 0, 2, 3, 0xf7])}>
          save to bank 3
        </button>
        <button onClick={() => send([0xf0, 0, 0, 3, 0, 0xf7])}>
          reset bank 0
        </button>
        <button onClick={() => sim.pressPresetButton(1)}>
          preset button up
        </button>
        <button onClick={() => sim.pressPresetButton(-1)}>
          preset button down
        </button>
        <button
          onClick={() => (connected ? sim.disconnect() : sim.reconnect())}
        >
          {connected ? "unplug" : "plug back in"}
        </button>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}
      >
        <section>
          <h2 style={{ font: "inherit", fontWeight: 700 }}>events</h2>
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {logs.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                {(entry.at / 1000).toFixed(3)}s {entry.text}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 style={{ font: "inherit", fontWeight: 700 }}>256 values</h2>
          <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            {values === null ? (
              <p>no dump yet</p>
            ) : (
              <ol start={0} style={{ margin: 0, columns: "6em" }}>
                {values.map((value, address) => (
                  <li key={address} value={address}>
                    {value}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
