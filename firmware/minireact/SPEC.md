# minireact — specification

A React + Vite single-page editor for the minichord, replacing `firmware/minicontrol/`.

---

## 0. What this is and how to read it

### What this document is

This is the implementable specification for `firmware/minireact/`: a browser editor for the
minichord that reaches the device over the Web MIDI API and replaces the generated editor at
`firmware/minicontrol/index.html`. Functional parity with that editor is the floor; the user
interface is a redesign and diverges from it deliberately in about a dozen places, each marked.

It is written to be **sufficient on its own**. The reader is assumed to have this file, the
repository, and nothing else — no network, no issue tracker, no prototype branch. Every sentence
that constrains the code is *in* this document; the links at the foot of each section carry only
the reasoning behind a decision, never the decision itself. A reader who never opens one of them
must still be able to implement the app without making a design choice.

### The altitude this document speaks at

It specifies **observable behaviour** and **structure something can violate**. Below that line
everything is free by construction and is not marked as such:

- identifier names, component names, file names;
- how a layer's files split internally (one module or five);
- CSS that is not bound to a token named here;
- the internal shape of any function whose signature is given.

Do not read an omission below that line as an oversight. Where freedom sits *above* the line — a
place a reader would reasonably expect a decision and not find one — it is marked, see below.

### The two markers

Exactly two inline markers appear in this document, and they are the only places an inline link
occurs.

> **Not:** *the alternative that was rejected, and why.* Used only where the rejected option is
> what a reasonable implementer would reach for by default — most often because the legacy editor
> does it that way, and the legacy editor is by contract the reference sitting open beside you.
> Grep for `**Not:**` to get the complete list of deliberate divergences.

> **Open:** *what is genuinely free, what constrains it anyway, and the fact that nobody will
> review your choice.* Rare. Every instance is indexed in §13.

A decision that depends on something unverified is written as a **conditional**, not as an
opening: you are told what to do in each case and you decide nothing, you only look.

### Citation

Each section ends with a *Decided in* line naming the tickets that settled it. Ticket titles are
always spelled out; the number rides inside the URL. Several decisions were taken against
throwaway prototypes on branches named there — **those branches are ephemeral, are not on `dev`,
and may no longer exist.** Nothing in this document depends on reading them. If a branch is gone,
nothing is missing.

### Glossary

The document is ordered so that the `ui/` invariants (§6) arrive before the surfaces they govern.
That costs a handful of forward references, and this table absorbs them.

| term | meaning |
|---|---|
| **address** | one of the 256 SysEx slots that make up the whole device state |
| **parameter** | one record of `firmware/generator/parameters.json`, owning one address |
| **section** | one of the three top-level partitions: global, harp, chord |
| **plate** | one collapsible card holding one `group` of parameters within a section |
| **kind** | which widget a parameter is drawn as: `toggle`, `select`, `stepper`, `slider`, `picker`, `sequencer` |
| **control** | the on-screen thing that edits one parameter, whatever its kind |
| **binding** | the one component per parameter that reads the store and feeds the control |
| **readout** | the single strip in the panel header that explains the control under the pointer or focus |
| **strip** | the single top-bar line where the app speaks about the device |
| **gate** | the connection screen shown before the first dump |
| **dock** | the edit buffer: the list of everything changed since the bank was loaded |
| **sequencer** | the rhythm grid at addresses 220–235, sixteen steps by seven bits |
| **wire value** | the integer actually carried by SysEx, before any `/100` or curve is applied |
| **dump** | the device's report of all 256 values |

### Language and scope reminders

The app runs on **desktop Chromium only**. WebKit implements no Web MIDI API on any platform, so
Safari and iOS can never reach the device; Android and mobile are out of scope by choice. A narrow
desktop window is supported down to a declared floor (§7); it is not a mobile target.

All identifiers, comments, UI strings and commit messages are in English.

*Decided in: [Decide the structure of SPEC.md and how the closed tickets flow into it](https://github.com/spippoli/minichord/issues/23) · [Decide how ui/ is cut into components, and whether SPEC.md names the boundaries](https://github.com/spippoli/minichord/issues/22).*

---

## 1. The device and the wire

Everything in this section is a **fact about the hardware and the firmware**, not a design choice.
Most of it cannot be derived from the legacy editor or from `parameters.json`, and ignoring any of
it costs a silent bug that only a device on the desk will reveal.

### 1.1 The message

Every outgoing message is a SysEx of **exactly six bytes**:

```
0xF0, addrLo, addrHi, valLo, valHi, 0xF7
```

with little-endian 7-bit splitting on both fields: `lo = n % 128`, `hi = floor(n / 128)`. The
firmware gates on `getSysExArrayLength() == 6` and **silently discards** anything else, so there is
no such thing as a partial or extended write.

Legal ranges: address `0..255`, value `0..16383`.

### 1.2 Commands

When the address is `0` the message is a command rather than a write: `valLo` is the command,
`valHi` its argument.

| command | argument | meaning | cost |
|---|---|---|---|
| `0` | ignored | send back the full state | ~0.8 ms |
| `1` | ignored | wipe all memory to factory | ~164 ms |
| `2` | bank `0..11` | save current state into that bank | 164 ms |
| `3` | bank `0..11` | reset that bank to factory defaults | ~164 ms |

Commands `1` and `3` are destructive to the operator's own banks and were **never sent to real
hardware**; their cost is read off the firmware source, where both call the same erase-write-reload
path as a save. Command `2`'s 164 ms is measured once and is the one figure the checked-in
calibration harness cannot re-measure, because it never writes flash.

### 1.3 The dump

The device replies — and sometimes speaks unprompted — with a single SysEx frame of **514 bytes**:
`0xF0`, 512 payload bytes, `0xF7`. Dropping the leading `0xF0` leaves 513 bytes, which is the
length to gate on (`256 * 2 + 1`). Value `i` is `data[2i] + 128 * data[2i + 1]` for `i` in
`0..255`.

**A dump is not always an answer to a request.** `load_config` ends with an internal
`control_command(0, 0)`, so the device emits a dump on its own initiative after a save, after a
reset, after a wipe, after a press of the physical preset buttons, and at boot. The app cannot tell
an answer from an announcement by inspecting the payload, and is specified never to try (§5.3).

### 1.4 The 256 addresses

| addresses | content |
|---|---|
| 0 | not a parameter — the command slot |
| 1 | bank id, `0..11` on the wire, shown `1..12` |
| 2, 3 | harp and chord volume (physical potentiometers) |
| 4, 5, 6 | potentiometer storage (physical potentiometers) |
| 7 | firmware version, an integer counter |
| 10–17 | potentiometer routing and ranges |
| 20–35, 106–108 | global parameters |
| 40–105 | harp parameters |
| 120–219 | chord parameters |
| 220–235 | rhythm patterns, one 7-bit mask each |

`firmware/generator/parameters.json` declares **195 parameters** across those ranges, with globally
unique addresses spanning 2–235. Six of them are in the `hidden` group (addresses 2–7) and are
never drawn; **189 are visible**. Group order and address order do not coincide, and the section
ranges above describe where a section's *visible* parameters live, not a contiguous block the app
may assume.

**39 addresses in 2–235 carry no parameter at all**: 8, 9, 18, 19, 36–39, 109–119, 200–219. Nothing
in `apply_audio_parameter` reads them, so writing them is inert — which is what makes them usable
as probe slots by the calibration harness. 236–255 are equally unclaimed.

### 1.5 Firmware behaviours that will bite you

Each of these was verified against `firmware/src/main.cpp` at firmware version 8, and several
against the hardware.

- **The firmware applies no address protection whatsoever.** `processMIDI` executes
  `current_sysex_parameters[adress] = value` unconditionally. The "protected" (2–9) and "limited
  access" (10–17) ranges are conventions of the *editor*, not of the device — confirmed by writing
  8 and 9 and reading them back. Above address 255 it is an out-of-bounds write into whatever
  follows the array, which is why the transport throws rather than sends (§3.4).
- **Address 1 must never be written.** There is no `case 1:` in the firmware's switch, but the
  store happens *before* the switch, so a write to address 1 does not change bank — it poisons the
  bank id reported in every subsequent dump, until the next `load_config`. Unlike address 7, the
  firmware does **not** heal it.
- **The firmware heals address 7.** `apply_audio_parameter`'s `case 7` reassigns `version_ID`
  after the store, so the firmware-version slot cannot be written. Any client that mirrors its own
  writes optimistically must not believe a write to 7.
- **Saving to a bank also switches to it.** `save_config` assigns `current_bank_number` *before*
  writing and then fully reloads. There is no "save a copy over there while staying here".
- **There is no load-bank command.** Bank navigation exists only on the physical buttons.
- **There are 12 banks**, files `a.txt`…`l.txt`, hardcoded and not readable over SysEx. In the
  client this is a constant, verified rather than assumed.
- **The firmware's own dirty flag is not ours, and its guard is dead code.** `flag_save_needed` is
  raised only by the physical potentiometers, never by a SysEx write, and the condition meant to
  stop it autosaving while an editor is attached uses the comma operator, so it is always true and
  the flag is cleared on every `loop()`. Real consequence: **move a physical pot, then press a bank
  button, and the firmware silently saves the current state — including your unsaved app edits —
  into the bank you are leaving.**
- **`cycle length` (address 188, range 1..16) decides how many of the sixteen sequencer steps the
  firmware ever reaches.** Steps past it are never played.
- **The seven rhythm bits are seven notes of the chord, not seven voices.** Bit `i` is note `i`,
  folded onto a physical voice by `i < 4 ? i : i - 3`, because the chord section has four voices.
  Which pitch each row plays is chosen by `chord shuffling` (address 120).
- **`rythm pattern` declares `max_value: 128`** in `parameters.json` where a 7-bit mask tops out at
  127. Harmless as long as nothing generates a value from that range — the sequencer only flips
  bits — but the declared range is wrong.
- **The device may re-enumerate on the USB bus without being touched.** Observed three times in one
  session, cable untouched, autosuspend off, not reproducible on demand. Treat a disconnect as an
  ordinary event, not a fault (§9.4).
- **31 of the 43 published shared presets carry values outside the declared `min_value`**, all on
  addresses 106/107, where `0` plainly means "MIDI channel off". Any client that clamps to the
  declared range switches on a channel the author had switched off (§11.2).

### 1.6 Measured performance

Taken against a minichord on firmware 8 over ALSA rawmidi on Linux, by
`firmware/minireact/tools/measure-device.py`. These are properties of the hardware, not budgets for
this app; they are here because several rules below would otherwise read as paranoia.

| quantity | value | how |
|---|---|---|
| ingest rate | **0.581 ms/message** (~1720 msg/s) | slope of burst drain time over 25–800 messages |
| dump round trip | median **0.81 ms**, p95 1.41 ms, max 1.91 ms | 500 consecutive `(0, 0)`, 0 timeouts |
| save round trip | **164 ms** | `(2, bank)` timed to the dump that follows |
| message loss | none observed; bounded at **≈2.5% per message** | 117 clean probe slots inside 254-message bursts |

Three qualifications carry weight downstream:

- The ingest figure is the firmware's main-loop period — `loop()` calls `usbMIDI.read()` exactly
  once per iteration — and it is a **floor**: the test wrote unclaimed addresses that do no work,
  where a real preset load hits 254 live cases.
- **"No loss" is a detection result, not a zero.** Only the 39 unclaimed addresses carry a
  distinguishable sentinel; a lost write anywhere else leaves the following dump byte-identical.
  The bound of ≈2.5% per message permits roughly **six silently dropped parameters** across a
  254-message preset load, and the rhythm masks at 220–235 have no coverage at all. **A bulk write
  is therefore not self-confirming**, which is the entire reason §11.3 exists.
- Every row except the 164 ms save can be re-measured by re-running the harness.

Everything above is re-measurable and re-verifiable; none of it is a threshold this app must meet.
This document sets **no performance budget anywhere**, because nothing would verify one (§2.4).

*Decided in: [Build a throwaway minichord protocol simulator](https://github.com/spippoli/minichord/issues/7) · [Draw the transport boundary between the SysEx layer and the app](https://github.com/spippoli/minichord/issues/6) · [Decide the bank model and persistence UX](https://github.com/spippoli/minichord/issues/12) · [Decide the preset code and random generator UX](https://github.com/spippoli/minichord/issues/13) · [Design the parameter control itself](https://github.com/spippoli/minichord/issues/10) · [Research: Web MIDI SysEx output throughput and latency constraints](https://github.com/spippoli/minichord/issues/3).*

---

## 2. Layers and the dependency rule

### 2.1 The rule

```
src/
  transport/   the wire and the platform, nothing else
  domain/      parameters, value conversion, the preset codec
  state/       the 256 values, the connection machine, the runtime
  ui/          the gate, the strip, the panel — the only layer that mounts
```

**Dependencies run one way: `transport → domain → state → ui`.** `transport` never imports React
and never imports `domain`. `domain` never imports `transport`. Nothing imports `ui`.

The rule matters more than the folder names, and it is what decides two questions that look like
matters of taste: value conversion cannot live in `transport` (it needs `parameters.json`, which
lives in `domain`), and the connection state machine cannot live in `transport` (it needs policy,
which lives in `state`).

Inside `state/` the same rule recurs at finer grain: two pure slices, `connection/` and
`parameters/`, with the direction fixed at **`connection → parameters`, never the reverse** (§5.5).

### 2.2 Stack

- **React + TypeScript + Vite.** The scaffold as generated, with one deletion: the scaffold's
  `index.css` pins `#root` to a 1126 px centred column with `text-align: center`, which no editor
  layout survives. Delete it rather than override it.
- **CSS Modules**, co-located with the component they style, for component styles.
- **CSS custom properties on the panel root** for the theme: the two mouldings and the bank hue
  (§7.4). Tailwind and vanilla-extract were both weighed and dropped — class-dense markup across
  189 controls works against readability, and a build-time styling system is out of proportion to a
  few hundred lines of CSS.
- **No runtime dependency beyond React** is added by this specification. In particular no state
  machine library: eight states do not repay a dependency, and the 256 values would not live inside
  it anyway.

### 2.3 Lint and formatting

The scaffold's flat lint config, unmodified, plus Prettier with default options. Both run as npm
scripts, on demand. No custom rules, no pre-commit hook, no CI gate. Deterministic formatting earns
its place immediately — this codebase is written alternately by a human and by agents, and diffs
should carry changes and nothing else. Custom rules earn their place by answering a problem that
has actually occurred.

### 2.4 Testing

**Vitest on the pure layers only:**

- the 6-byte SysEx encoding and the 7-bit split;
- the 513-byte dump decoding;
- parameter maths — the `/100` multiplier and the exponential curve, round-tripped;
- the base64 preset codec;
- a shape-and-domain check over the real `parameters.json` (§4.2);
- the taxonomy counts (§8.1).

**No component tests, no browser-level tests, no CI.** These are pure functions with no DOM and no
MIDI, where a bug is silent and propagates all the way to hardware — the exact profile that repays
test cost. The UI is 189 controls generated from a manifest, so component tests would mostly assert
React's own behaviour. End-to-end coverage is manual, against the simulator described in §2.5 and
against a device.

Two consequences are stated rather than mitigated: the `parameters.json` check only runs when
someone runs the tests, and **nothing enforces any invariant in §6**.

### 2.5 The simulator

`src/dev/simulator/` already exists on `dev` and is not application code. It fakes `MIDIAccess` —
not the transport — so the real framing, 7-bit split, dump decoding and port handling all run
against it. It carries the firmware's real 12-bank factory table, reproduces the measured ingest
rate by default, and takes `realisticTiming: false` for deterministic tests, plus `initialBank`,
`firmwareVersion` and `portNames` options.

It models the **protocol only**. It does not model audio, ever — no decision about sound may be
validated against it — nor flash persistence across restarts, nor MIDI beyond SysEx.

### 2.6 A trap in the repository

The repository-root `.gitignore` carries unanchored virtualenv patterns — `[Bb]in`, `[Ss]cripts`,
`[Ll]ocal`, `[Ll]ib64` — which git applies at any depth. A `firmware/minireact/scripts/` or
`src/bin/` directory would be **silently ignored**. This is why the Python helpers live in
`tools/`. Fixing the root file changes ignore behaviour for the whole repository including upstream
code, so it is a deliberate decision of its own and is not taken here.

`firmware/minireact/.gitignore` is the scaffold's, local to the SPA.

*Decided in: [Decide stack and conventions for the minireact SPA](https://github.com/spippoli/minichord/issues/4) · [Decide where the connection state machine lives across the layers of #4](https://github.com/spippoli/minichord/issues/18) · [Build a throwaway minichord protocol simulator](https://github.com/spippoli/minichord/issues/7) · [Design the information architecture for 195 parameters](https://github.com/spippoli/minichord/issues/9).*

---

## 3. `transport/`

### 3.1 What it is

**The transport is a faithful mirror of the wire: no initiative, no semantics.** It knows what six
bytes and a 513-byte dump are; it does not know what an address means. `state/` drives, the
transport answers.

`navigator` never leaves this layer. That is what lets `state/` be tested with no DOM shim.

### 3.2 The interface

```ts
type PortPair = { input: MIDIInput; output: MIDIOutput }

type TransportEvent =
  | { type: 'connection'; connected: boolean }
  | { type: 'dump'; values: readonly number[] }   // 256 raw integers, verbatim
  | { type: 'error'; reason: TransportErrorReason }

type TransportErrorReason =
  | 'access-denied'
  | 'unsupported'
  | 'malformed-message'

class MinichordTransport {
  constructor(seams?: {
    requestAccess?: () => Promise<MIDIAccess>
    queryPermission?: () => Promise<PermissionState>
  })

  static isSupported(): boolean
  queryPermission(): Promise<PermissionState>          // 'granted' | 'denied' | 'prompt'
  onPermissionChange(cb: (s: PermissionState) => void): () => void
  requestAccess(): Promise<void>

  listPorts(): readonly PortPair[]
  probe(pair: PortPair, timeoutMs: number): Promise<boolean>
  bind(pair: PortPair): void
  unbind(): void

  sendParameter(address: number, rawValue: number): boolean
  sendCommand(command: number, argument: number): boolean
  requestDump(): boolean
  wipeMemory(): boolean
  saveToBank(bank: number): boolean
  resetBank(bank: number): boolean

  subscribe(listener: (e: TransportEvent) => void): () => void
}
```

A class with a typed `subscribe` returning its own unsubscribe function. **Not:** assignable
callbacks in the legacy's style — a single consumer, silently overwritten — when the dump interests
the store, the strip and any future debug panel at once; nor `EventTarget`, whose
`CustomEvent.detail` is `any`, losing the type exactly where the dump needs it.
([reasoning](https://github.com/spippoli/minichord/issues/6))

`requestDump` / `wipeMemory` / `saveToBank` / `resetBank` are thin typed wrappers over
`sendCommand`, so the four protocol commands have a name rather than a magic number at every call
site.

### 3.3 `probe`

`probe` sends `(0, 0)` on one output, listens on the paired input, and resolves `true` on a
513-byte dump inside the window, `false` on the timeout. **The dump it consumed is discarded and
never emitted.**

It looks like initiative and is not: one candidate, one wire operation, no policy. It does not know
what a candidate is, how many there are, or what the count means. The window is the caller's
number. The name filter, the parallel fan-out and the 0/1/2+ decision table all live in
`state/connection` (§9.3).

### 3.4 Failure semantics

Three mechanisms, and **no user-facing strings anywhere in this layer**:

- **Events with a typed `reason` code** for operating conditions. §9 composes the text, and only
  some reasons ever reach a screen (§9.7).
- **A thrown exception** for a caller contract violation: an address or value out of range, or not
  an integer. That is a bug in the calling code, and the only alternative is sending garbage to a
  device that will apply it. This closes a real hole in the legacy, which does
  `parseInt(value % 128)` with no validation, so a negative or oversized value produces corrupt
  bytes inside a formally valid frame.
- **A `false` return** when sending while unbound. Disconnection is a normal runtime state, not a
  programming error.

### 3.5 What the transport does *not* do

- **No value conversion.** `×100`, the exponential curve and the rhythm bitmask are `domain`'s
  (§4.3). The legacy is inconsistent here — it decodes the rhythm mask inside its transport while
  leaving the curve and the multiplier to the UI layer.
- **No neutralisation.** The legacy overwrites addresses 2/3 to 50 and 4/5/6 to 512 on every dump
  *and writes those five values back to the device* from inside its receive handler. That policy
  moves to `state` (§5.4): a transport that alters what the device said is no longer a mirror, and
  neither its tests nor the simulator could then assert on the truth.
- **No initial dump request.** The legacy fires `(0, 0)` the moment it finds a port. Here the
  runtime does it, after the bind, and owns the timeout and the retry — which the legacy has no
  answer for at all: if that one message is lost, its UI stays empty forever.
- **No port matching.** The candidate test is a pure function in `state/connection` (§9.3).
- **No version check.** See §9.6.

*Decided in: [Draw the transport boundary between the SysEx layer and the app](https://github.com/spippoli/minichord/issues/6) · [Decide where the connection state machine lives across the layers of #4](https://github.com/spippoli/minichord/issues/18) · [Decide the connection lifecycle and its UX](https://github.com/spippoli/minichord/issues/11).*

---

## 4. `domain/`

### 4.1 How `parameters.json` reaches the app

**A build-time import, straight from `firmware/generator/parameters.json`.** No copy, no runtime
fetch, no `generate.py` change. Vite inlines the JSON into the bundle, so there is no loading
state, no network error path, no startup race, and the data is reachable from pure modules without
`async`.

Vite reaches the file with **no `server.fs.allow` configuration**: the repository root holds `.git`,
so it is already inside Vite's workspace root. This was verified; do not add config for it.

Accepted consequence: regenerating `parameters.json` is not enough, the SPA must be rebuilt. The
JSON is versioned beside the code and changes rarely.

### 4.2 Types

Two layers, both **hand-written**. No generation step and no generated artefact — the file's shape
is 12 keys with genuinely closed domains, present on all 195 records, with no optional fields and
no shape variance.

```ts
/** The file as it is, typo and firmware-only fields included. */
interface RawParameter {
  name: string
  group: string
  default_value: number
  data_type: 'int' | 'float'
  sysex_adress: number
  curve: 'linear' | 'exponential'
  min_value: number
  max_value: number
  tooltip: string
  iterate: number
  method: string
  introduction_version: number
}

/** The domain model. Nothing outside this module sees RawParameter. */
interface Parameter {
  name: string
  group: string
  section: 'global' | 'harp' | 'chord'
  address: number
  dataType: 'int' | 'float'
  curve: 'linear' | 'exponential'
  min: number
  max: number
  defaultValue: number
  tooltip: string
  introducedIn: number
}

const parameters: readonly Parameter[]                 // all 195, in file order
const byAddress: ReadonlyMap<number, Parameter>        // lossless: addresses are unique
const visibleParameters: readonly Parameter[]          // 189: group !== 'hidden'
function isAvailable(p: Parameter, firmwareVersion: number): boolean
```

Normalisation happens once, at the boundary: camelCase, `address` spelled correctly, `section` as
an explicit field taken from the JSON's three top-level keys. **`method` and `iterate` are
dropped** — both exist only to generate the firmware's C++. Keeping `adress` inside `RawParameter`
and nowhere else is what makes the repository convention (keep the typo where it is a data
contract, use the correct spelling in new code) enforceable by construction.

The addresses were verified globally unique across sections, spanning 2–235, so the index is
lossless. No UI hierarchy is baked in here.

**A Vitest test iterates the real JSON and asserts shape and closed domains.** This is not
ceremony: TypeScript infers `data_type: string` from a JSON import, not `'int' | 'float'`, so the
narrowing above is an assertion nothing else checks.

### 4.3 Value conversion

The wire carries integers. `domain` owns every translation between a wire value and what the user
sees, because all of them are parameterised by fields that live here.

```ts
function wireMin(p: Parameter): number
function wireMax(p: Parameter): number
function positionToWire(p: Parameter, t: number): number   // t in 0..1
function wireToPosition(p: Parameter, wire: number): number
function format(p: Parameter, wire: number): string
function parse(p: Parameter, text: string): number | null
```

- **Floats travel multiplied by 100.** `wire = round(value * 100)`; `value = wire / 100`, displayed
  to two decimals. Integers pass through.
- **Exponential parameters** use the law `wire = round(max ** t)`, inverted as
  `t = ln(wire) / ln(max)`, clamped to `0..1`, with `wire <= 1` mapping to `t = 0`. Their wire
  minimum is `1`, not the declared minimum: `exp` never reaches zero. This costs nothing — every
  exponential parameter is an envelope time in milliseconds and none of them defaults to 0; the
  common default is 1 ms, which is exactly what the bottom of the travel gives. 42 of the 195
  parameters are exponential.
- **The position is continuous.** The legacy walks an *integer* position over `0..max`, and that is
  where its one real defect lives: near the top a single position step jumps 4991 → 5000, leaving
  **1845 of 5000 values selectable** and, with neither typing nor a value-wise arrow key, the other
  3155 unreachable by any means at all. A continuous position recovers them and changes nothing on
  the wire — the device only ever sees the integer.
- **The legacy curve is correct where it looks broken.** On a 0..5000 parameter the first ~4.8% of
  the travel all sends 1, which reads like dead travel. It is not: a logarithmic curve allots
  travel by ratio, and the value 1 is owed `ln(1.5)/ln(5000)` = 4.76% of the run. Do not "fix" the
  bottom of the fader.
- **`parse` clamps** the typed value into `wireMin..wireMax` and returns `null` only when the text
  is not a number. It accepts a comma as a decimal separator.

### 4.4 The rhythm mask

Addresses 220–235 each hold one 7-bit mask; bit `k` is step-column `address - 220`, note `k + 1`.
Encoding and decoding the mask is `domain`'s, not the transport's.

### 4.5 The preset codec

The base64 preset format lives here as a pure codec; its rules are in §11.1.

*Decided in: [Decide how the SPA consumes parameters.json and how its TypeScript types are produced](https://github.com/spippoli/minichord/issues/5) · [Draw the transport boundary between the SysEx layer and the app](https://github.com/spippoli/minichord/issues/6) · [Design the parameter control itself](https://github.com/spippoli/minichord/issues/10) · [Design the information architecture for 195 parameters](https://github.com/spippoli/minichord/issues/9).*

---

## 5. `state/`

### 5.1 Shape

```
state/
  connection/reducer.ts   the eight states of §9, pure
  connection/ports.ts     isCandidatePort(name), pure
  parameters/reducer.ts   the 256 values, pure
  reducer.ts              the root: composes them, owns the one cross-cutting rule
  effects.ts              the effect types a reducer may return
  runtime.ts              the engine: dispatch, execute, notify — no React
```

Both slices are pure and separately testable. A merged reducer would drag 256 values through every
connection test.

```ts
function root(state: AppState, ev: Event): { state: AppState; effects: Effect[] }
```

**Evaluation order is fixed rather than left implicit: `connection` first, always**, because
`parameters` takes `connection.status` as an argument.

### 5.2 The store is optimistic

The store holds **256 raw wire integers**, undecoded. An edit lands locally at once and the wire
follows.

**Not:** a device-authoritative store that shows nothing it has not seen come back. It puts a round
trip between the pointer and the pixel on every slider, and the round trip is real — 0.81 ms is
fine, but a save is 164 ms and a bank load emits a full dump.
([reasoning](https://github.com/spippoli/minichord/issues/8))

**Optimism is subordinate to the connection.** While the connection is `interrupted` the reducer
**refuses edits**. The refusal is enforced here, not by drawing the controls disabled: the reducer
is the thing that would lie, and the UI reading `status` to draw them read-only is a rendering of
that fact rather than the authority for it.

**No device, no state.** The store holds nothing until the first dump. There is no offline editing
mode, and the app before the first dump is the gate (§9.1).

### 5.3 A dump overrules the store

Every value, whether the dump was solicited or not. The device is the thing that makes sound, and
per §1.3 the app cannot tell an answer from an announcement — and does not need to.

**One exception: the address under an active pointer is not overwritten.** A slider that jumps out
from under the cursor mid-drag is the one failure that is never acceptable. Only that address, and
only while the pointer is down.

**One exception to the exception: if the dump carries a different bank id, the pointer loses too.**
The value under the finger belonged to the previous bank; keeping it would display a number that
belongs to nothing. The whole test is comparing address 1 of the incoming dump against the store's
own.

That comparison is also the discriminator the store needs: it cannot tell a solicited dump from an
unsolicited one, but **whether the bank changed** carries the meaning and is right there in the
payload.

**A bulk write protects nothing.** A preset load rewrites its addresses unpaced, asks for a dump,
and that dump wins outright — no pointer exception, no pending-write exception.

> **Not:** protecting the addresses a bulk write has just sent. It was prototyped and collapses: it
> protects 254 of 256 addresses, so the confirming dump teaches the store nothing at all, while the
> divergence it just detected is discarded. Since §1.6 bounds silent loss at ≈2.5%, comparing
> against the returned dump is the *only* way to notice a dropped write.
> ([reasoning](https://github.com/spippoli/minichord/issues/8))

### 5.4 The neutralisation, named for what it is

On **every** dump — solicited or not, including the one that closes a preset load — the store
forces:

| address | forced to | why |
|---|---|---|
| 2, 3 | 50 | harp and chord volume, carrying the physical pot positions |
| 4, 5, 6 | 512 | potentiometer storage, likewise |

These five values are **not a mirror of the device**. They arrive carrying wherever the physical
knobs happen to sit, and the store overwrites them with a fiction so the knobs do not fight the UI.
The device reads something like 114/121/128/135/142 while the store insists on 50/50/512/512/512.

Unlike the legacy, the app does **not** write those five values back to the device.

Two exclusions follow, and both are load-bearing wherever the store compares what it holds against
what it sent (§11.3) or against a reference (§10.3):

- **address 7** is excluded, because the firmware heals it (§1.5);
- **addresses 2–6** are excluded, because the store deliberately holds a fiction there.

Without those exclusions every comparison cries wolf on every dump.

### 5.5 The two slices, and the one edge between them

**`connection → parameters`, never the reverse.** The status goes down; nothing comes back up. That
single edge carries the one real coupling, the read-only rule of §5.2.

The apparent back-edge — the line announcing lost edits when the bank changes (§10.5) — is not one:
**the notice is a field on `parameters`, and the strip is a UI component that reads both slices**
(`connection.status`, `connection.port`, `parameters.lastLossNotice`, and the firmware version,
which is simply `parameters.values[7]`).

**Not:** a third `notices/` slice owning everything the gate and the strip display. Three slices for
a two-slice app, and it severs the strip from the state it describes.
([reasoning](https://github.com/spippoli/minichord/issues/18))

### 5.6 The runtime

A pure reducer cannot await a probe, hold a one-second timer, or flush on an animation frame.
`state/runtime.ts` is **a plain class, not a hook**: it holds the transport, subscribes to it once,
dispatches every event into `root`, executes the effects the reducer returns, and notifies its own
subscribers.

**React reads it through a single `useSyncExternalStore` in a provider. It is a reader, not the
motor.**

**Not:** `useReducer` in a provider with the probe, the timers and the flush in `useEffect`. It is
more idiomatic and it makes the machine drivable only by mounting React — and since §2.4 rules out
UI tests, the probe, the retry and the reconnection path would ship untested. Headless, they are
exercised against the simulator, which is the whole reason the simulator exists.
([reasoning](https://github.com/spippoli/minichord/issues/18))

### 5.7 The write policy

- **Coalesce per address.** At most one pending value per address.
- **Flush once per `requestAnimationFrame`,** with `timestamp = 0` on every send. Web MIDI's
  `timestamp` scheduling is unusable in Chromium because `clear()` was never implemented, so a
  scheduled message cannot be cancelled.
- **Always flush a final value on pointer-up**, so the last position of a drag is never the one
  that got coalesced away.
- **Send bulk writes unpaced.** Pacing only makes them slower; 254 messages lost nothing at zero
  interval. Budget ~148 ms of device time before the confirming dump can arrive, and treat that as
  a lower bound (§1.6).

Coalescing, not pacing, is what does the work: one address at 60 Hz is 3.5% of the measured
ceiling, while an uncoalesced 1000 Hz mouse on a single slider would sit at 58% of it with nothing
left over for a second control.

### 5.8 Filling the store

**There is exactly one way into the store: the transport's `dump` event.**

After a successful `bind`, the runtime sends `requestDump()` and **retries after 1 second** if no
dump has arrived. The probe's own dump was discarded (§3.3), so connecting costs two round trips
rather than one — an extra 0.81 ms, bought so that the automatic probe, the manual picker and every
reconnection all fill the store by the same path. Keeping the probe's payload would give the store
two entry points, and with two candidates answering it would mean holding a dump from a port that
may never be bound.

*Decided in: [Decide who owns the 256-value state, and how writes and dumps interact](https://github.com/spippoli/minichord/issues/8) · [Decide where the connection state machine lives across the layers of #4](https://github.com/spippoli/minichord/issues/18) · [Build a throwaway minichord protocol simulator](https://github.com/spippoli/minichord/issues/7) · [Research: Web MIDI SysEx output throughput and latency constraints](https://github.com/spippoli/minichord/issues/3) · prototype: `prototype/store-ownership` (throwaway, may no longer exist).*

---

## 6. How `ui/` is constrained

**This document does not draw the component tree.** It names invariants, plus a closed list of six
components that must exist. Everything else about how `ui/` divides into files is free.

The reason is a property of the two extremes. A component tree cannot be violated — only ignored or
followed to the letter, and both are wrong. A specification that says nothing leaves the decisions
of §5, §8 and §12 reconstructible only by reading the whole document backwards. **An invariant is
the only form that breaks visibly.**

That is not hypothetical. Twice during design, a decision that had been written down was violated
in code within days, because it had nowhere to be visible at the point of use: a focus ring that
existed on two kinds of six, and read-only value windows implemented as `<output>` — a live region,
the exact thing that had been rejected in writing. Both are fixed below, and both are why this
section opens the second half of the document instead of closing it. Hold these while building.

### 6.1 The seven invariants

**1. No component that draws a parameter reads the store.** The value arrives as a prop from a
single **binding** component per parameter. This is a legibility decision, not a performance one —
§7.6 removed the performance argument. The store's rules are *per address and over time*: the
optimistic write, the dump that overrules every value except the one under an active pointer, and
that exception falling away when the bank changes. Spread across 189 reading controls, "the address
under an active pointer" becomes 189 pieces of local state; in one binding it is one place.

Cost, stated: every dump repaints the whole mounted section. That is only admissible because it was
measured (§7.6). If the one-section-at-a-time architecture ever changes, re-measure.

**2. No kind opts out of the repertoire.** The typeable value window, the arrows moving the *value*
by 1 and by 10 with Shift, double-click to the factory default, hover-or-focus feeding the readout,
the tooltip travelling as `aria-describedby` with the two state LEDs inside the same sentence, one
tab stop on the body, `aria-disabled` rather than `disabled` on an unequipped slot, one 2 px
`:focus-visible` ring. **The kind chooses the widget in the slot and nothing else, and the kind is
derived from the parameter, never passed in by the caller.**

Six autonomous per-kind components would mean writing those eight rules six times over — which is
precisely how the focus ring came to exist on two of six *with* the repertoire already shared.

**3. The sequencer is the exception, and the exception is written down with its reason.** It is not
a seventh kind. A column *is* a parameter (addresses 220–235) and a cell's value is a **bit**, so
the arrows have no quantity to move and are free for navigation (§12.4). Without the reason on the
page the exception reads as an inconsistency and gets "fixed".

**4. Hover and focus feed the readout through the same channel, and no control has a private path
to it.** A model where the readout derives its content from focus is not available: **the DOM has
no `activeElement` for the pointer**, and the readout is fed by both *identically*, which is what
makes the tooltip reachable without a mouse. The push model is forced, not preferred.

One channel with two sources needs a priority, or leaving a hover empties the strip while another
control still holds the keyboard focus: **hover takes priority, and leaving the hover falls back to
the focus**, not to the resting line. This costs one more field of state.

**5. The explanatory text has exactly one producer** — a pure function of the parameter and its
state. It has two consumers: the single visual readout (`aria-hidden`) and the per-control
screen-reader-only element that `aria-describedby` points at. **Neither consumer composes text of
its own.** This is the invariant both historical failures above violated.

**6. Focus movement belongs to the panel, never to the control** — the sole exception being the
`Enter`/`Escape` round trip between a control's body and its value window (§12.2). **A control's
tab stop must be reachable from outside, given only the parameter's address**: three features
depend on it (§12.3, §12.5).

Stated as a requirement, because an implementer who does not know it writes a `focus()` that finds
nothing: **giving focus to a control may require switching section and unfolding its plate first,
and therefore happens after React has committed.**

> **Open:** the *mechanism* by which a control's tab stop is reached by address. A `data-` attribute
> plus a DOM query, or a ref registry, or something else. What constrains it anyway: it must work
> for a control that is **not yet mounted** at the moment the request is made, which is what makes a
> registry keyed on mount order the risky choice. Nobody will review which you pick — fixing the
> mechanism here buys nothing the contract does not already buy. This is the point where the form
> of this section risks the most: "reachable from outside" without saying how is exactly the kind of
> sentence an implementer reads and does not implement.
> ([reasoning](https://github.com/spippoli/minichord/issues/22))

**7. Two single-instance channels, on different clocks, that do not merge.** The **readout**
explains what you are touching right now and is mute for a screen reader. The **strip** says what
happened to the device and is the app's only voice — §9.7 puts messages in the gate or the strip
and nowhere else. Merging them is the obvious temptation, since they are two lines of text in the
same header, and it loses both decisions at once.

### 6.2 The six obligated components

The bar is narrow: only what a different cut would break.

| component | what forces it | cardinality |
|---|---|---|
| the **control** | owns the repertoire of §8 and §12; six kinds must not rewrite it six times | one per parameter |
| the **sequencer** | the declared exception: `role="grid"`, roving tabindex, a column is a parameter, a cell is a bit | one |
| the **binding** | the only store reader per parameter; invariant 1 lives in it | one per parameter |
| the **readout** | one push channel, hover over focus, `aria-hidden`, no private paths | **exactly one** |
| the **gate** | before the first dump the app *is* a connection screen; afterwards the editor *is* the app; a mutually exclusive top-level branch | one |
| the **strip** | the connection in one top-bar line, bank number and hue together in it, and the only element the bank hue reaches | one |

Explicitly **not** obligated, said here so nobody adds them back: the **plate** (`role="group"` is
markup, not a boundary), the **dock**, the **tablist**, and the **maintenance area** of §10.6. All
of them are places where something goes, not boundaries holding a decision up.

### 6.3 Nothing enforces any of this

Said plainly, once. §2.4 puts Vitest on the pure layers only, with no UI tests, no CI and no custom
lint rules. The invariants above are prose that nothing fails.

Reopening that decision for a handful of accessibility UI tests was considered and rejected: the
cost — jsdom, a testing library, a whole layer excluded on purpose — is out of proportion to the
return. What the invariants do instead is carry their enforcement in their phrasing: "exactly one
readout in the tree" and "no component drawing a parameter imports the store" are checkable by eye
in thirty seconds; "controls must be accessible" would not be.

*Decided in: [Decide how ui/ is cut into components, and whether SPEC.md names the boundaries](https://github.com/spippoli/minichord/issues/22) · [Decide keyboard navigation and accessibility across the panel](https://github.com/spippoli/minichord/issues/17) · [Verify the accessibility structure of #17 with a real screen reader](https://github.com/spippoli/minichord/issues/21) · [Measure React render performance with a full section mounted](https://github.com/spippoli/minichord/issues/19) · prototype: `prototype/parameter-control` (throwaway, may no longer exist).*

---

## 7. The panel: information architecture and theme

### 7.1 The thesis

**The editor is a dense workbench, skinned as an 80s digital synthesiser panel.** Sound design is
comparative — you want the filter and the envelope on screen at once — and density is only worth
having if it can be spent where it matters.

Two alternatives were built and rejected against a running prototype: a two-level navigator
(sections and groups in a rail, one group in the pane) and a search-first single column. The
workbench won.

### 7.2 Sections, plates, folding

- **Sections are tabs.** Exactly one section is mounted at a time: global (27 visible parameters),
  harp (66), chord (96).
- **Groups are collapsible plates** in a packed multi-column flow within the section, **all open by
  default**. `fold all` / `open all` act on the current section.
- **A folded plate still reports how many of its parameters were edited.** Folding hides noise,
  never state.
- **Groups are merged by name.** `group` is *not* contiguous in `parameters.json` — the global
  "Settings" group appears in two blocks, and the legacy generator, grouping without sorting, draws
  it twice (6 parameters, then 4). Merge into one plate of 10. This is a data quirk to absorb, not
  a structure to reproduce.

The plates, in order, are the groups as they first appear in the file:

| section | plates |
|---|---|
| global | Settings (10), MIDI (3), Effects (6), Potentiometer (8) |
| harp | General (3), Oscillator (2), Envelope (6), Low pass filter (10), Transient (6), Tremolo (3), Vibrato (15), Effects (11), Output filter (10) |
| chord | General (3), Oscillator (16), Envelope (6), Low pass filter (13), Tremolo (4), Vibrato (16), Effects (11), Rythm (21), Output filter (6) |

The Rythm plate's 21 parameters include the 16 sequencer columns, which are drawn as one grid
(§8.3), not as 16 controls.

### 7.3 Search, divergence, the dock

- **Search lives in the panel and is scoped to the section on screen.** It covers name, group,
  tooltip and the raw address. `Ctrl+K` focuses it, `Escape` clears it.
- That scoping is only admissible because **the tab of every other section lights with its own
  match count**, so a hit elsewhere is never invisible.
- **While a search is running, folding is ignored** — otherwise a hit inside a folded plate is a
  hit nobody can see.
- **Divergence is shown at three magnifications**: two LEDs per control (amber — differs from what
  is stored in the bank; blue — differs from the factory default), an edited count on each plate
  header, and the **dock**, a list of every changed parameter with a revert button and a link that
  switches section, unfolds the plate and moves focus onto the control (§12.3).
- "What is stored in the bank" is defined in §10.3. Addresses 7 and 2–6 are excluded from that
  comparison, per §5.4.
- **The five fiction addresses get one line in the dock**, not controls: harp volume, chord volume
  and the three potentiometer slots are physical knobs, and they were never controls in the legacy
  editor either — they sit in the `hidden` group, emitted with `display: none`.

### 7.4 The two mouldings, and the bank hue

**The panel is moulded, not painted.**

Colour is a **token set** — plastic, milled edges, silkscreen, moving parts, lit surfaces —
declared on the panel root, never a literal at a use site. Two surface declarations sit above the
tokens and one tint rule above those.

**The light panel is a different object, not the dark one lightened.** Cream plastic, **dark** fader
caps where the dark panel has light ones, and a **positive** LCD — dark ink on grey-green, with no
glow. A glowing negative LCD is a dark-panel object; on light plastic in daylight it reads as a
bug. The two sets share nothing: roughly 55 tokens each, with the LED, the window and the cap
swapping roles between them. That cost is real and is accepted.

**`prefers-color-scheme` alone chooses the moulding.**

> **Not:** a theme toggle, and **not** `localStorage`. Which panel you want is the light in the
> room and the OS already knows it; the legacy's stored toggle predates that signal being reliable.
> The media query is *subscribed to*, so the panel re-moulds when the OS flips, without a reload.
> ([reasoning](https://github.com/spippoli/minichord/issues/16))

**The bank hue reaches exactly one element: the bank LED in the strip.** Not the windows, not the
lit surfaces, not the moulding. The hue is the bank's **identity** — the thing that tells you it is
bank 7 without looking at the screen — and an identity belongs in one place rather than smeared
across the surface being worked on. The twelve factory banks bear this out: they ship one hue each,
spread around the circle at `0, 10, 30, 60, 110, 138, 175, 220, 253, 266, 310, 340`. That is a
name, not a decoration.

A constraint that binds any wider choice, recorded so it is not rediscovered: the two state LEDs of
§7.3 sit side by side and the second is blue, so if both followed the bank they would stop being
readable at around hue 220 — **and bank 7 ships at 220**. State read in the bank's own colour stops
reading as state.

`--hue` is set inline on the panel root from the live value of address 20.

> **Open:** the concrete colour values behind the ~110 tokens. The token *names* and their roles are
> fixed by this section and §8; the hex values are not, and this document does not carry a palette.
> What constrains them anyway: two complete sets with nothing shared, a positive LCD in the light
> moulding, and the focus ring drawn in the LCD's own ink and legible against plastic in both
> (§12.7). Nobody will review the values you choose.
> ([reasoning](https://github.com/spippoli/minichord/issues/16))

### 7.5 The narrow floor

**760 px, declared.** Two columns of plates still fit. Below it the panel **scrolls sideways**
rather than degrading quietly — unsupported on purpose, not broken by accident. The `min-width` is
744 px, which is 760 minus a vertical scrollbar.

### 7.6 Rendering cost

A full dump repainting the worst case this design allows — the chord section, 96 parameters, all 9
plates open, the sequencer expanded to 112 cells, ~1150 nodes, no search — costs React **2.5 ms
median and 4.2 ms worst** in a production build, and sustained dumps never miss a vsync.

> **Not:** virtualising the section, and **not** per-control memoisation. Measured at 2.5 ms median
> against a 16 ms frame, both would be complexity bought against a cost that is not there.
> ([reasoning](https://github.com/spippoli/minichord/issues/19))

Two things worth knowing while working:

- A **bank switch** costs one skipped frame, which is the browser repainting a panel whose `--hue`
  changed under every node — invisible on an operation the firmware takes ~164 ms to perform.
- **On the dev server a dump after an idle pause feels ~90 ms, and that is not what users get.**
  Sweeping the idle gap moved that figure fivefold with nothing else changed, and a synthetic loop
  touching no React degraded identically: it is the machine dropping its clock while the page is
  idle. The same sweep on a production build is flat. Do not chase it.

*Decided in: [Design the information architecture for 195 parameters](https://github.com/spippoli/minichord/issues/9) · [Decide the panel's visual language: bank hue and dark mode](https://github.com/spippoli/minichord/issues/16) · [Measure React render performance with a full section mounted](https://github.com/spippoli/minichord/issues/19) · [Decide the bank model and persistence UX](https://github.com/spippoli/minichord/issues/12) · prototypes: `prototype/parameter-ia`, `prototype/parameter-control`, `measure/react-render-perf` (throwaway, may no longer exist).*

---

## 8. The control repertoire

### 8.1 The taxonomy

`parameters.json` carries no notion of a *kind* of control — only `data_type`, `curve` and a range —
which is why the legacy draws one range input 189 times, so that a boolean becomes a two-position
fader and a waveform becomes an unlabelled 0..11.

**The taxonomy is hand-derived, lives client-side, and leaves `parameters.json` untouched.** Most
of it still falls out of the data by rule; the only thing genuinely written by hand is what the
data cannot express — the **labels** of the enumerations, and which four addresses are not
quantities.

The rules, in order, first match wins:

1. address in 220–235 → `sequencer`
2. address in {10, 12, 14, 16} → `picker`
3. address has a named enumeration (§8.5) → `select`
4. `int` and `linear` and range exactly 0..1 → `toggle`
5. `int` and `linear` and `max - min <= 16` → `stepper`
6. otherwise → `slider`

| kind | count | what it is |
|---|---|---|
| `toggle` | 6 | an interrupter, not a two-position fader |
| `select` | 14 | a small enumeration whose values have names |
| `stepper` | 11 | a small ordinal with an order but no names |
| `slider` | 138 | the continuous majority |
| `picker` | 4 | a value that is the SysEx address of another parameter |
| `sequencer` | 16 | the 7-bit masks at 220–235, drawn as one grid |

**The counts are a checksum, not a listing.** They total 189 and are asserted by a Vitest test
against the real `parameters.json` — which is the point of writing them down. This document
deliberately does not enumerate the 189 parameters: that would be a second source of truth,
diverging from the build-time import at the first change to the generator.

Where the value has a **shape**, the icon is the label (waveforms). Where it has a **name**, the
name is the label (key signatures, shufflings). Where it has neither, it stays an ordinal —
`crunch type`'s tooltip says only "more and more distorted shape", so a `stepper` is all it can be.

### 8.2 The repertoire, shared by every kind

- **The value window is a typeable field.** Click and type, `Enter` commits, `Escape` reverts,
  blur commits. The legacy offers nothing of the sort.
- **The arrow keys nudge the value by one, Shift by ten** — deliberately the *value*, not the
  slider position. This is what makes the 3155 unreachable values of §4.3 reachable.
- **Double-click returns a control to its factory default.** The dock already offers "back to what
  is stored"; this is the other origin.
- **Every tooltip lands in the single readout**, fed by hover *or* keyboard focus, identically.
  Tooltips run to 318 characters (median 37; 29 of the 189 exceed 80), so one fixed strip holds the
  longest without covering the controls being compared, and it is what makes the tooltip reachable
  without a mouse at all. The legacy delivers tooltips through the `title` attribute alone.
- **A dropdown takes the readout's column** in the plate — a window repeating the word already on
  screen spends a column of a dense panel on nothing. The exception is an unequipped slot, where
  there is no choice to read back and the window is needed; that case is real (`chord key
  signature` and the harp transient `waveform` both arrived in firmware 6).
- **Menus are right-aligned**, so a plate has one edge where values are found.

  *Conditional:* use the native `<select>`. If Chromium does not honour `text-align` inside the
  open popup — unverified at the time of writing; the closed menu does align — replace it with a
  hand-drawn listbox that preserves the whole repertoire above. You decide nothing here; you look.

- **The disabled state is an unequipped slot, not a dimmed row.** A parameter newer than the
  connected firmware keeps its place in the panel: the cap goes dead, the window reads the firmware
  the parameter wants, and the readout says why. On firmware 8 this **never fires**; on 7 it is
  three controls (`chord channel`, `harp channel`, `single port mode`); at the oldest, eighteen.
  Availability is `isAvailable(parameter, values[7])`.

### 8.3 The sequencer

Addresses 220–235 are drawn as **one step sequencer: sixteen steps across, seven rows down**, on a
full-width plate. The legacy drew them as sixteen unrelated integer sliders.

- A **column is a parameter**; a **cell is a bit**.
- Rows carry the **chord note** they play and the **voice** they borrow: bit `i` is note `i + 1`,
  on voice `i + 1` for the first four and `i - 2` for the last three.
- **Steps past `cycle length` (address 188) read as out of cycle and stay editable.** The firmware
  never reaches them, so drawing all sixteen identically is a quiet lie; but shortening the cycle
  must not destroy what lies past the end.
- Cells feed the readout like any other control (§12.4).

### 8.4 The pickers

Addresses 10, 12, 14 and 16 hold **the SysEx address of another parameter** — which one the
physical knob drives. The legacy asks you to pick it by dragging a fader across 21..219, so today
you choose *which parameter to control* by dragging a cursor over an address number.

A picker lists its targets **by name**: every visible parameter with an address in 21..219, in
address order, plus "none" at rest.

Their `default_value` is **0, outside their own declared minimum of 21**. Any control here has to
survive a value its declared range excludes — do not clamp it into range.

### 8.5 `bank color` (address 20)

The one parameter whose value *is* a colour. It keeps its kind — a `slider`, so the counts above
are untouched — and gains two things the data cannot express: **the slot carries the spectrum and
the cap is filled with the chosen hue**, and a **swatch at full saturation** sits beside it, since
the firmware drives the physical LED at full saturation. A 0..360 fader in a grey slot asks you to
drag and guess.

This holds even though the panel itself ignores the hue everywhere but the strip: the panel may
ignore it, the device never does.

`bank color` is **pinned in the randomiser** (§11.5).

### 8.6 The named enumerations

Fourteen addresses carry a named enumeration. **No label here was invented** — every one is read
out of the firmware source or spelled out in the parameter's own tooltip. The labels themselves are
in Appendix A.

| addresses | enumeration | source |
|---|---|---|
| 42, 59, 62, 93, 100, 122, 125, 128, 152, 156, 160 | the twelve waveforms | the `waveform_array` comments in `firmware/src/main.cpp`, confirmed verbatim in every waveform tooltip |
| 35 | the twelve key signatures | `firmware/src/main.cpp` |
| 40 | the seven harp shufflings | the row comments of `harp_shuffling_array` |
| 120 | the six chord shufflings | the row comments of `chord_shuffling_array` |

Waveform index 4 maps onto a different Teensy constant than its position suggests; this is
irrelevant to the app, which sends the index, but it is why the list is not simply the Teensy enum.

*Decided in: [Design the parameter control itself](https://github.com/spippoli/minichord/issues/10) · [Decide the panel's visual language: bank hue and dark mode](https://github.com/spippoli/minichord/issues/16) · [Design the information architecture for 195 parameters](https://github.com/spippoli/minichord/issues/9) · prototype: `prototype/parameter-control` (throwaway, may no longer exist).*

---

## 9. Connecting

### 9.1 A gate, then a strip

**Before the first dump the app is nothing but a connection screen. After it, the editor is the app
and connection lives in one line of the top bar.**

The store holds nothing until the first dump (§5.2), so there is nothing for an editor to draw; a
panel of 189 empty controls is noise imitating an interface, and the legacy pays for the opposite
choice with two variants of every control to maintain.

**The gate is not a permanent shell.** Once the first dump lands it is gone, and a mid-session
disconnect does **not** bring it back — by then there are values worth looking at.

### 9.2 Access is decided by capability, never by identity

- If `navigator.requestMIDIAccess` is **absent**, the gate is a hard stop with no Connect button and
  **one message for every such browser**. No user-agent sniffing, and no browser-specific variants.
  Firefox is not gated a priori: its API is present, so it walks the normal permission path and
  fails there like any other rejection if it does.
- Otherwise `navigator.permissions.query({ name: 'midi', sysex: true })` answers `granted` /
  `denied` / `prompt` **without raising the prompt**, and the three cases get three behaviours:

| answer | behaviour |
|---|---|
| `granted` | call `requestMIDIAccess` at once; the gate flickers and is gone |
| `prompt` | show an explicit **Connect** button, so the browser prompt is the visible consequence of an action |
| `denied` | do not call at all; name the recovery precisely (the lock icon in the address bar → MIDI → Allow) |

The `prompt` case is deliberate: since Chromium M121 all MIDI access prompts as a single per-site
permission covering SysEx, and an unrequested prompt two seconds after page load is the one people
deny by reflex — and `denied` is sticky. The recovery copy for `denied` is Chromium-specific and
will age; that is accepted.

**`PermissionStatus.onchange` is subscribed to**, so flipping the permission back in site settings
leaves the blocked state on its own. This retires the legacy's only message on the subject, "please
reload and provide the authorisation" — which is outright false in the `denied` case, where
reloading changes nothing.

### 9.3 Discovery: the name filters, the dump decides

The firmware declares **one** USB product string, exactly `minichord`, and no per-cable names — the
two cables come from a build patch. So **port names are invented by each OS**: Linux gives
`minichord MIDI 1` / `MIDI 2` (confirmed), macOS smells of `minichord Port 1`, and on Windows both
cables may simply be called `minichord`, where the legacy's exact-match clause picks whichever
comes first, meaninglessly.

Since only cable 1 carries SysEx, the device can answer the question we cannot:

1. **Filter** the ports whose name contains `minichord`, case-insensitively —
   `isCandidatePort(name)`, a pure function in `state/connection/ports.ts`. The filter exists only
   to bound the blast radius: we do not spray SysEx at someone else's synth on the same bus.
2. **Probe** every candidate pair in parallel, each with a **1 second** window (§3.3). Cable 2
   stays silent and excludes itself, whatever its name.
3. **Count the answers.**

| answers | state | what happens |
|---|---|---|
| 0 | `no-device` | one state for "no candidate by name" and "candidates stayed mute" alike — for the user they are the same thing with the same remedy. A **manual picker over *all* MIDI output ports** is offered; picking one probes it, and if it stays mute we say so and remain disconnected. |
| 1 | bind | the winner is the control port |
| 2+ | `choose` | two minichords on one machine is legitimate, not an error. Show both port names and let the user click. No invented tie-break — "the first one" means nothing. |

**Never "connected blind".** Being connected *means* having received a dump; there is no
"port found but mute" state to dress up as success.

**The choice is not remembered across loads.** Port ids are not verified stable across a replug on
desktop Chromium, and the name is ambiguous in exactly the cases where the choice mattered.
Re-probing costs one message and a millisecond, which is cheaper than defending a stored preference
that can point at nothing.

> **Not:** persisting the chosen port in `localStorage`. Someone with two devices re-clicks each
> session; that is accepted. This is also what keeps `localStorage` out of the specification
> entirely — see §7.4 for the other half of the same rule.
> ([reasoning](https://github.com/spippoli/minichord/issues/11))

### 9.4 Disconnection mid-session: read-only, not a gate

Per §1.5 the device may re-enumerate unprompted. It is an ordinary event.

**The editor stays up with its values, and the controls go read-only.** The store is optimistic, and
with no wire the optimism becomes a lie: the control would move, the value would change on screen,
and the device would know nothing. Better to refuse the gesture than to honour it dishonestly. The
refusal is enforced in the reducer (§5.2).

The signal is the strip — **not a modal, and it does not steal focus.** The legacy calls
`focus()` and `scrollTo(0, 0)`, tearing you out of the page. Per-control divergence LEDs stay lit:
reading what you had changed is useful while you reseat the cable.

Two alternatives rejected: a **write queue** (on return the device has reloaded its bank and the
dump wins anyway, so the queue would collide with it within milliseconds) and an **opaque freeze**
(punitive, and it hides the very values you would want to note down).

### 9.5 Reconnection: automatic, and the loss is stated

`statechange` → re-probe → bind → `requestDump()` → the strip goes green. Automatic, silent, no
"reconnect" button, no polling: wait for the event, indefinitely.

A re-enumeration is a reboot. The device reloads its bank from flash and emits an unsolicited dump
on its own, that dump wins over everything (§5.3), and the unsaved edits vanish from both sides at
once — while the strip would otherwise read like good news. **So the fact is stated: one line
saying the device restarted, that the unsaved edits are gone, and which bank it came back on.** The
dock clears.

> **Not:** re-applying the lost edits on reconnection. The dock knows every touched address, so it
> is possible; it is more machinery than the situation earns, and re-applying into a possibly
> different bank would mean writing a preset the user was not looking at.
> ([reasoning](https://github.com/spippoli/minichord/issues/11))

### 9.6 No minimum firmware, but the version is shown

> **Not:** a minimum-firmware check. The legacy has one and it is **dead code**: it compares the
> version against `0.02` while address 7 holds an integer counter, currently 8, so `8 < 0.02` has
> never fired for anyone. Porting it would not preserve a protection, it would introduce one.
> Version differences are carried entirely by per-parameter availability (§8.2).
> ([reasoning](https://github.com/spippoli/minichord/issues/6))

**The firmware version is displayed** — in the gate while connecting, and in the strip afterwards,
next to the port name. It is invisible in the legacy editor, and it is the only explanation for an
unequipped slot; without it, "this control is missing" reads as a bug.

### 9.7 Where messages land

- **The gate**: everything before the first dump — permission, probing, no device, choosing between
  two, incapable browser.
- **The strip**: everything after — connected (port and firmware version), disconnected,
  reconnecting, and the two lines §9.5 and §10.5 put there.
- **Never the readout.** It explains the control under the pointer and is governed by the pointer;
  a device message dropped in there would vanish on the first mouse move, precisely when it matters
  most. Two different clocks (§6.1, invariant 7).
- **Never a modal, never an `alert()`, never a focus steal.** This explicitly closes the legacy
  pattern.
- **On screen goes only what has a human remedy** — reseat the cable, grant the permission, pick a
  port. A typed `error` reason describing a bug of ours (a malformed message, an out-of-range
  value) goes to the console.

### 9.8 The eight states

Before the first dump — the gate:

| state | entered by | shows | exit |
|---|---|---|---|
| `unsupported` | `requestMIDIAccess` absent | the single message, no button | none |
| `blocked` | permission `denied` | where to re-open the permission | `PermissionStatus.onchange` |
| `idle` | permission `prompt` | the **Connect** button | click → browser prompt |
| `searching` | access granted | that we are looking | the probe answers |
| `no-device` | no port answered | how to connect it, plus the manual picker | `statechange`, or a manual pick |
| `choose` | two or more answered | the port names | click |

After the first dump — the strip:

| state | shows | controls |
|---|---|---|
| `connected` | port and firmware version | live |
| `interrupted` | that we are retrying | read-only; values and LEDs still readable |

`interrupted` returns to `connected` by itself.

*Decided in: [Decide the connection lifecycle and its UX](https://github.com/spippoli/minichord/issues/11) · [Decide where the connection state machine lives across the layers of #4](https://github.com/spippoli/minichord/issues/18) · [Draw the transport boundary between the SysEx layer and the app](https://github.com/spippoli/minichord/issues/6) · [Research: Web MIDI on Chrome Android — sysex permissions and USB device enumeration](https://github.com/spippoli/minichord/issues/2) · [Build a throwaway minichord protocol simulator](https://github.com/spippoli/minichord/issues/7).*

---

## 10. Banks and persistence

### 10.1 The bank is a place you are in, not a place you can go to

The firmware has no load-bank command (§1.2), so **bank navigation belongs to the physical buttons
alone and the app never offers it.** The legacy's bank dropdown was never a navigator: it is the
*target* of the save, and touching it silently redirects where your work lands.

### 10.2 Saving targets the current bank only

One action, no target selector. Saving sends `(2, currentBank)`.

> **Not:** a bank selector on save. The legacy has one, so this is a deliberate loss of parity — you
> must now walk to bank 7 with the physical buttons before saving into it. Keeping the target and
> naming it honestly ("copy to bank N and go there") was considered: on the wire `save_config` sets
> the current bank before reloading, so the gesture *always* moves you, and an app-side target is
> app-driven navigation through the destructive door. It also moves the floor under the dock.
> ([reasoning](https://github.com/spippoli/minichord/issues/12))

A save is a ~165 ms round trip that confirms itself with an unsolicited dump. That is long enough
to need an acknowledgement and short enough that it must not be a modal progress state.

### 10.3 The reference the "unsaved" LED compares against

**The reference is the last state known to have been *loaded*.**

A dump never says where it came from, but two species carry opposite meanings: the one closing
`load_config` *is* the flash file, while the one answering `(0, 0)` is live state with unsaved edits
included. Baselining on the latter would silently declare everything saved on every connection
probe and every one-second retry.

They are told apart by **what caused them, never by inspecting them**, because `load_config` runs
only on a physical bank button (which always changes the bank number — there is no button that
reloads the same bank), on a save or reset we sent, or at boot. So the reference is captured on
exactly three events:

1. the session's first dump;
2. a dump whose bank id differs from the store's;
3. a dump following a save or a reset we issued.

Every other dump updates values (§5.3) and leaves the reference alone.

**Stated as an assumption and not repaired:** the first dump is the answer to our own probe, so it
is live state, and any physical pot drift since the last load is already inside it and counts as
saved. The flash is readable only in the instant the device loads it. The alternative — no reference
until the first bank change, meaning dead LEDs and an empty dock for a whole session — is worse.

### 10.4 Confirmation scales to the blast radius, and is never a modal

| action | command | confirmation |
|---|---|---|
| save | `(2, currentBank)` | **none.** It is the intended act, and the LEDs already state exactly what will change. |
| reset bank | `(3, currentBank)` | **armed in place**: the button becomes its own question, a second click executes, it disarms after a few seconds. No overlay, no focus steal, keyboard-reachable, and the panel you are about to wipe stays visible. |
| wipe memory | `(1, _)` | a **typed confirmation**, in the maintenance area (§10.6), away from the editing row. A different friction, not merely more of the same: it repairs corrupt flash, it is not a gesture of editing. |

This does not contradict §9.7's no-modal rule, which governs messages the app raises on its own
initiative, not a question asked in response to a click. A native `confirm()` is the worst option
available: it steals focus, cannot be themed into the panel, and has one shape for two very
different gravities.

The legacy asks nothing before either destructive command.

**Revert yes, undo no.** Discarding unsaved changes is just re-sending the reference of §10.3, and
it is the dock's "revert all" rather than new machinery. It touches no flash, so no confirmation.
It exists because if the LEDs tell you that you diverged, the gesture opposite to saving must
exist.

> **Not:** undoing a bank reset. It is technically possible — hold the previous 256 values, re-send,
> re-save — and it is rejected on the measurements: a 254-message bulk write does not self-confirm
> (§1.6), so a partially failed undo leaves a third state that is neither the old one nor the
> factory one, and the optimistic store will show it as if it had worked. Making an irreversible
> device action look reversible is worse than declaring it irreversible.
> ([reasoning](https://github.com/spippoli/minichord/issues/12))
>
> The honest escape hatch exists instead: **arming the reset is also the moment the app offers the
> preset code** of the state about to be destroyed — one line beside the confirmation, not a
> mandatory step.

### 10.5 Colour and the loss notice

**The active bank only**, number and hue together in the strip, beside the port and the firmware
version. The hue is the live value of address 20.

**Not:** a twelve-slot bank map. It would be a register of things you cannot act on — you neither
navigate to them nor save into them — mostly empty, and the filled cells age badly: a bank edited
elsewhere makes the hue we remember false, with nothing to signal it. The factory hue table exists
client-side, and showing it would lie precisely about the banks that matter, the edited ones.
([reasoning](https://github.com/spippoli/minichord/issues/12))

**A bank change announces its losses once, in the strip, and only when there were any.** A clean
switch says nothing — the bank number and the hue have already changed in that same strip and speak
for themselves. This is admitted past §9.7's human-remedy rule because it is the only moment the
user learns that the gesture made with the right hand threw away the work done with the left. The
count is the dock count in the instant before the dump.

### 10.6 The maintenance area

A region of the panel, away from the editing row, holding: **wipe memory** with its typed
confirmation, and the preset **export** and **import** fields of §11.

*Decided in: [Decide the bank model and persistence UX](https://github.com/spippoli/minichord/issues/12) · [Build a throwaway minichord protocol simulator](https://github.com/spippoli/minichord/issues/7) · [Decide the panel's visual language: bank hue and dark mode](https://github.com/spippoli/minichord/issues/16) · [Decide who owns the 256-value state, and how writes and dumps interact](https://github.com/spippoli/minichord/issues/8).*

---

## 11. Preset codes and the randomiser

### 11.1 The preset format: frozen on write, lenient on read

A preset code is base64 of `v0;v1;…;v254;` — **255 values, not 256**, with the trailing separator.
The legacy's own generator loops to 254, so address 255 never leaves; `split(";")` then yields 255
values plus a trailing empty string, and *that* is what satisfies its `length != 256` check. On
import that empty element coerces to 0, which is why **every legacy import writes 0 to address
255**.

**Write exactly that**, byte for byte, so every code this app produces stays importable by the
legacy editor and by the minishop.

**On read, accept 254–256 values, terminator optional.** The ecosystem has two parsers of one
format with different strictness: the legacy editor demands exactly 256 elements, the minishop is
lenient, and the curated preset **"Ice Cream"** has 255 elements and no terminator — it loads from
the minishop and is rejected by the editor as a malformed code. One published code in 43 is
unreadable by the tool meant to read it. Leniency admits it.

Two rules about content:

- **Addresses no parameter claims (§1.4) serialise as `0`**, exactly as the legacy does. The same
  sound then produces the same code, comparable and diffable against legacy ones, and no undeclared
  device state leaks into a public string.
- **Codes carry the fiction of §5.4.** The hidden group at 2–7 still has values in the store, so an
  export reads them: all 43 published codes begin `0;0;50;50;512;512;512;0`. Byte 7 is inert
  whatever it says, because the firmware heals it.

### 11.2 Validation rejects structure, never range

| rejected | accepted |
|---|---|
| undecodable base64 | anything outside `min_value`/`max_value` |
| a non-integer field | |
| a value count outside 254–256 | |
| a value outside the wire range 0–16383 | |

> **Not:** clamping imported values into the declared `min_value`/`max_value`. The legacy editor is
> strict here and it is wrong: **31 of the 43 published presets violate their own declared minimum**
> on addresses 106/107, where `0` plainly means "MIDI channel off", and a clamp would silently
> switch on a channel the author had switched off.
> ([reasoning](https://github.com/spippoli/minichord/issues/13))

The wire-range check is the same bound the transport throws on (§3.4). The reason for a rejection is
written under the field, specific, and never in an alert.

### 11.3 Import: what is sent, and what happens when it comes back wrong

**Import writes only the addresses `parameters.json` declares** — 189 messages, not 253.
Values sitting at undeclared addresses in someone else's code are ignored, not propagated: the
read-side mirror of the zeros written on the write side.

Three addresses ranges are never written:

- **2–7**: 2–6 are the fiction the store asserts and the confirming dump would overwrite anyway; 7
  is healed by the firmware. You import someone's sound, not their volume.
- **1**: writing it poisons the bank id of every later dump (§1.5).
- **255**: the legacy writes 0 there purely as a side effect of the trailing separator.

**A load that comes back wrong gets one repair round, then is stated.** The load ends with a dump
request; the returning dump is compared against what was sent, excluding 2–7; divergent addresses
are re-sent and a second dump requested. **Stop after the second round** — a second loss on the
same address is under 0.1% given the ≈2.5% bound, so a third round would not be fighting packet
loss, it would be fighting the firmware normalising a value. If anything still diverges, the strip
says how many and stops.

This repair round exists *only* because a bulk write is not self-confirming (§1.6). Without that
measurement it would read as paranoia.

### 11.4 The surface

Export and import are **plain fields in the maintenance area** (§10.6) — no modal, no `prompt()`,
no `alert()`, all of which the legacy uses.

- **Export** writes the code into a read-only selectable field with a Copy button. The legacy copies
  to the clipboard and fires an alert.
- **Import** is a paste field that validates as you type, with Apply disabled until the code is
  valid.
- **Import arms in place only when the bank is dirty**, per §10.4's blast-radius rule: flash is
  untouched (the physical bank button gets the saved state back), so a clean bank imports on the
  first click, and a dirty one turns the button into its own question carrying the count of edits
  about to die. The safety net is already on screen — the Export field above always holds the code
  of the state you are about to discard.
- **No round trip without a device.** The gate has no exception: the store holds nothing before the
  first dump, so there is no state to export and applying an import would mean nothing. No offline
  mode is specified.

### 11.5 The randomiser

**The gaussian is centred on the live state.**

> **Not:** centring on a preset drawn at random from `shared_presets.json`, which is what the legacy
> does on *every* click, announcing the seed only to the console. Centring on what is currently in
> the bank makes randomising a mutation of what you are hearing, composes with the dock (revert-all
> undoes it), turns repeated clicks into an exploratory walk instead of disconnected jumps, and
> drops a dependency on a minishop file that is out of scope for this app.
> ([reasoning](https://github.com/spippoli/minichord/issues/13))

- **`weirdness` is a control**: a `slider` from §8.2 with the full repertoire, default **10%**. With
  a live centre it is the only remaining variable, and it is literally "how far do I go".
- **The scope is the section on screen**, with the button in the section header beside `fold all` /
  `open all`. Randomising harp leaves chord and global untouched, and every resulting change appears
  in the section you are looking at rather than as 171 rows nobody will read.
- **One number, one strategy per kind** — because several of these values are not quantities:

| kind | rule |
|---|---|
| `slider`, `stepper` | `σ = range × weirdness`, gaussian around the current value |
| `toggle` | flips with probability `weirdness` |
| `select`, `picker` | changes with probability `weirdness`, then picks uniformly among the *other* entries |
| `sequencer` | each of the 16 × 7 steps flips with probability `weirdness` |

  A gaussian on a `select` picks the adjacent index, which for the twelve waveforms is an arbitrary
  table order; on a `picker` it would pick a neighbouring *SysEx address* (§8.4).

- **The pinned list stays in code**, beside the taxonomy, and is not user-editable. It is a client
  preference, not a device fact — `parameters.json` is the contract shared with the firmware. It is
  grouped by the reason a list of numbers in JSON could not carry:

| pinned | why |
|---|---|
| everything below 19 | not sound |
| **20** (`bank color`) | the bank's identity — a dice roll over the sound must not rename the bank, and the *physical* LED moves too, and stays moved until the bank is saved or reloaded. The legacy's threshold is `idx < 19` while its own comment says 21, so today it rerolls the hue on every click. |
| 32 (`led attenuation`) | the panel LED |
| 33, 34, 35 | musical rather than timbral choices |
| 41, 97, 197 | output gains — hearing |
| 106, 107, 108 | MIDI routing |

- **No confirmation, but a one-shot undo.** Asking before a gesture meant to be repeated ten times
  in a row would kill it. The first click randomises; immediately after, the button offers to go
  back and re-sends the values the section held a moment earlier. §10.4's objection to undo does not
  apply here: the compare-and-repair of §11.3 covers this write too, and a section is at most 96
  addresses.

### 11.6 Provenance

The randomiser descends from the decisions in this section, not from the legacy file. Box-Muller is
standard mathematics; the seed, the scope, the exposed sigma and the per-kind strategies are all
different. Two things must be **re-derived rather than copied**: the negative fold (a declared
reflection, or plain truncation) and the pinned address list, which the categories above justify on
their own.

Credit to TerminalWaltz stays in the module as **declared inspiration**, without claiming a copy and
without pulling GPLv3 into a BSD-3 app. Today that attribution lives only in a two-line comment in
the legacy `index.js`; the repository has no `LICENSE` file at all.

*Decided in: [Decide the preset code and random generator UX](https://github.com/spippoli/minichord/issues/13) · [Decide who owns the 256-value state, and how writes and dumps interact](https://github.com/spippoli/minichord/issues/8) · [Build a throwaway minichord protocol simulator](https://github.com/spippoli/minichord/issues/7) · [Decide the panel's visual language: bank hue and dark mode](https://github.com/spippoli/minichord/issues/16) · [Decide the bank model and persistence UX](https://github.com/spippoli/minichord/issues/12).*

---

## 12. Keyboard and screen readers

**The panel is driven by Tab, and a control is one thing under the hand.** Everything in this
section was verified with a real screen reader (Orca on desktop Chromium) against a prototype
wearing it, except where noted in §12.8.

### 12.1 What the numbers are

A chord section — the worst case, since only one section is mounted — is **90 tab stops**: 80
controls, 9 plate headers, 1 sequencer. Drawn the naive way, with every focusable part in the
order, it would be 269.

That figure is an *outcome*, not a target: it changes by itself the day a parameter is added to
`parameters.json`. It is here as evidence for the decisions below, not as a budget.

### 12.2 One control, one tab stop

The **body** — fader, rocker, menu, picker, stepper — is the only stop.

- **`Enter` enters the value window**, `Escape` leaves it (discarding the draft, never committing
  it).
- **The stepper's `−` / `+` buttons drop out of the order** (`tabindex="-1"`): the arrows already do
  that work by value, and the buttons are a pointer affordance.

Rejected: leaving every part in the order (honest, but Tab stops being navigation at 269 stops),
and one stop per *plate* with arrows moving between controls — ruled out because the arrows are
already spent on the value (§8.2).

The cost is stated rather than repaired: with Tab no longer walking into the value window by
accident, a user who does not know `Enter` will not find the field. **The readout is where that is
said** (Appendix A.4).

### 12.3 Reaching a plate costs no new vocabulary

- **`Ctrl+K` then `Tab` lands on the first *matching control***, not on the next button in DOM
  order. Without this it crosses `fold all`, `open all`, the strip and the readout first — four or
  five stops of friction on every search.
- **`fold all` stays the pruning tool** for browsing rather than searching, reducing a chord section
  to nine plate headers.
- **The three section buttons are a real `tablist`**: one stop, arrow keys to change section. It is
  the one place the markup was lying about what it is.
- **The dock's jump link moves focus** onto the control, after switching section and unfolding the
  plate. Without that it moves the eye and not the hand — and the hand could not follow anyway,
  because the dock sits *after* the grid in DOM order, so Tab from a dock link leaves the document.
- **A skip link is the panel's first stop** — to the dock and back. Reaching the dock otherwise
  means crossing all 96 controls of a chord section. It is the oldest mechanism on the web,
  discovered by pressing Tab, and it costs no new key.

Rejected: `Ctrl+1..9` per plate (nine numbers whose meaning changes with the section, to buy what
search already buys), reordering the DOM so the dock precedes the grid (a reader would then hear
the result of editing before the panel that produces it, and the dock is empty until something is
touched), and an `F6` region cycle (a key nothing announces).

### 12.4 The sequencer is a grid

One tab stop for the whole thing: `role="grid"` with roving tabindex, arrows to move, `Space` to
toggle, `Home` / `End` for the ends of a row, re-entry at the last cell touched.

This does not contradict §8.2's "arrows move the value", and the reason is §6.1 invariant 3: a
column is a parameter and a cell's value is a bit, so there is no quantity for the arrows to move.

Two things decided with it: **the cells feed the readout** — in the legacy arrangement only the
column headers answered the pointer — saying the column's parameter plus the row's note; and
**steps past `cycle length` stay reachable by arrow**, because skipping them would make them
editable by mouse and not by keyboard, which is the exact disparity this section exists to remove.

`display: contents` on the row wrappers does not break the `grid → row → rowheader/gridcell →
checkbox` tree; this was verified.

### 12.5 What a screen reader is told

**`aria-describedby`, not a live region.**

> **Not:** a live region on the readout. It is the natural instinct, and it is wrong: the reader has
> already announced the control on focus, and the region fires again, out of order. Verified in
> practice — the description lands after name and value, once, and is *not* re-read on every arrow
> press.
> ([reasoning](https://github.com/spippoli/minichord/issues/17))

- The **readout is `aria-hidden`**. It is a visual convention a reader has no reason to look at, and
  the same words arrive as the control's own description. Verified to cost a reader nothing.
- **The `aria-describedby` target must itself be `aria-hidden`.** Chromium still computes the
  description from hidden text, and without it the same sentence is *also* read as loose text inside
  the plate — the duplication that marking the readout hidden was meant to avoid.
- **Every read-only value window is `aria-hidden`.** An `<output>` element maps to `role="status"`,
  which is a live region firing on every value change — the very antipattern rejected above. This
  is not hypothetical: it is what happened.
- **The two state LEDs join the description** ("changed from the stored bank", "differs from the
  factory default"). For a reader that state had never existed at all, both being empty elements in
  the panel. Verified to read as state rather than as noise.
- **Ambiguous names are fixed by structure, not repetition.** `attack` and `waveform` exist in both
  harp and chord. **The plate is a `role="group"` labelled by its own heading**, announcing itself
  once on entry, rather than lengthening 189 labels with "chord / envelope /". Verified to announce
  on entry, not per control.

### 12.6 The unequipped slot is `aria-disabled`, never `disabled`

> **Not:** the `disabled` attribute. It removes the element from the tab order and from focus, so
> the explanation of §8.2 — the readout saying which firmware the parameter wants — reaches the
> mouse only. The slot stays a tab stop, refuses input, and its description names the firmware.
> Verified to explain itself rather than sound broken.
> ([reasoning](https://github.com/spippoli/minichord/issues/17))

This never fires on firmware 8; it is three controls on 7, eighteen at the oldest. Cheap to get
right, and it is the rare case where the user needs the explanation most.

### 12.7 One focus ring

**One token, defined once, for everything focusable:** `2px solid` at offset 2, in the LCD's own ink
colour per moulding, **`:focus-visible` throughout**, and **inset** on a sequencer cell, where a 2 px
outset ring on a 12 px square invades its neighbours.

Three defects this replaces, all of them live at the time of the decision: the ring existed on
**two of six kinds**, the rest falling back to Chromium's system blue in the middle of an 80s panel;
1 px is thin for ten identical controls stacked in a plate; and `:focus` and `:focus-visible` were
mixed, so windows and the search box lit up under the mouse.

Rejected: a dedicated focus colour distinct from the ink (a sixth colour, to buy what thickness
buys) and 1 px plus a secondary cue. Both mouldings separate cleanly with the ink colour, so the
contrast question §7.4 hands over resolves as a non-question.

### 12.8 Two things nobody has felt

Reported rather than glossed, because they are the only claims in this section that rest on
reasoning alone:

- **`Enter`-to-enter-the-value-window is an invented gesture.** No other control on the web uses it.
  Whether it falls naturally under the fingers is exactly the kind of thing prose cannot settle,
  and nobody has driven it. It is specified anyway; if it proves wrong in use, the decision to
  revisit is §12.2, not the rest of the section.
- **The parameter's name and address are loose text in front of every control** (the visual label),
  so the name is heard twice in browse mode. Left as it is; noticed rather than decided.

*Decided in: [Decide keyboard navigation and accessibility across the panel](https://github.com/spippoli/minichord/issues/17) · [Verify the accessibility structure of #17 with a real screen reader](https://github.com/spippoli/minichord/issues/21) · [Design the parameter control itself](https://github.com/spippoli/minichord/issues/10) · [Design the information architecture for 195 parameters](https://github.com/spippoli/minichord/issues/9) · prototype: `prototype/parameter-control` (throwaway, may no longer exist).*

---

## 13. Left open · Out of scope

### 13.1 Left open

The complete index of `**Open:**` markers. Nothing else in this document is deliberately
unspecified above the altitude declared in §0.

| what is free | where |
|---|---|
| the mechanism by which a control's tab stop is reached by address | §6.1, invariant 6 |
| the concrete colour values behind the panel's ~110 tokens | §7.4 |

### 13.2 Out of scope

Not fog, and not a to-do list: work consciously ruled outside this app.

- **The minishop** (`minishop.html` and its `PresetManager`). This app replaces the editor only; the
  preset shop stays as the existing vanilla page. This is also why §11.5 drops the dependency on
  `shared_presets.json`.
- **Deployment.** `documentation/build_site.sh` and the GitHub Pages pipeline are untouched; only
  the Vite dev server matters for now. The app stays a purely static SPA with no backend, so a
  future integration is a copy of the build output.
- **Changes to `generate.py`, and removal of the legacy editor.** The generator also emits the
  firmware's C++ switch, so reworking it is its own effort. **The two editors coexist
  indefinitely**, and cross-links between them are a documentation concern, not this app's.
- **Safari and iOS.** WebKit implements no Web MIDI API anywhere.
- **Android and mobile in general.** Chrome on Android does support Web MIDI, so this is a scoping
  choice rather than a technical wall — but a LAN dev-server origin is not a potentially trustworthy
  origin, so `requestMIDIAccess` is not even exposed on the phone, and the usual workaround collides
  with the device being in USB host mode.
- **Offline editing.** No device, no state (§5.2).
- **Fixing the root `.gitignore`** (§2.6).

*Decided in: [Map: a React + Vite SPA replacing the minicontrol editor](https://github.com/spippoli/minichord/issues/1) · [Decide how ui/ is cut into components, and whether SPEC.md names the boundaries](https://github.com/spippoli/minichord/issues/22) · [Decide the panel's visual language: bank hue and dark mode](https://github.com/spippoli/minichord/issues/16).*

---

## Appendix A — the user-facing strings

Everything the user reads that is not taken from `parameters.json`. This appendix is **normative**:
it is the one part of the app an implementer would otherwise invent without noticing they were
deciding.

Sentence case throughout, no exclamation marks, no "oops". The device is *the minichord*, lower
case, as the product string spells it.

### A.1 The kinds

Used in documentation and in the readout's kind note. Not shown as a label on any control.

| kind | name |
|---|---|
| `toggle` | switch |
| `select` | menu |
| `stepper` | stepper |
| `slider` | fader |
| `picker` | target picker |
| `sequencer` | step grid |

### A.2 The gate

| state | heading | body |
|---|---|---|
| `unsupported` | This browser cannot reach the minichord | The minichord is edited over the Web MIDI API, which this browser does not implement. Open this page in Chrome or Edge. |
| `blocked` | MIDI access is blocked | This site is not allowed to use MIDI. Click the icon at the left of the address bar, set MIDI to Allow, and this page will carry on by itself. |
| `idle` | Connect your minichord | Plug the minichord in, turn it on, and press Connect. Your browser will ask for permission to use MIDI. |
| `searching` | Looking for the minichord… | Asking every MIDI port whether it is a minichord. |
| `no-device` | No minichord answered | Check that it is plugged in and turned on. If it is, pick its port below — some systems name it in a way this page does not recognise. |
| `choose` | More than one minichord answered | Pick the one you want to edit. |

Buttons: **Connect** · **Pick a port** · **Try again**.

Field labels in `no-device`: *MIDI output port* for the manual picker.

After a manual pick that stays mute: *That port did not answer. It is either not a minichord, or not
its control port.*

While probing after a manual pick: *Asking that port…*

### A.3 The strip

| situation | line |
|---|---|
| connected | `{port name} · firmware {n} · bank {1–12}` |
| interrupted | Disconnected — waiting for the minichord to come back. Your edits are on screen but cannot be sent. |
| reconnected, nothing lost | Reconnected — bank {n}. |
| reconnected, edits lost | Reconnected on bank {n}. The minichord restarted and reloaded from flash, so {k} unsaved changes are gone. |
| bank changed with unsaved edits | Bank {n} loaded — {k} unsaved changes lost. |
| saved | Saved to bank {n}. |
| bank reset | Bank {n} reset to factory. |
| memory wiped | All banks reset to factory. |
| preset applied cleanly | Preset applied. |
| preset applied with divergence | Preset applied, but {k} values did not take. Try again, or check the minichord. |

`{k}` is always a count, and the singular is spelled out: *1 unsaved change*, *1 value did not
take*.

### A.4 The readout

Resting line, when nothing is hovered or focused:

> Point at a control, or tab to one, and it explains itself here.

The where-line is `{section} / {group} / {name}` with the raw address after it, and for a sequencer
cell `{section} / {group} / {name} — step {s}, note {n}` (plus *out of cycle* when the step is past
`cycle length`).

The kind note, appended after the tooltip:

| kind | note |
|---|---|
| `toggle` | on / off |
| `select` | pick a value by name |
| `stepper` | the arrow keys step the value; Enter types it |
| `slider` | drag, use the arrow keys, or press Enter to type the value |
| `picker` | points at another parameter |
| `sequencer` | one step of the pattern |

An unequipped slot replaces the note with:

> **Not on this device.** This parameter arrived in firmware {n}; the minichord you are connected
> to is older, so the slot is empty rather than editable.

### A.5 What a screen reader hears

One sentence, produced by the single producer of §6.1 invariant 5, in this order, joined with `. `
and ending in a full stop:

1. the sequencer note, when the control is a cell — *step {s}, note {n}*;
2. *Not on this device: this parameter arrived in firmware {n} and the connected minichord is
   older* — when unequipped;
3. the parameter's `tooltip`;
4. *changed from the stored bank* — when the amber LED is lit;
5. *differs from the factory default* — when the blue LED is lit.

The section and the group are deliberately **absent**: the plate's `role="group"` announces them
once on entry (§12.5).

### A.6 The panel chrome

| element | string |
|---|---|
| section tabs | Global · Harp · Chord |
| tab match count | `{n} matches` (title attribute; the count itself is the LED) |
| search field | placeholder *Search this section* · label *Search* |
| plate header, edited count | `{n} edited` |
| fold controls | Fold all · Open all |
| randomise button | Randomise · after a click, Undo randomise |
| `weirdness` control label | weirdness |
| skip link | Skip to the edit buffer · Back to the panel |
| dock heading | Edit buffer |
| dock, empty | Nothing changed since this bank was loaded. |
| dock row | `{name}` · `{stored} → {current}` · Revert |
| dock, revert everything | Revert all |
| dock, the fiction line | Harp volume, chord volume and the three potentiometer slots are physical knobs on the minichord. This page does not show them, and does not change them. |
| picker resting value | none |
| out-of-cycle step | out of cycle |

### A.7 Banks, presets, maintenance

| element | string |
|---|---|
| save button | Save to bank {n} |
| reset button, at rest | Reset bank {n} |
| reset button, armed | Click again to reset bank {n} to factory |
| reset, the escape hatch beside it | Copy this bank's preset code first |
| wipe, heading | Wipe all memory |
| wipe, body | This resets all 12 banks to the factory sounds. It cannot be undone. Type WIPE to confirm. |
| wipe button | Wipe all banks |
| export field label | Preset code for this bank |
| copy button | Copy |
| copy confirmation | Copied. |
| import field label | Paste a preset code |
| import button, at rest | Apply |
| import button, armed | Click again to replace {k} unsaved changes |
| import, in flight | Applying… |

Validation messages, written under the import field:

| cause | message |
|---|---|
| not base64 | That is not a preset code. |
| wrong number of values | A preset code holds 255 values; this one holds {n}. |
| a non-integer field | Value {i} is not a whole number. |
| a value outside 0–16383 | Value {i} is outside the range the minichord accepts. |

### A.8 The named enumerations

The twelve waveforms, in wire order — the shape is the label, and the name is what a reader hears:

`sine` · `sawtooth` · `square` · `triangle` · `bandlimited pulse` · `pulse` · `reverse sawtooth` ·
`sample and hold` · `variable triangle` · `bandlimited sawtooth` · `reverse bandlimited sawtooth` ·
`bandlimited square`

The twelve key signatures, in wire order (the circle of fifths, sharps then flats):

`C` · `G` · `D` · `A` · `E` · `B` · `F` · `B♭` · `E♭` · `A♭` · `D♭` · `G♭`

The seven harp shufflings (address 40), in wire order:

`triad, three octaves` · `add the seconds` · `add the fourth` · `add the sixth` · `barry harris` ·
`chromatic` · `keymaster / barry harris`

The six chord shufflings (address 120), in wire order:

`normal` · `octave up, chromatics` · `octave up, low chord notes` ·
`octave up, low fifth + low chromatics` · `octave up, low fifth + high chromatics` ·
`two octaves up`

*Decided in: [Decide the structure of SPEC.md and how the closed tickets flow into it](https://github.com/spippoli/minichord/issues/23) — which established that these strings were nowhere decided and belong here · [Design the parameter control itself](https://github.com/spippoli/minichord/issues/10) for the enumerations, every label read out of `firmware/src/main.cpp` or out of a tooltip · [Decide the connection lifecycle and its UX](https://github.com/spippoli/minichord/issues/11) and [Decide the bank model and persistence UX](https://github.com/spippoli/minichord/issues/12) for where each message lands.*
