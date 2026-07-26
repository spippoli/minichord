# minichord protocol simulator

A throwaway fake of the minichord, so that prototypes and development can run
with no hardware attached. Built for
[issue #7](https://github.com/spippoli/minichord/issues/7); it is a **fixture
for design work, not a deliverable of the spec**, and it is expected to be
thrown away once the real app exists.

## Running it

```bash
cd firmware/minireact
npm install
npm run dev     # boots the bench in src/dev/SimulatorConsole.tsx
npm test        # the simulator's own tests
```

`npm run dev` currently mounts `SimulatorConsole`, a deliberately unstyled bench
with buttons for every command, the preset buttons and unplugging. It is **not a
user interface** — the information architecture
([#9](https://github.com/spippoli/minichord/issues/9)) and the parameter control
([#10](https://github.com/spippoli/minichord/issues/10)) are still open
questions, and nothing in that file answers either.

## Using it

The seam is the one drawn in
[#6](https://github.com/spippoli/minichord/issues/6): the simulator fakes
`MIDIAccess`, not the transport. Inject its `requestAccess` and the real
transport runs unchanged — real 6-byte framing, real 7-bit split, real
513-byte dump decoding, real port matching — so the two cannot drift apart.

```ts
import { MinichordSimulator } from './dev/simulator'

const simulator = new MinichordSimulator()
const transport = new MinichordTransport({ requestAccess: simulator.requestAccess })

// drive the physical side the app cannot reach
simulator.pressPresetButton(1) // emits an unsolicited dump
simulator.disconnect()
simulator.reconnect()
```

Options: `initialBank`, `firmwareVersion` (lower it to exercise
`introduction_version` gating), `portNames`, and `realisticTiming` (set `false`
for deterministic tests — everything then resolves on a microtask).

## What it models

- The four commands: `0` dump, `1` wipe memory, `2` save to bank, `3` reset bank.
- Parameter writes, reflected in the next dump.
- The 12 banks, with the firmware's **real** factory content, extracted from
  `default_bank_sysex_parameters` in `firmware/src/main.cpp` by
  `tools/extract-firmware-defaults.py` into `defaultBanks.ts`.
- Port enumeration (two ports), connect/disconnect and `statechange`.
- The measured ingest rate and dump latency (see Calibration).

Three firmware behaviours it reproduces on purpose, because an app built
against a politer device would be wrong:

- **Dumps arrive unsolicited.** `load_config` ends with `control_command(0, 0)`,
  so *every* bank load emits a dump nobody asked for — after a save, after a
  reset, after a wipe, and after a press of the physical preset buttons.
- **Saving to a bank also switches to it.** `save_config` assigns
  `current_bank_number = bank_number` before writing, then reloads.
- **There is no address protection at all.** The firmware executes
  `current_sysex_parameters[adress] = value` unconditionally; the "protected"
  (2–9) and "limited access" (10–17) ranges are conventions of the editor, not
  of the device.

## What it does not model

- **Audio, ever.** Nothing here knows what a parameter sounds like, so **no
  sound decision can be validated against it**.
- Flash persistence across restarts: banks live in memory and reset with the page.
- MIDI beyond SysEx (note on/off, clock, start/stop, the rhythm engine).
- The potentiometers, which on the real device write addresses 2–6 on their own.
- Message loss: none was observed on the real device at any pacing (see below),
  so there is nothing to reproduce.

## Calibration

Measured on 2026-07-26 against a minichord running firmware version 8, over
ALSA rawmidi on Linux. Reproduce with:

```bash
python3 tools/measure-device.py --json measurements.json
```

| Quantity | Value | How |
| --- | --- | --- |
| Ingest rate | **0.581 ms/message** (~1720 msg/s) | slope of burst drain time over 25–800 messages, linear with no knee |
| Dump round-trip | median **0.81 ms**, p95 1.41 ms, max 1.91 ms | 500 consecutive `(0, 0)` commands, 0 timeouts |
| Save round-trip | **164 ms** | `(2, 0)`, timed to the unsolicited dump that follows |
| Message loss | **0** | 0/195 across seven pacings incl. none; 0/117 probe slots in 254-message preset loads |

The ingest figure is not a browser limit — it is the firmware. `loop()` calls
`usbMIDI.read()` exactly once per iteration, so ingest is capped at one SysEx
per main-loop iteration, and 0.581 ms *is* that iteration.

Two things the harness could not verify on hardware and that are therefore
modelled from `firmware/src/main.cpp` alone:

- **Command 3 (reset bank to defaults)** — destructive to the operator's own
  bank, so it was never sent.
- **The physical preset buttons** — a 90-second listening window recorded no
  press.

Both follow the same `load_config` path as the commands that *were* verified to
emit an unsolicited dump, so the risk is low, but it is untested.
