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
npm run dev     # the app shell — blank until ui/ is built
npm test        # the simulator's own tests
```

`SimulatorConsole` is a deliberately unstyled bench with buttons for every
command, the preset buttons and unplugging. It used to be what `npm run dev`
mounted; now that implementation has started, `src/ui/App.tsx` is the root, and
the bench is mounted there by hand when the simulator needs exercising. It is
**not a user interface** — the information architecture
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
import { MinichordSimulator } from "./dev/simulator";

const simulator = new MinichordSimulator();
const transport = new MinichordTransport({
  requestAccess: simulator.requestAccess,
});

// drive the physical side the app cannot reach
simulator.pressPresetButton(1); // emits an unsolicited dump
simulator.disconnect();
simulator.reconnect();
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
  so _every_ bank load emits a dump nobody asked for — after a save, after a
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
- Message loss: none was ever detected on the real device at any pacing, so
  there is nothing to reproduce — but see the bound under Calibration before
  reading that as a guarantee.

## Calibration

Measured on 2026-07-26 against a minichord running firmware version 8, over
ALSA rawmidi on Linux. Reproduce with:

```bash
python3 tools/measure-device.py --json measurements.json
```

| Quantity             | Value                                        | How                                                                                             |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Ingest rate          | **0.581 ms/message** (~1720 msg/s)           | slope of burst drain time over 25–800 messages                                                  |
| Dump round-trip      | median **0.81 ms**, p95 1.41 ms, max 1.91 ms | 500 consecutive `(0, 0)` commands, 0 timeouts                                                   |
| Flash write + reload | **164 ms**                                   | a save, timed to the unsolicited dump that follows — _not_ reproduced by the harness, see below |
| Message loss         | **none detected**, bounded at ~2.5%/message  | 0/195 across seven pacings; 0/117 probe slots in 254-message preset loads                       |

The ingest figure is not a browser limit — it is the firmware. `loop()` calls
`usbMIDI.read()` exactly once per iteration, so ingest is capped at one SysEx
per main-loop iteration, and 0.581 ms _is_ that iteration.

### What the numbers do not establish

**"Zero loss" is a detection result, not an absence proof.** T4 writes all 254
addresses but only the ~39 unclaimed ones carry a sentinel; the other 215 are
rewritten with the value the device already holds, so losing one leaves the
following dump byte-identical. 117 clean probe slots bound per-message loss at
`1 - 0.05^(1/117)` ≈ **2.5%**, which over a 254-message preset load allows up to
about **6 silently dropped parameters**. None of the probes falls in 220–235
either, so the rhythm bitmasks that close every burst have no coverage at all.
Nothing was ever observed to drop, and the simulator drops nothing — but an app
that sends a preset load unpaced should still confirm with a dump rather than
assume. Tightening this means giving every address a detectable sentinel.

**The ingest slope is a floor.** T2 sends all its messages to one _unclaimed_
address, so `apply_audio_parameter` falls through the switch and does no work.
A real preset load hits 254 live cases, several doing float math on audio
objects. 0.581 ms/message is the cheapest possible message, and the ~148 ms
preset-load budget derived from it is a lower bound. The fit is also
leverage-heavy — n=400 and n=800 carry ~72% of the slope — so it constrains a
knee above n=400 far better than one below it.

**The 164 ms figure is not reproducible with the checked-in harness.** It never
sends command 2, by design: nothing it does may touch flash. Re-running
`measure-device.py` after a firmware change will refresh every row of the table
except that one.

### Modelled from source, never seen on hardware

- **Command 1 (wipe) and command 3 (reset bank)** — both destructive to the
  operator's own banks, so neither was sent. Both call `save_config(…, true)`
  (command 1 after a `quickFormat`), the same erase-write-reload as a save, so
  the simulator charges them the same 164 ms.
- **The physical preset buttons** — a 90-second listening window recorded no
  press. They run `load_config` alone: a flash _read_ with no write, so cheaper
  than a save, but by an unknown margin. The simulator uses the 164 ms as an
  upper bound, erring towards making a prototype build the slow-path affordance.

All three follow the same `load_config` path as the commands that _were_
verified to emit an unsolicited dump, so that behaviour is low-risk; their
timing is the untested part.
