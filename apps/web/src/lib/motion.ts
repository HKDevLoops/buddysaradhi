// Implements: UI/04_Motion_and_Microinteractions.md §4 Framer Motion Variants
// Export all motion variants from here. Components import from here ONLY —
// never write Framer Motion variants inline.

import type { Variants } from "framer-motion";
import { useReducedMotion } from "framer-motion";

// Re-export so consumers don't need to import framer-motion directly
export { useReducedMotion as usePrefersReducedMotion };

// ─────────────────────────────────────────────────────────────────────────────
// Duration tokens (mirror CSS tokens in globals.css)
// ─────────────────────────────────────────────────────────────────────────────
export const DURATION = {
  instant: 0,
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

// Easing tokens (mirror CSS tokens in globals.css)
export const EASE = {
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  in: [0.7, 0, 0.84, 0] as [number, number, number, number],
  spring: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  linear: "linear" as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 1: cardHover — 2% scale lift, says "I am tappable"
// ─────────────────────────────────────────────────────────────────────────────
export const cardHover: Variants = {
  rest: { scale: 1, transition: { duration: DURATION.fast, ease: EASE.out } },
  hover: { scale: 1.02, transition: { duration: DURATION.fast, ease: EASE.out } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 2: buttonPress — 3% scale shrink on tap
// ─────────────────────────────────────────────────────────────────────────────
export const buttonPress: Variants = {
  rest: { scale: 1, transition: { duration: DURATION.fast, ease: EASE.out } },
  pressed: { scale: 0.97, transition: { duration: 0.1, ease: EASE.out } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 3: modalEnter — scale + fade, the modal "arrives"
// ─────────────────────────────────────────────────────────────────────────────
export const modalEnter: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 8, transition: { duration: DURATION.base, ease: EASE.out } },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: DURATION.fast, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 4: pageTransition — fade + 8px slide
// ─────────────────────────────────────────────────────────────────────────────
export const pageTransitionForward: Variants = {
  hidden: { opacity: 0, x: 8, transition: { duration: 0.2, ease: EASE.out } },
  visible: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE.out } },
  exit: { opacity: 0, x: -8, transition: { duration: 0.2, ease: EASE.in } },
};

export const pageTransitionBack: Variants = {
  hidden: { opacity: 0, x: -8, transition: { duration: 0.2, ease: EASE.out } },
  visible: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE.out } },
  exit: { opacity: 0, x: 8, transition: { duration: 0.2, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 5: staggerChildren — 30ms per item, capped at 8 items
// ─────────────────────────────────────────────────────────────────────────────
export const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.02,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 6: tooltipEnter — 100ms opacity only (micro-UI)
// ─────────────────────────────────────────────────────────────────────────────
export const tooltipEnter: Variants = {
  hidden: { opacity: 0, transition: { duration: 0.1, ease: EASE.out } },
  visible: { opacity: 1, transition: { duration: 0.1, ease: EASE.out } },
  exit: { opacity: 0, transition: { duration: 0.05, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 7: toastEnter — slide-up + fade
// ─────────────────────────────────────────────────────────────────────────────
export const toastEnter: Variants = {
  hidden: { opacity: 0, y: 16, transition: { duration: DURATION.base, ease: EASE.out } },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } },
  exit: { opacity: 0, y: 8, transition: { duration: DURATION.fast, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 8: listItemEnter — stagger 30ms, fade + slide-y 4px
// ─────────────────────────────────────────────────────────────────────────────
export const listItemEnter: Variants = {
  hidden: { opacity: 0, y: 4, transition: { duration: DURATION.fast, ease: EASE.out } },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.fast, ease: EASE.out } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 9: chartDraw — pathLength 0→1, draws on first mount ONLY
// ─────────────────────────────────────────────────────────────────────────────
export const chartDraw: Variants = {
  hidden: { pathLength: 0, opacity: 0, transition: { duration: 0.6, ease: EASE.out } },
  visible: { pathLength: 1, opacity: 1, transition: { duration: 0.6, ease: EASE.out } },
};

// Usage: pass animate={hasMounted.current ? false : 'visible'} to avoid re-draw on data updates
