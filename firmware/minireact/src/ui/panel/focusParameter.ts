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
 * Exactly one panel is mounted at a time (SPEC.md 9.1: the app is the gate or
 * the editor, never both), which is what lets this be one function in a module
 * rather than a context. The disposer only clears what it set, so a remount in
 * either order leaves the live panel holding it.
 *
 * Switching the section and unfolding the plate are the panel's own state, so
 * the panel hands them over through `setParameterReveal` and this module holds
 * one function rather than a context: `focusParameter` is called from places
 * that are not components, and its callers pass one number.
 */

const PARAMETER_ATTRIBUTE = "data-parameter-address";

/** What a control puts on its body so the panel can find it again. */
export function parameterAnchor(address: number): Record<string, number> {
  return { [PARAMETER_ATTRIBUTE]: address };
}

/**
 * Bring the control's section and plate on screen — the reason this function is
 * not simply `querySelector`. It is a no-op with no panel mounted.
 */
let reveal: (address: number) => void = () => {};

/** The panel lends its section and fold state, and takes them back on unmount. */
export function setParameterReveal(
  next: (address: number) => void,
): () => void {
  reveal = next;
  return () => {
    if (reveal === next) reveal = () => {};
  };
}

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
