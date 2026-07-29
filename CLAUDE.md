# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

- **Conversation with the user: always Italian.**
- **Everything written into the repository or into GitHub: English.** This covers code and comments, identifiers, UI strings, log messages, file and branch names, Markdown documents, ADRs, issue and PR titles and bodies, and commit messages.

## Git: this is a fork, upstream is read-only

`origin` is `spippoli/minichord` (the fork this work happens in). `upstream` is `BenjaminPoilve/minichord` (the original project).

- **Never push to `upstream`, under any circumstances** — no `git push upstream`, no branch or tag creation, no PR opened against `BenjaminPoilve/minichord`, no issue or comment posted there. Treat it as strictly read-only.
- Reading from upstream is fine and expected: `git fetch upstream`, `git log upstream/main`, `git diff upstream/main`, and merging or rebasing upstream changes into local branches (`git merge upstream/main`, `git pull upstream main`) are all allowed.
- All write operations target `origin`: feature branches and PRs go to `origin/dev` (see "Git workflow" below).
- With two remotes configured, `gh` may resolve the wrong repository. Always pass `-R spippoli/minichord` explicitly to `gh pr`, `gh issue`, and `gh api` calls.

## Git workflow

GitHub Flow, but **the integration branch of this repository is `dev`, not `main`** — this overrides the global instructions, which assume `main`.

- Cut every feature branch from the latest `origin/dev`: `git fetch origin && git switch -c <branch> origin/dev`.
- Never commit directly to `dev` or to `main`.
- Branch names: short, kebab-case, purpose-prefixed (`feat/...`, `fix/...`, `docs/...`, `chore/...`).
- Open pull requests **against `dev`**, always with the `gh` CLI and always with the explicit base and repo:
  `gh pr create -R spippoli/minichord --base dev --title "..." --body "..."`.
- `main` is only updated by merging `dev` into it, when the user explicitly asks for a release.
- Use `gh` for every GitHub operation (PRs, issues, labels, reviews, API), never the web UI and never a raw push to `dev` or `main`.

### Commit messages

Conventional Commits with an **extended message**: the subject line is never enough on its own.

- Subject: `type(scope): description` — types `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`; imperative mood, lowercase description, no trailing period, max ~72 characters.
- Blank line, then a body wrapped at ~72 columns explaining **what** changed and **why** (the context and the alternatives discarded), not how — the diff already shows how.
- Footer for metadata: `Closes #N` / `Refs #N` for issues, `BREAKING CHANGE: ...` (or `!` after the scope) for breaking changes.
- Write commits with a real multi-line message (`git commit -F <file>` or repeated `-m`), one logical change per commit.

## Project goal

This repository is a fork of the minichord project (hardware + Teensy 4.0 firmware + documentation).
The goal of **this** work is to **reimplement the `firmware/minicontrol/` editor web app as a new React + Vite SPA**, living in **`firmware/minireact/`**.

Practical consequences:

- `firmware/minicontrol/` is the **functional reference to replicate**, not code to extend. It is vanilla HTML/CSS/JS with no build step, and `index.html` (4000+ lines) is **generated**, not hand-written — see "Parameter generator" below.
- The real contract to honor is the **SysEx protocol** and `parameters.json`, not the existing DOM structure.
- **Only the local dev server matters for now** (`npm run dev`). No deployment integration: do not touch `documentation/build_site.sh` or `documentation/site/`, and do not add `firmware/minireact` to the GitHub Pages pipeline until asked. The SPA still stays a purely static app with no backend, so that future integration is just a copy of the build output.
- The app must run on Chromium: the Web MIDI API with `sysex: true` is not available elsewhere.

## Commands

### SPA (`firmware/minireact/`)

```bash
cd firmware/minireact
npm install
npm run dev       # Vite dev server — the only supported workflow for now
npm test          # Vitest, run once
npm run test:watch
npm run lint      # oxlint (what the Vite scaffold now ships instead of ESLint)
npm run format    # prettier, default options, on demand — no hook, no CI gate
npm run format:check
npm run build     # tsc -b && vite build
```

The project is scaffolded (React + TypeScript, Vite 8) and `firmware/minireact/SPEC.md` is the specification being implemented. The layer skeleton of §2.1 exists — `src/transport/`, `src/domain/`, `src/state/`, `src/ui/`, with dependencies running one way `transport → domain → state → ui` — and `npm run dev` mounts `src/ui/App.tsx`, which is the connection gate until the first dump lands and the strip plus an editor placeholder afterwards. The throwaway protocol simulator in `src/dev/simulator/` (see its `README.md`) and its bench `src/dev/SimulatorConsole.tsx` are development fixtures, not application code.

`firmware/minireact/.gitignore` is local to the project and covers `node_modules/`, `dist/` and Python bytecode. Beware the root `.gitignore`: its virtualenv patterns (`[Bb]in`, `[Ss]cripts`, `[Ll]ocal`, `[Ll]ib64`) are unanchored, so a `scripts/` or `src/bin` directory anywhere in the SPA would be silently ignored — which is why the Python helpers live in `tools/`.

### Device calibration harness

```bash
cd firmware/minireact
python3 tools/measure-device.py --json measurements.json   # needs a minichord attached
python3 tools/extract-firmware-defaults.py                 # regenerates src/dev/simulator/defaultBanks.ts
```

`measure-device.py` talks to the device over ALSA rawmidi rather than through a browser, and measures the firmware's SysEx ingest rate, dump latency and message loss. It writes only to addresses that no parameter claims, and never to flash.

### Parameter generator (Python)

From `firmware/generator/`, the single source of truth for parameters:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip3 install -r requirements.txt
python3 generate.py
```

`generate.py` reads `parameters.json` and produces three artifacts:

1. `firmware/minicontrol/index.html` — the complete legacy UI (via `airium`);
2. `firmware/include/sysex_handler.h` — the firmware's C++ `apply_audio_parameter(address, value)` switch;
3. a copy of `parameters.json` into `firmware/minicontrol/json/` for the web app to consume at runtime.

Hand-editing any of those three files is a mistake: the change belongs in `firmware/generator/parameters.json`.

### Firmware (PlatformIO / Teensy 4.0)

```bash
cd firmware && pio run          # build
cd firmware && pio run -t upload
```

Requires the `usb_desc.h` patch to `framework-arduinoteensy` documented in `firmware/README.md` (it exposes 2 MIDI cables).

### Documentation and deployment

```bash
cd documentation && ./build_site.sh   # mkdocs build + copies firmware/minicontrol into site/
```

`.github/workflows/static.yml` publishes `documentation/site/` to GitHub Pages on every push to `main`. `documentation/site/` is **committed** in the repo: it is versioned build output. Deploying the new SPA is **out of scope for now** (see "Project goal"); when needed, it will be a copy of `firmware/minireact/dist/` into `site/`, added to `build_site.sh`.

## Architecture

### The data model: 256 SysEx addresses

The entire device state is a flat array of 256 integers (`parameter_size = 256`), indexed by SysEx address. The map (defined in `firmware/src/main.cpp` around line 130, and to be honored client-side):

| Addresses | Content |
|---|---|
| 0 | control command (not a parameter) |
| 1 | bank ID |
| 2–9 | protected (2/3 harp/chord volumes, 4/5/6 potentiometer storage) |
| 7 | firmware version |
| 10–17 | potentiometer routing/ranges (limited access) |
| 21–39 | global parameters |
| 40–119 | harp parameters |
| 120–219 | chord parameters |
| 220–235 | rhythm patterns (7-bit bitmask: one voice per bit) |

`firmware/generator/parameters.json` describes every addressable parameter: `name`, `group` (UI subcategory; the `hidden` group must not be displayed), `sysex_adress`, `data_type` (`int`/`float`), `curve` (`linear`/`exponential`), `min_value`/`max_value`, `default_value`, `tooltip`, `introduction_version`, and `method` (used only to generate the C++ — irrelevant to the client).

Encoding details the SPA must preserve:

- **float**: integers travel on the wire; the real value is `value / 100` (`float_multiplier = 100.0`).
- **exponential curve**: send `exp((ln(max)/max) * sliderValue)`, read back `max * ln(sysexValue) / ln(max)`.
- **`introduction_version`**: compare against the firmware version read at address 7; parameters newer than the connected firmware must be disabled (legacy UI: `inactive` class).

### Web MIDI protocol

Every message is a SysEx of **exactly 6 bytes**: `[0xF0, addrLo, addrHi, valLo, valHi, 0xF7]`, with little-endian 7-bit splitting (`% 128`, `/ 128`). The firmware ignores any SysEx of a different length.

- When `addr == 0` the message is a **command**, where `valLo` is the command: `0` = send back the full state, `1` = wipe memory, `2` = save to bank `valHi`, `3` = reset bank `valHi` to defaults.
- When `addr != 0`, it is a parameter write (applied immediately, not persisted).
- The incoming dump is a SysEx of `256 * 2 + 1` bytes, decoded as `data[2i] + 128 * data[2i+1]`.
- The device is found by name among the MIDI ports: a name containing `"minichord"` **and** `"1"`, or exactly `"minichord"`. Requires `requestMIDIAccess({ sysex: true })`, hence Chromium only.
- On receiving a dump the legacy UI **overwrites** the potentiometers (4/5/6 → 512) and volumes (2/3 → 50) to neutralize the physical pot positions.

### Shareable preset format

A preset is base64 of `v0;v1;…;v255;` (256 values separated and terminated by `;`, floats already multiplied by 100). Loading a preset applies it by sending addresses 2 through 255 one by one, followed by the `(0, 0)` command to re-read the state. `firmware/minicontrol/json/shared_presets.json` is the curated library (`name`, `author`, `value`, `description`) shown by the "minishop".

### Legacy reference structure

- `javascript/minichordcontroller.js` — the `MiniChordController` class: MIDI connection, SysEx encode/decode, `onConnectionChange`/`onDataReceived` callbacks. It is the only conceptually reusable layer; in the SPA it should be ported as a pure transport module (no DOM access).
- `javascript/index.js` — the editor: sliders, rhythm checkboxes, preset export/import, random generator (normal distribution around a seed preset's values, `weirdness_factor = 0.10`, with a list of addresses kept fixed), dark mode.
- `javascript/sharing.js` — `PresetManager` for `minishop.html`.

### Rest of the repository (rarely touched for this goal)

`firmware/src/main.cpp` is a monolithic file holding the audio logic, chords, rhythm and LittleFS persistence; `firmware/include/audio_definition.h` defines the Teensy audio graph; `firmware/lib/` holds the drivers (AT42QT, MPR121, LittleFS, reverb, harp, potentiometers). `hardware/` is CC BY-NC 4.0, the software is BSD 3-clause.

## Agent skills

### Issue tracker

Issues live in the GitHub Issues of `spippoli/minichord`, via the `gh` CLI, always with an explicit `-R spippoli/minichord` so nothing is ever written to `upstream`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` glossary + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Conventions

- In the existing domain the word is spelled **`adress`** (single `d`) in `parameters.json`, in HTML attributes and in the firmware. Keep the typo where it is part of the data contract (JSON keys); use the correct `address` in new code.
- Upstream uses free-prose commit messages; the workflow required here is still GitHub Flow with Conventional Commits and PRs via `gh`, targeting `dev` (see "Git workflow" above).
