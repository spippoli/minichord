/**
 * Which of the two mouldings the panel is cast in (SPEC.md 7.4).
 *
 * **`prefers-color-scheme` alone chooses it** — not a theme toggle, and not
 * `localStorage`. Which panel you want is the light in the room and the OS
 * already knows it; the legacy's stored toggle predates that signal being
 * reliable.
 *
 * The media query is *subscribed to* rather than merely read, so the panel
 * re-moulds when the OS flips, without a reload. A bare `@media` block in the
 * stylesheet would re-mould live too — but then the moulding would exist only
 * inside CSS, and the root would have nothing to name it by. The attribute this
 * feeds is what the two token sets are keyed on, and what a test can read.
 *
 * Nothing here touches the DOM: it takes the media query list as an argument,
 * which is what lets the whole rule be driven from a plain object in a test.
 */

/** The two mouldings. There is no third, and no "system" in between. */
export type Moulding = "light" | "dark";

/** The one signal. Dark is the query because light is the absence of it. */
export const DARK_MOULDING_QUERY = "(prefers-color-scheme: dark)";

/** As much of a `MediaQueryList` as the moulding rule actually reads. */
export type MouldingMedia = {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};

/** The moulding the OS is asking for, right now. */
export function mouldingOf(media: { readonly matches: boolean }): Moulding {
  return media.matches ? "dark" : "light";
}

/**
 * Subscribe to the OS changing its mind. Returns the unsubscribe.
 *
 * The listener is called on every flip and is handed nothing: the caller reads
 * `mouldingOf` afterwards, so there is one place the current moulding is
 * derived and no chance of a stale value travelling with the notification.
 */
export function observeMoulding(
  media: MouldingMedia,
  onChange: () => void,
): () => void {
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
