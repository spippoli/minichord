/**
 * The name filter, and nothing more.
 *
 * The firmware declares one USB product string, exactly `minichord`, and no
 * per-cable names, so the two cables are named by the operating system:
 * `minichord MIDI 1` on Linux, something like `minichord Port 1` on macOS, and
 * possibly twice the same name on Windows. A name can therefore never decide
 * which cable carries SysEx — only a dump can (SPEC.md 9.3).
 */

/**
 * Whether a port name is worth probing.
 *
 * The filter exists only to bound the blast radius: it keeps us from spraying
 * SysEx at someone else's synth on the same bus. It is deliberately loose, and
 * it is never the thing that decides a port is the control port.
 */
export function isCandidatePort(name: string): boolean {
  return name.toLowerCase().includes("minichord");
}
