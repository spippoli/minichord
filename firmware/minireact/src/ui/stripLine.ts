import { BANK_ADDRESS, bankNumber } from "../domain";
import { firmwareVersion, type AppState } from "../state";

/**
 * What the strip says, as a pure function of what the app holds.
 *
 * The lines are Appendix A.3 verbatim, and they are composed here rather than
 * in the component so that the one thing about them that can be wrong — which
 * line, with which numbers, in which state — is exercised headless, like every
 * other rule the store carries (SPEC.md 2.4, 5.6).
 *
 * **Two lines, not one.** The first says where the connection stands and is
 * always true; the second is what just happened, and there usually is nothing.
 * Folding the notice into the standing line was tried and is wrong: nothing
 * clears a notice but the next dump, so a reconnection would evict the port
 * name, the firmware version and the live bank for the rest of the session —
 * and SPEC.md 9.6 puts the firmware version in the strip precisely because it
 * is the only explanation for an unequipped slot.
 *
 * The one notice this file does not yet produce — the preset import — arrives
 * with the ticket that raises it, as a further case of the ones below.
 */

/** SPEC.md A.3: the wire is gone, and the edits are on screen and stuck there. */
const INTERRUPTED =
  "Disconnected — waiting for the minichord to come back. Your edits are on screen but cannot be sent.";

/** Where the connection stands: the line that is always true (SPEC.md A.3). */
export function stripLine(state: AppState): string {
  const { connection, parameters } = state;
  if (connection.status === "interrupted") return INTERRUPTED;

  const bank = bankNumber(parameters.values?.[BANK_ADDRESS] ?? 0);
  return `${connection.port?.name ?? ""} · firmware ${firmwareVersion(parameters)} · bank ${bank}`;
}

/**
 * What just happened to the device, or `null` — nearly always `null`.
 *
 * It is stated once and stands until the next dump replaces it. While the wire
 * is out it says nothing: the standing line above is already saying the thing
 * that matters, and a reconnection notice next to "Disconnected" would be the
 * app contradicting itself.
 */
export function stripNotice(state: AppState): string | null {
  const notice = state.parameters.lastLossNotice;
  if (!notice || state.connection.status === "interrupted") return null;

  switch (notice.kind) {
    case "reconnected": {
      const bank = bankNumber(notice.bank);
      // Nothing lost is not a smaller version of the loss line: it is the good
      // news the loss line would otherwise be mistaken for, said plainly.
      if (notice.lost === 0) return `Reconnected — bank ${bank}.`;
      return `Reconnected on bank ${bank}. The minichord restarted and reloaded from flash, so ${unsavedChanges(notice.lost)} gone.`;
    }

    // A bank change only ever speaks about what it cost: the store raises this
    // with nothing lost never at all, because the number and the hue beside
    // this line have already said that the bank changed (SPEC.md 10.5).
    case "bank-changed":
      return `Bank ${bankNumber(notice.bank)} loaded — ${unsavedChangesLost(notice.lost)}.`;

    // The acknowledgement a ~165 ms round trip is owed (SPEC.md 10.2), and the
    // only one there is: a save asks nothing before acting, so this line is the
    // whole of the conversation.
    case "saved":
      return `Saved to bank ${bankNumber(notice.bank)}.`;

    case "reset":
      return `Bank ${bankNumber(notice.bank)} reset to factory.`;

    case "wiped":
      return "All banks reset to factory.";
  }
}

/**
 * `{k}` is always a count, and the singular is spelled out (SPEC.md A.3).
 *
 * "1 unsaved changes are gone" is the kind of thing a machine says, in the one
 * line whose whole job is to be believed about something that was just lost.
 */
function unsavedChanges(k: number): string {
  return k === 1 ? "1 unsaved change is" : `${k} unsaved changes are`;
}

/** The same count, in the sentence a bank change makes of it (SPEC.md A.3). */
function unsavedChangesLost(k: number): string {
  return k === 1 ? "1 unsaved change lost" : `${k} unsaved changes lost`;
}
