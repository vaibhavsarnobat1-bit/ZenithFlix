/**
 * Motion system — one vocabulary of springs and variants so every screen moves
 * the same way. Deliberately spring-based (no fixed cubic-bezier easing curves),
 * because springs settle like physical objects instead of "fading in on a loop".
 *
 * Rules used across the app:
 *  · snappy   → things the user touched (buttons, tabs, chips)
 *  · soft     → panels that appear (sheets, drawers, cards)
 *  · ambient  → background/never-ending motion (grain drift, glow pulse)
 *  · entrance → staggered reveals, always y+blur, never plain opacity
 */
import { useReducedMotion } from 'framer-motion';

export const spring = {
  snappy: { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 },
  soft: { type: 'spring', stiffness: 190, damping: 24, mass: 0.9 },
  glassy: { type: 'spring', stiffness: 120, damping: 20 },
  pop: { type: 'spring', stiffness: 620, damping: 26 },
  sheet: { type: 'spring', stiffness: 260, damping: 30 },
};

/** Blur-in entrance: the eye reads this as "coming forward", not "fading". */
export const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: spring.soft },
};

export const fade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.35 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

export const stagger = (delayChildren = 0.04, staggerChildren = 0.055) => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren } },
});

export const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: spring.soft },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16 } },
};

/** Horizontal carousel entry — cards slide in from the scroll direction. */
export const cardIn = {
  hidden: { opacity: 0, x: 28, scale: 0.96 },
  show: { opacity: 1, x: 0, scale: 1, transition: spring.soft },
};

export const sheet = {
  hidden: { opacity: 0, y: '6%', scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring.sheet },
  exit: { opacity: 0, y: '4%', scale: 0.985, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

export const scrim = {
  hidden: { opacity: 0, backdropFilter: 'blur(0px)' },
  show: { opacity: 1, backdropFilter: 'blur(14px)', transition: { duration: 0.32 } },
  exit: { opacity: 0, backdropFilter: 'blur(0px)', transition: { duration: 0.24 } },
};

/** Sliding indicator shared by tab/pill rows (layoutId="pill"). */
export const pill = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: spring.pop },
};

/** Per-letter headline reveal used on the billboard. */
export function splitLetters(text) {
  return Array.from(text).map((ch, i) => ({ ch: ch === ' ' ? '\u00A0' : ch, i }));
}

export const letter = {
  hidden: { opacity: 0, y: 22, rotateX: -45 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: { ...spring.soft, delay: 0.02 * i },
  }),
};

/** Ambient glow — CSS keyframes do the work, framer only mounts it. */
export const ambient = {
  breathe: {
    animate: { scale: [1, 1.06, 1], opacity: [0.45, 0.75, 0.45] },
    transition: { duration: 11, repeat: Infinity, ease: 'easeInOut' },
  },
  drift: {
    animate: { x: [0, 26, -18, 0], y: [0, -18, 12, 0] },
    transition: { duration: 26, repeat: Infinity, ease: 'easeInOut' },
  },
  sweep: {
    animate: { backgroundPosition: ['200% 0', '-200% 0'] },
    transition: { duration: 2.2, repeat: Infinity, ease: 'linear' },
  },
};

/**
 * ── 3D layer ─────────────────────────────────────────────────
 * Everything below is presentation-only depth vocabulary:
 *  · tiltCard  → hover props that lift a card off the screen on the X axis
 *  · press3d   → buttons that get physically pushed in when tapped
 *  · flipIn3d  → panels that swing into view from rotateX (dropdowns, sheets)
 *  · iconPop   → icon micro-animation on interaction
 * No pointer tracking — the tilt is a fixed, keyframed lean, so it stays
 * calm and predictable on every screen.
 */

/** Poster-card hover: leans back slightly and floats upward in z-space. */
export const tiltCard = {
  whileHover: { y: -6, scale: 1.04 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring', stiffness: 320, damping: 24, mass: 0.7 },
};

/** Foreground layer of a 3D card (buttons/badges that sit "on top" of it). */
export const layerUp = { zIndex: 20, transform: 'translateZ(38px)' };

/** Buttons: press down in 3D when clicked, hover lifts them on a ledge. */
export const press3d = {
  whileHover: { y: -2, z: 18, scale: 1.03 },
  whileTap: { y: 1, z: 0, scale: 0.96 },
  style: { transformPerspective: 700 },
  transition: spring.snappy,
};

/** Square icon-button hover: rises with a small dramatic spin-in. */
export const iconOrbit = {
  whileHover: { y: -3, scale: 1.14, rotate: 6 },
  whileTap: { y: 0, scale: 0.86, rotate: -8 },
  style: { transformPerspective: 500 },
  transition: spring.pop,
};

/** Dropdowns / sheets: swing down from a tilted plane. */
export const flipIn3d = {
  hidden: { opacity: 0, rotateX: -10, y: -6, scale: 0.98 },
  show: { opacity: 1, rotateX: 0, y: 0, scale: 1,
          transition: { type: 'spring', stiffness: 260, damping: 24 } },
  exit: { opacity: 0, rotateX: -8, y: -4, scale: 0.98,
          transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } },
};

/** Search-open click: the magnifier does a full 3D barrel-roll flip. */
export const searchFlip = {
  initial: { rotateY: 0 },
  animate: { rotateY: 360, scale: [1, 1.25, 1] },
  transition: { duration: 0.55, ease: [0.3, 1.4, 0.4, 1] },
};

/** 3D entrance for grids — items swing up from below on the X axis. */
export const item3d = {
  hidden: { opacity: 0, y: 20, rotateX: -10, scale: 0.96 },
  show: { opacity: 1, y: 0, rotateX: 0, scale: 1,
          transition: { ...spring.soft, transformPerspective: 800 } },
  exit: { opacity: 0, y: -8, rotateX: 6, transition: { duration: 0.16 } },
};

/** Sheet/modal entrance with a cinematic tilt. */
export const sheet3d = {
  hidden: { opacity: 0, y: '6%', rotateX: 6, scale: 0.95 },
  show: { opacity: 1, y: 0, rotateX: 0, scale: 1, transition: spring.sheet },
  exit: { opacity: 0, y: '4%', rotateX: 4, scale: 0.97,
          transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

/** Ambient float — panels drift gently in z-space so screens never feel dead. */
export const float3d = {
  animate: { y: [0, -7, 0], rotateX: [0, 2.5, 0] },
  transition: { duration: 9, repeat: Infinity, ease: 'easeInOut' },
};

/** Honors OS "reduce motion" — every entrance becomes a plain fade. */
export function useMotionSafe(variants) {
  const reduce = useReducedMotion();
  if (!reduce) return variants;
  return Object.fromEntries(
    Object.entries(variants).map(([k]) => [
      k,
      k === 'hidden' ? { opacity: 0 } : k === 'show' ? { opacity: 1, transition: { duration: 0.2 } } : { opacity: 0, transition: { duration: 0.15 } },
    ])
  );
}
