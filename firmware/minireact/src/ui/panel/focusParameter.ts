/**
 * Moving the focus onto a control belongs to the panel, never to the control
 * (SPEC.md 6.1, invariant 6).
 *
 * It carries a great deal of behaviour behind a signature of one argument: it
 * switches section, unfolds the plate, **waits for React to commit**, finds the
 * control and moves the focus. Its callers — the dock's jump link, `Ctrl+K`
 * then `Tab`, and the tab-stop contract of the invariant — learn none of that.
 *
 * The mechanism underneath is a `data-` attribute carrying the address plus a
 * DOM query after the commit, and it is forced rather than chosen: the request
 * is made while the control is **not yet mounted**, which is what rules out a
 * registry keyed on mount.
 *
 * Today there is no section to switch and no plate to unfold — the panel is one
 * flat list — so `reveal` is where those two land, in front of the same wait.
 * The post-commit query exists now because a caller that learns it later has
 * already been written against a function that "finds nothing", which is
 * exactly the failure the invariant is worded against.
 */

const PARAMETER_ATTRIBUTE = "data-parameter-address";

/** What a control puts on its body so the panel can find it again. */
export function parameterAnchor(address: number): Record<string, number> {
  return { [PARAMETER_ATTRIBUTE]: address };
}

/**
 * Bring the control's section and plate on screen. A no-op until there are any
 * (SPEC.md 7.2), and the reason this function is not simply `querySelector`.
 */
function reveal(_address: number): void {}

/** After React has committed whatever `reveal` asked for. */
function afterCommit(act: () => void): void {
  requestAnimationFrame(act);
}

export function focusParameter(address: number): void {
  reveal(address);
  afterCommit(() => {
    const control = document.querySelector<HTMLElement>(
      `[${PARAMETER_ATTRIBUTE}="${address}"]`,
    );
    control?.focus();
  });
}
