# minireact

The editor web app for the minichord: a React SPA in `firmware/minireact/` that reads and writes the
device's 256 SysEx addresses over Web MIDI.

**Scope.** This glossary covers the app being built. Device and firmware concepts appear only where
the app names them — `bank`, `harp`, `chord`, `rhythm` are here because they are the app's own
vocabulary, not as an index of the hardware. The rest of the repository (the Teensy firmware, the
generator, `hardware/`, the legacy `minicontrol` editor) has no glossary and needs none yet.

This file is the project's single source for these terms. `firmware/minireact/SPEC.md` points here
rather than defining them a second time.

## Language

### The wire and the device state

**Address**:
One of the 256 SysEx slots that together make up the whole device state. 195 of them are claimed by
a parameter; the rest carry a fact about the device, or nothing.
_Avoid_: slot, register, index

**Parameter**:
One record of `firmware/generator/parameters.json`, owning exactly one address, with a range, a
curve, a default and a tooltip. There are 195, of which 189 are drawn as controls.
_Avoid_: setting, field, property

**Wire value**:
The integer actually carried by SysEx, before any `/100` or curve is applied. A `float` parameter's
real value is its wire value over 100.
_Avoid_: raw value, sysex value, encoded value

**Position**:
The coordinate a fader moves in, which for an exponential parameter is not its wire value.
`positionToWire` and `wireToPosition` convert between the two; a linear parameter's position and
wire value coincide.
_Avoid_: slider value, UI value, display value

**Dump**:
The device's report of all 256 values, in one SysEx message. It is the only way values ever travel
from the device to the app, and receiving one is what "connected" means.
_Avoid_: snapshot, sync, state message

**Bank**:
One of the twelve slots of the device's flash, holding a complete sound. The device is always in
one; the app can save into the current bank and reset it, but can never navigate between them —
that belongs to the physical buttons.
_Avoid_: preset, patch, program, slot

**Fiction address**:
One of addresses 2–6, where the store deliberately holds a constant (50, 50, 512, 512, 512) instead
of the device's value, so the physical knobs do not fight the UI. They are not a mirror of the
device and are excluded from every comparison. Note they are five, while the `hidden` group is six:
address 7, the firmware version, is hidden but is a true value, not a fiction.
_Avoid_: hidden address, pot address, fake value

**Reference**:
The last state known to have been _loaded_ — captured on the session's first dump, on a dump whose
bank id changed, and on a dump following a save or reset the app issued. It is what "unsaved"
compares against, and what a revert re-sends.
_Avoid_: baseline, saved state, last known good, snapshot

**Preset code**:
A shareable sound as base64 of `v0;v1;…;v254;`. It is a transport format between people, not a
storage location — a bank is where a sound lives, a preset code is how it travels.
_Avoid_: preset (bare), patch, share string

**Neutralisation**:
The act of forcing the five fiction addresses to their constants on every incoming dump.
_Avoid_: normalisation, sanitising, override

### Divergence

**Divergence**:
The umbrella term for a parameter's value differing from a reference value. There are two species,
independent of each other, shown at three magnifications: two LEDs per control, a count per plate,
and the dock.
_Avoid_: dirty, diff, delta, drift

**Unsaved**:
The amber species: this value differs from the **reference**. It is what the dock lists, what plate
counts count, and what a save clears.
_Avoid_: edited, changed, modified, dirty, `changedFromStoredBank`

**Off default**:
The blue species: this value differs from the parameter's factory `default_value`. It has no
aggregate and no bulk action — a freshly saved bank is unsaved-dark and off-default-lit all over.
_Avoid_: non-default, customised, `differsFromDefault`

**Dock**:
The list of every parameter currently unsaved, each with a revert and a link that switches section,
unfolds the plate and moves focus onto the control. It observes a difference between two states; it
holds nothing pending, because the store is optimistic and every edit is already on the device.
_Avoid_: edit buffer, pending changes, changelist, undo stack, staging area

**Revert**:
Re-sending the reference for one parameter or for all of them. It is the gesture opposite to saving
and touches no flash. There is no undo.
_Avoid_: undo, rollback, discard, restore

### The panel

**Panel**:
The editing surface: the whole app below the strip, once a dump has landed.
_Avoid_: editor, form, main view

**Section**:
One of the three top-level partitions — global, harp, chord — drawn as tabs, with exactly one
mounted at a time.
_Avoid_: tab, page, category

**Group**:
The `group` field of a parameter, the subcategory a plate is built from. Groups are merged by name,
because `group` is not contiguous in `parameters.json`.
_Avoid_: category, subsection, family

**Plate**:
One collapsible card holding one group within a section. A folded plate still reports how many of
its parameters are unsaved.
_Avoid_: card, panel, accordion, section, fieldset

**Control**:
The on-screen thing that edits one parameter, whatever its kind.
_Avoid_: widget, input, field

**Kind**:
Which of six shapes a control is drawn as — `toggle`, `select`, `stepper`, `slider`, `picker`,
`sequencer` — derived client-side by rule, since `parameters.json` carries no such notion.
_Avoid_: type, variant, control type

**Binding**:
The one component per parameter that reads the store and feeds a control. It is the only place in
`ui/` that touches state for a parameter.
_Avoid_: container, wrapper, connected component

**Picker**:
A control whose value is the SysEx address of another parameter — which one a physical knob drives.
Its targets are listed by name, and its default sits outside its own declared minimum.
_Avoid_: knob assignment, mapping, routing selector

**Readout**:
The single strip in the panel header that explains the control under the pointer or under keyboard
focus. It is where every tooltip lands; there are no hover bubbles.
_Avoid_: tooltip, hint, status bar, help text

**Unequipped slot**:
How a parameter newer than the connected firmware is drawn: it keeps its place, the cap goes dead,
and the readout says why. It is a slot with nothing fitted in it, not a dimmed row.
_Avoid_: disabled control, greyed out, inactive

**Maintenance area**:
The region of the panel, away from the editing row, holding wipe memory and the preset code import
and export.
_Avoid_: settings, advanced, danger zone

### Connecting

**Gate**:
The connection screen shown before the first dump. It is the only place the app asks for MIDI
access.
_Avoid_: splash, login, onboarding, connect screen

**Strip**:
The single top-bar line where the app speaks about the device: port, firmware version, bank number
and hue, and everything the app has to say on its own initiative.
_Avoid_: header, toolbar, status bar, notification area

**Probe**:
Sending `(0, 0)` to a candidate port and waiting one second for a dump. The name filters the ports;
the probe decides which one is the device.
_Avoid_: handshake, ping, detection

**Moulding**:
One of the two complete token sets the panel is built from — dark plastic with a negative LCD, or
cream plastic with a positive one. They are two different objects sharing no tokens, chosen by
`prefers-color-scheme` alone.
_Avoid_: theme, skin, dark mode, palette, colour scheme

**Bank hue**:
The live value of address 20, the bank's identity. It reaches exactly one element, the bank LED in
the strip, and never the moulding.
_Avoid_: accent colour, theme colour, brand colour

### The sequencer

**Sequencer**:
The rhythm grid at addresses 220–235, sixteen steps across by seven rows down, drawn as one control
on a full-width plate.
_Avoid_: rhythm grid, drum machine, pattern editor

**Step**:
One column of the sequencer, which is one parameter at one address holding a 7-bit mask.
_Avoid_: column, beat, tick

**Cell**:
One square of the grid: one bit of one step.
_Avoid_: bit (in UI prose), pad, square

**Note** and **voice**:
What a row plays and what it borrows. Bit `i` is chord note `i + 1`, on voice `i + 1` for the first
four and `i - 2` for the last three.
_Avoid_: track, lane, channel

**Out of cycle**:
A step past `cycle length` — never reached by the firmware, drawn as such, and still editable, so
that shortening the cycle destroys nothing.
_Avoid_: inactive, disabled, unused

## Spelling in the data contract

The domain carries two misspellings that are part of the data, not mistakes to fix:

- **`adress`** (single `d`) is the key in `parameters.json`, in the firmware and in the legacy HTML
  attributes.
- **`Rythm`** is the name of a chord group in `parameters.json`, and therefore of the plate built
  from it.

Keep both exactly where they are load-bearing. Use `address` and `rhythm` in new code and in prose.
