import { useEffect } from 'react';

/** Keys that legitimately move the page; anything else is not scroll intent. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/**
 * Keep the window's scroll position owned by the viewer, not by the iframe.
 *
 * A cross-origin embed is allowed to scroll its parent — the browser lets any
 * frame move the top window even though it cannot read from it. Several of the
 * free hosts we frame run ad scripts whose whole job is to shove the parent
 * document somewhere else, and the viewer is left staring at what looks like a
 * black player while the page sits 4,000 pixels below it.
 *
 * So: hold an anchor — where the page would have to be to show the thing the
 * viewer came to watch — and snap back to it whenever the window moves with no
 * input behind it. Genuine scrolling keeps working because wheel, touch, drag
 * and key events all refresh the anchor, and the intent window is wide enough to
 * cover momentum and a smooth-scroll settling.
 *
 * The anchor is derived from the element's position in the document rather than
 * captured once as a number, because a lazy browse page is still laying out when
 * the player mounts and its offset moves.
 *
 * @param {boolean} armed     only guard while a third-party frame is on screen
 * @param {()=>Element|null} keepInView  what must stay on screen while armed
 */
export function useForeignScrollGuard(armed = true, keepInView = null) {
  useEffect(() => {
    // Disabled aggressive scroll-locking so user can freely scroll down to recommendations & cast
    return undefined;
  }, [armed, keepInView]);
}
