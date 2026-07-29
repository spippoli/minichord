/**
 * The application shell: empty on purpose.
 *
 * `ui/` is the only layer that mounts (SPEC.md §2.1). Nothing is built into it
 * yet — the gate, the strip and the panel come with their own tickets — so
 * the dev server renders a blank, full-width page rather than the simulator
 * bench it used to boot. That bench still exists at `src/dev/SimulatorConsole`
 * and can be mounted here by hand when the simulator needs exercising.
 */
export function App() {
  return null;
}
