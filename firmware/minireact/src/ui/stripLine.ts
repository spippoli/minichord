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
 * The lines this file does not yet produce — a bank change, a save, a preset
 * import — arrive with the tickets that raise them, as further cases of the
 * same notice.
 */

/** SPEC.md A.3: the wire is gone, and the edits are on screen and stuck there. */
const INTERRUPTED =
  "Disconnected — waiting for the minichord to come back. Your edits are on screen but cannot be sent.";

/**
 * `{k}` is always a count, and the singular is spelled out (SPEC.md A.3).
 *
 * "1 unsaved changes" is the kind of thing a machine says, in the one line
 * whose whole job is to be believed about something that was just lost.
 */
function count(k: number, singular: string, plural: string): string {
  return `${k} ${k === 1 ? singular : plural}`;
}

export function stripLine(state: AppState): string {
  const { connection, parameters } = state;

  if (connection.status === "interrupted") return INTERRUPTED;

  const notice = parameters.lastLossNotice;
  if (notice) {
    const bank = bankNumber(notice.bank);
    // Nothing lost is not a smaller version of the loss line: it is the good
    // news it would otherwise be mistaken for, said plainly.
    return notice.lost === 0
      ? `Reconnected — bank ${bank}.`
      : `Reconnected on bank ${bank}. The minichord restarted and reloaded from flash, so ${count(notice.lost, "unsaved change is", "unsaved changes are")} gone.`;
  }

  const bank = bankNumber(parameters.values?.[BANK_ADDRESS] ?? 0);
  return `${connection.port?.name ?? ""} · firmware ${firmwareVersion(parameters)} · bank ${bank}`;
}
