# minireact

The minichord editor, reimplemented as a React + Vite single-page app. It
replaces `firmware/minicontrol/` — the vanilla generated UI that is the
functional reference, not code to extend.

`SPEC.md` is the specification being implemented: the wire protocol, the four
layers and the panel it all serves. Read it before writing anything here.

## Commands

```bash
npm install
npm run dev          # Vite dev server — the only supported workflow for now
npm test             # Vitest, once
npm run test:watch
npm run lint         # oxlint
npm run format       # prettier, default options, on demand
npm run format:check
npm run build        # tsc -b && vite build
```

The app talks to the device over the Web MIDI API with `sysex: true`, so it
runs on Chromium only. With no device attached, `src/dev/simulator/` fakes one
at the `MIDIAccess` seam — see its README.

`tools/` holds the Python helpers: the device calibration harness and the
extractor that regenerates the simulator's factory banks. They live there
because the repository-root `.gitignore` silently swallows a `scripts/`
directory at any depth (SPEC.md §2.6).
