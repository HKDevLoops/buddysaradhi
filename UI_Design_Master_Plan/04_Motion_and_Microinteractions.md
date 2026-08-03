# 04 — Motion and Microinteractions

> The motion contract for every screen on every platform of **Buddysaradhi TutorOS**. Motion is the *fourth* axis of the design system (after colour, typography, components). Every animation in the app is defined here as a Framer Motion variant; every animation respects the reduced-motion contract.

---

## §1 Motion Philosophy

> **"Every animation expresses a cause-effect relationship, not just decoration."** — Apple Human Interface Guidelines.

A hover scale of 1.02 on a card says "I am tappable". A 250ms fade-in on a modal says "I just opened, here I am". A stagger on a list says "I just loaded N items, in order". Each animation tells the user something they could not learn from a static screenshot.

What animations **do not** do in this system:

- **No continuous pulse on CTAs.** A pulsing "Save" button is decorative noise that distracts from the data. If the Save button needs attention, give it the primary variant and let it be still.
- **No decorative parallax.** A background that scrolls slower than the foreground is decoration; it does not communicate cause-effect. Forbidden.
- **No autoplay video or carousel.** Motion that the user did not trigger is hostile. Carousels rotate only on user action.
- **No blocking input during animation.** A 250ms modal entrance does not disable the rest of the UI. Animations are non-blocking; if an action must block (e.g. during submit), use the button's loading state, not a global overlay.
- **No animating layout properties.** `width`, `height`, `top`, `left`, `margin`, `padding` all trigger reflow on every frame. Animate `transform` and `opacity` only — they are GPU-composited and never reflow.

### The Three Causes That Justify Motion

1. **User action** → button press, hover, drag, focus. The motion is a direct visual echo of what the user just did.
2. **State change** → modal opens, toast arrives, list loads, data updates. The motion tells the user "something just changed in the system".
3. **Spatial navigation** → forward/back page transition, drawer slides in, sheet expands. The motion preserves the user's mental model of where they are in the app's hierarchy.

If a motion does not serve one of those three causes, it is decoration. Decoration is forbidden on app surfaces; allowed (sparingly) on the marketing landing page.

---

## §2 Duration Tokens

> Four tokens, exposed as CSS variables on `:root`. Components reference `var(--motion-<token>)`, never raw `ms` values. The reduced-motion token (`--motion-instant: 0ms`) is the contract that lets the `@media (prefers-reduced-motion: reduce)` block collapse every animation by overriding the other three tokens.

| Token | Duration | Use |
|---|---|---|
| `--motion-instant` | 0ms | Reduced-motion users — every animation collapses to instant state change |
| `--motion-fast` | 150ms | Hover states, button presses, focus rings, tooltips — micro-interactions the user expects to feel "snappy" |
| `--motion-base` | 250ms | Card hovers, modal entrances, toast arrivals, sheet expansions — the default for most UI motion |
| `--motion-slow` | 400ms | Page transitions, large element expansions, multi-step state changes — anything that crosses more than 200px or changes shape significantly |

### CSS Definition

```css
:root {
  --motion-instant: 0ms;
  --motion-fast:    150ms;
  --motion-base:    250ms;
  --motion-slow:    400ms;
}

/* Reduced-motion override: every duration collapses to instant.
   The animation still runs (so transitionend fires, components don't hang),
   but the visual effect is an instant state change. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-fast: 0ms;
    --motion-base: 0ms;
    --motion-slow: 0ms;
  }
}
```

### Why 150 / 250 / 400?

- **150ms** is the threshold below which motion reads as "instant" to most users. Anything shorter feels broken; anything longer feels sluggish on a button press.
- **250ms** is the Apple/Material sweet spot for surface entrances — long enough to perceive the motion, short enough to not delay interaction.
- **400ms** is the upper bound before users start tapping again because they think the app is broken. Anything > 500ms is forbidden (see §8 anti-patterns).
- **0ms** is the reduced-motion collapse — the animation runs (so transitions still fire) but the user sees instant state changes.

---

## §3 Easing Tokens

> Three easing tokens. Every animation in the system uses one of them. Custom `cubic-bezier(...)` curves in component code are a P2 lint violation.

| Token | Curve | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Default — for elements entering the screen (modal, toast, list item). The fast start + slow end feels "natural" because objects in the real world decelerate due to friction. |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | For elements leaving the screen (modal close, toast dismiss). The slow start + fast end feels "expectant" — the element accelerates away. |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | For physics-feeling interactions (drag release, bounce-back). The slight overshoot (1.56 > 1) creates the "settling" feel. |

### CSS Definition

```css
:root {
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:     cubic-bezier(0.7, 0, 0.84, 0);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Linear is used only for continuous loops (spinners, indeterminate progress bars) */
  --ease-linear: linear;
}
```

### Why Not `ease`, `ease-in-out`, `linear`?

- `ease` (the CSS default) is `cubic-bezier(0.25, 0.1, 0.25, 1)` — a generic curve with no character. It feels "default"; we want motion to feel "deliberate".
- `ease-in-out` is symmetric — fine for some cases, but symmetric motion feels mechanical, not physical. Real objects decelerate faster than they accelerate.
- `linear` is forbidden for any non-looping animation — it has no acceleration curve, so it feels robotic. Allowed only for spinners (continuous rotation) and indeterminate progress bars (continuous sweep).

---

## §4 Framer Motion Variants

> Nine variants, exported from `src/lib/motion.ts`. Every component that animates imports from here; nobody writes Framer Motion variants inline.

### `src/lib/motion.ts`

```typescript
// src/lib/motion.ts
import type { Variants, Transition } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// Duration tokens (mirror the CSS tokens in §2)
// ─────────────────────────────────────────────────────────────────────────────
export const DURATION = {
  instant: 0,
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

// Easing tokens (mirror the CSS tokens in §3)
export const EASE = {
  out:    [0.16, 1, 0.3, 1] as const,
  in:     [0.7, 0, 0.84, 0] as const,
  spring: [0.34, 1.56, 0.64, 1] as const,
  linear: 'linear' as const,
};

// The reduced-motion hook — every component that animates must call this.
// When true, durations collapse to 0 and the variants become instant state changes.
// (Framer Motion handles this internally via the MotionConfig + useReducedMotion combo,
//  but we expose the hook so non-Framer code can also check.)
import { useReducedMotion } from 'framer-motion';
export const usePrefersReducedMotion = useReducedMotion;

// ─────────────────────────────────────────────────────────────────────────────
// Variant 1: cardHover
// A 2% scale lift on hover. Says "I am tappable".
// ─────────────────────────────────────────────────────────────────────────────
export const cardHover: Variants = {
  rest:    { scale: 1,    transition: { duration: DURATION.fast, ease: EASE.out } },
  hover:   { scale: 1.02, transition: { duration: DURATION.fast, ease: EASE.out } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 2: buttonPress
// A 3% scale shrink on tap. Says "I registered your tap".
// 100ms is below the 150ms fast threshold because taps must feel instantaneous.
// ─────────────────────────────────────────────────────────────────────────────
export const buttonPress: Variants = {
  rest:    { scale: 1,    transition: { duration: DURATION.fast, ease: EASE.out } },
  pressed: { scale: 0.97, transition: { duration: 0.1,           ease: EASE.out } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 3: modalEnter
// Scale 0.95 + opacity 0 → 1 + translateY 8px. The modal "arrives".
// ─────────────────────────────────────────────────────────────────────────────
export const modalEnter: Variants = {
  hidden:  { opacity: 0, scale: 0.95, y: 8,  transition: { duration: DURATION.base, ease: EASE.out } },
  visible: { opacity: 1, scale: 1,    y: 0,  transition: { duration: DURATION.base, ease: EASE.out } },
  exit:    { opacity: 0, scale: 0.97, y: 4,  transition: { duration: DURATION.fast, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 4: pageTransition
// Fade + slide-x 8px. Forward nav slides left; back nav slides right (see §5).
// 200ms — shorter than modalEnter because page transitions must not delay reading.
// ─────────────────────────────────────────────────────────────────────────────
export const pageTransitionForward: Variants = {
  hidden:  { opacity: 0, x: 8,  transition: { duration: 0.2, ease: EASE.out } },
  visible: { opacity: 1, x: 0,  transition: { duration: 0.2, ease: EASE.out } },
  exit:    { opacity: 0, x: -8, transition: { duration: 0.2, ease: EASE.in } },
};

export const pageTransitionBack: Variants = {
  hidden:  { opacity: 0, x: -8, transition: { duration: 0.2, ease: EASE.out } },
  visible: { opacity: 1, x: 0,  transition: { duration: 0.2, ease: EASE.out } },
  exit:    { opacity: 0, x: 8,  transition: { duration: 0.2, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 5: staggerChildren
// 30ms per item, max 8 items staggered. After 8 items, the rest appear instantly
// (a 200-row table that staggers for 6 seconds is a bug).
// ─────────────────────────────────────────────────────────────────────────────
export const listContainer: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.02,
      // Cap the stagger at 8 items — after that, the rest are instant.
      // (Implemented in the consumer by clamping the array to 8 in the stagger,
      //  then rendering the rest without animation.)
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 6: tooltipEnter
// Opacity 0 → 1, 100ms. Below the fast threshold because tooltips are micro-UI.
// ─────────────────────────────────────────────────────────────────────────────
export const tooltipEnter: Variants = {
  hidden:  { opacity: 0, transition: { duration: 0.1, ease: EASE.out } },
  visible: { opacity: 1, transition: { duration: 0.1, ease: EASE.out } },
  exit:    { opacity: 0, transition: { duration: 0.05, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 7: toastEnter
// Slide-up + fade, 250ms ease-out. Bottom-right on web, top on mobile.
// ─────────────────────────────────────────────────────────────────────────────
export const toastEnter: Variants = {
  hidden:  { opacity: 0, y: 16, transition: { duration: DURATION.base, ease: EASE.out } },
  visible: { opacity: 1, y: 0,  transition: { duration: DURATION.base, ease: EASE.out } },
  exit:    { opacity: 0, y: 8,  transition: { duration: DURATION.fast, ease: EASE.in } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 8: listItemEnter
// Stagger 30ms (driven by parent listContainer), fade + slide-y 4px.
// Smaller slide than modalEnter because list items are smaller visual units.
// ─────────────────────────────────────────────────────────────────────────────
export const listItemEnter: Variants = {
  hidden:  { opacity: 0, y: 4, transition: { duration: DURATION.fast, ease: EASE.out } },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.fast, ease: EASE.out } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant 9: chartDraw
// pathLength 0 → 1, 600ms ease-out. Draws the chart line on first mount ONLY.
// Re-renders due to data updates do NOT re-trigger the draw (would be jarring).
// ─────────────────────────────────────────────────────────────────────────────
export const chartDraw: Variants = {
  hidden:  { pathLength: 0, opacity: 0, transition: { duration: 0.6, ease: EASE.out } },
  visible: { pathLength: 1, opacity: 1, transition: { duration: 0.6, ease: EASE.out } },
};

// Usage in a chart component:
//   const hasMounted = useRef(false);
//   useEffect(() => { hasMounted.current = true; }, []);
//   <motion.path variants={chartDraw} initial="hidden"
//                animate={hasMounted.current ? false : 'visible'} />
// (animate=false on re-render → no re-draw)

// ─────────────────────────────────────────────────────────────────────────────
// Reduced-motion-safe wrappers
// ─────────────────────────────────────────────────────────────────────────────
// Wrap any Framer Motion component in <MotionReduced> to get the
// reduced-motion-safe behavior automatically.
export function withReducedMotion<T extends Variants>(variants: T): T {
  // When useReducedMotion() returns true, the consumer should set transition.duration to 0.
  // This is a marker — the actual collapse happens via the @media query in CSS and
  // the MotionConfig reducedMotion="always" prop at the root.
  return variants;
}
```

### Usage Examples

```tsx
// Card with hover lift
import { motion } from 'framer-motion';
import { cardHover } from '@/lib/motion';

<motion.div
  variants={cardHover}
  initial="rest"
  whileHover="hover"
  whileTap="pressed"
>
  <GlassCard>...</GlassCard>
</motion.div>

// Modal entrance
import { AnimatePresence, motion } from 'framer-motion';
import { modalEnter } from '@/lib/motion';

<AnimatePresence>
  {isOpen && (
    <motion.div
      variants={modalEnter}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <ModalContent>...</ModalContent>
    </motion.div>
  )}
</AnimatePresence>

// List with stagger
import { motion } from 'framer-motion';
import { listContainer, listItemEnter } from '@/lib/motion';

<motion.ul variants={listContainer} initial="hidden" animate="visible">
  {items.slice(0, 8).map(item => (
    <motion.li key={item.id} variants={listItemEnter}>
      <StudentRow student={item} />
    </motion.li>
  ))}
  {/* Items 9+ render without motion to avoid the 6-second-stagger bug */}
  {items.slice(8).map(item => (
    <li key={item.id}><StudentRow student={item} /></li>
  ))}
</motion.ul>
```

---

## §5 Page Transition Model

> Forward navigation slides the new page in from the right (8px x-offset). Back navigation slides it in from the left. Shared element transitions for student-card → student-profile preserve the user's mental model of "the card I tapped became the page".

### Direction-Aware Transitions

```tsx
// app/layout.tsx (or a per-route template)
'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { pageTransitionForward, pageTransitionBack } from '@/lib/motion';
import { useRouter } from 'next/navigation';

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const direction = useRef<'forward' | 'back'>('forward');

  // Detect back navigation via popstate (browser back button)
  useEffect(() => {
    const handler = () => { direction.current = 'back'; };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // Any other navigation is "forward"
  useEffect(() => {
    direction.current = 'forward';
  }, [pathname]);

  const variants = direction.current === 'forward' ? pageTransitionForward : pageTransitionBack;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

### Shared Element Transitions (student-card → student-profile)

When a tutor taps a student card on the Students master list, the card's avatar + name "fly" to the top of the student-profile page. Framer Motion's `layoutId` makes this declarative:

```tsx
// Students master list
<motion.div layoutId={`student-card-${student.id}`}>
  <Avatar photoUrl={student.photo} />
  <Name>{student.name_latin}</Name>
</motion.div>

// Student profile page (after navigation)
<motion.div layoutId={`student-card-${student.id}`}>
  <Avatar photoUrl={student.photo} size="lg" />
  <Name>{student.name_latin}</Name>
</motion.div>
```

Framer Motion animates the avatar's position + size from the master-list layout to the profile-page layout automatically. The user perceives "the card I tapped became the page header" — a strong spatial-continuity cue.

> **Reduced-motion override:** When `useReducedMotion()` returns true, `layoutId` transitions collapse to instant layout swaps (no fly-in). The page still navigates; the user just doesn't see the shared-element animation.

---

## §6 Reduced-Motion Contract

> Users with `prefers-reduced-motion: reduce` (set in OS settings) get instant state changes. No animation, no parallax, no autoplay. The system still *runs* the animations (so `transitionend` events fire and components don't hang), but the visual effect is instant.

### The Three Mechanisms

1. **CSS `@media (prefers-reduced-motion: reduce)`** — collapses all `--motion-*` duration tokens to `0ms`. Affects every CSS transition and animation in the app.
2. **Framer Motion `useReducedMotion()` hook** — JS-side check. When true, components either skip the animation (set `animate={false}`) or use a no-op variant.
3. **`<MotionConfig reducedMotion="user">` at the root** — tells Framer Motion to respect the OS setting globally, so individual components don't need to check.

### CSS Override

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-fast: 0ms;
    --motion-base: 0ms;
    --motion-slow: 0ms;
  }

  /* Disable all animations and transitions explicitly */
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Root MotionConfig

```tsx
// app/layout.tsx
import { MotionConfig } from 'framer-motion';

<MotionConfig reducedMotion="user">
  {/* all app content */}
</MotionConfig>
```

### What Reduced Motion Does NOT Disable

- **Spinner.** A loading spinner is a *status indicator*, not decoration. If it stopped spinning, the user would think the app froze. Keep spinning.
- **Indeterminate progress bar.** Same reason — it's status, not decoration.
- **Focus ring appearance.** Focus rings are essential for keyboard navigation (see `05_Accessibility_Contract.md` §2). They appear instantly regardless of motion setting.

### What Reduced Motion DOES Disable

- All hover/tap scale animations (`cardHover`, `buttonPress`)
- All entrance animations (`modalEnter`, `toastEnter`, `listItemEnter`, `chartDraw`)
- All page transitions (`pageTransitionForward`, `pageTransitionBack`)
- All shared-element transitions (the student-card → student-profile fly-in becomes an instant layout swap)
- All parallax (which is forbidden anyway, but the override ensures any future parallax respects the setting)

### Anti-Patterns Forbidden Under Reduced Motion

- **Parallax** — never allowed, even with motion enabled (see §8)
- **Autoplay video/carousel** — never allowed
- **Continuous pulse on CTAs** — never allowed
- **Decorative-only animations** (e.g. a rotating logo) — collapse to static

---

## §7 Loading States

> Three loading patterns, chosen by expected duration. The wrong pattern (spinner for a 5-second load; skeleton for a 100ms load) is worse than no loading state at all.

### Pattern 1: Skeleton (for >300ms loads)

A skeleton is a greyed-out placeholder matching the final layout's shape. It tells the user "this is what's coming" — preserving layout and preventing the page from jumping when data arrives.

Built on [`boneyard-js`](https://www.npmjs.com/package/boneyard-js) — the verified skeleton library (see worklog Task 11-PLATFORM-SEQUENCING: "boneyard-js@1.8.2 EXISTS").

```tsx
import { Skeleton } from 'boneyard-js';

// Card skeleton — matches KPI card layout
<Skeleton variant="shimmer" width="100%" height={120} borderRadius={16}>
  <Skeleton.Line width="30%" height={14} />
  <Skeleton.Line width="60%" height={48} marginTop={8} />
  <Skeleton.Line width="40%" height={12} marginTop={8} />
</Skeleton>

// Table skeleton — matches data-table row count
{isLoading && (
  <div className="space-y-2">
    {Array.from({ length: 8 }).map((_, i) => (
      <Skeleton key={i} variant="shimmer" height={48} borderRadius={8} />
    ))}
  </div>
)}
```

> **Shimmer vs static:** boneyard-js's `shimmer` variant has a slow diagonal sweep that says "loading in progress". The sweep itself respects reduced-motion (collapses to a static grey under `prefers-reduced-motion: reduce`).

### Pattern 2: Spinner (for <300ms inline loads)

A small spinner replaces the button label or appears next to inline content. Used for instant feedback on user actions (submit, save) where a skeleton would be too heavy.

```tsx
<Button variant="primary" loading={isSubmitting}>
  {isSubmitting ? 'Saving…' : 'Save'}
</Button>
```

The spinner is the `Loader2` icon from `lucide-react` with the `btn-spinner` CSS class (defined in `03_Component_Library.md` §4). It rotates continuously at 0.8s/revolution.

### Pattern 3: Progress Bar (for known-duration uploads)

A determinate progress bar for file uploads, exports, and backups where the system can estimate the remaining time. Built on Radix Progress.

```tsx
<Progress value={uploadProgress} max={100} aria-label="Uploading backup file" />
```

```css
.progress-track {
  height: 8px;
  background: var(--surface-glass-faint);
  border-radius: 999px;
  overflow: hidden;
}
.progress-indicator {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 999px;
  transition: width var(--motion-base) var(--ease-out);  /* smooth width updates */
}
```

> **Width animation exception:** The progress bar is the ONE case where animating `width` is allowed — it represents real-world progress, and the reflow cost is bounded by the bar's small size (8px tall, max 100% wide).

### Loading-State Decision Tree

```
Expected load time?
├─ < 100ms → no loading state (instant render; a flash of skeleton is worse than nothing)
├─ 100-300ms → spinner inline (e.g. button loading state)
├─ 300ms-3s → skeleton matching final layout
└─ > 3s → skeleton + "this is taking longer than usual" message after 3s
```

### LCP Optimization

The largest contentful paint (LCP) on each page should be a real element, not a skeleton. If the LCP element is a skeleton, the LCP metric measures the skeleton's paint — useless. Strategy: preload the LCP data (e.g. Dashboard KPIs) via TanStack Query's `initialData` from the cached previous fetch, so the LCP element renders with real data on first paint.

---

## §8 Anti-Patterns

> Eight motion anti-patterns that fail CI lint. Each has a `no-*` test name and a one-line rationale.

| # | Anti-pattern | Lint rule | Why it's forbidden |
|---|---|---|---|
| 1 | Animating `width`, `height`, `top`, `left`, `margin`, `padding` | `no-animating-layout-props.test.ts` | Triggers layout reflow on every frame — jank on low-end devices. Use `transform` (translate/scale/rotate) and `opacity` only. Exception: the progress bar's `width` (bounded by 8px-tall track). |
| 2 | Duration > 500ms | `no-motion-over-500ms.test.ts` | Users perceive >500ms as "the app is broken". 400ms is the `--motion-slow` ceiling; anything beyond must be a multi-step animation, not a single long one. |
| 3 | Continuous pulse on CTAs | `no-pulsing-cta.test.ts` | Decorative noise that distracts from data. If the CTA needs attention, use the primary variant + a static badge. |
| 4 | Decorative parallax | `no-parallax.test.ts` | Parallax communicates nothing; it costs scroll performance; it triggers motion sickness in some users. Forbidden app-wide. |
| 5 | Blocking input during animation | `no-blocking-input.test.ts` | A 250ms modal entrance must not disable the rest of the UI. Use the modal's own `pointer-events: none` on the trigger, not a global overlay. |
| 6 | All-at-once list reveals (no stagger) | `no-list-without-stagger.test.ts` | A 20-row list appearing simultaneously is disorienting. Use `listContainer` + `listItemEnter` with a 30ms stagger, capped at 8 items. |
| 7 | Stagger > 8 items | `no-stagger-over-8-items.test.ts` | A 200-row table staggering for 6 seconds is a bug. Stagger the first 8 items; render the rest without animation. |
| 8 | Re-triggering `chartDraw` on data update | `no-chart-redraw-on-update.test.ts` | A chart that re-draws its line every time the data updates is jarring. Draw once on first mount; subsequent updates use the `animate` prop set to `false`. |

### The Two Things Motion Must Do

1. **Echo user action.** Tap → button shrinks 3%. Hover → card lifts 2%. Focus → ring appears. The motion is the user's action reflected back at them.
2. **Communicate state change.** Modal opens → fade+scale. Toast arrives → slide+fade. List loads → stagger. The motion tells the user "something just changed".

If a motion does neither, it's decoration. Decoration belongs on the marketing landing page (sparingly), not on the app surfaces. The app surfaces are work tools; their motion is feedback, not flair.

---

## Status

- **Author:** UI/UX Lead (Task 13-FOUNDATION-DOCS)
- **State:** COMPLETED
- **Depends on:** `00_Design_System_Overview.md` §5 (rule 9: motion conveys cause-effect), `03_Component_Library.md` (every component's hover/active state references these tokens)
- **Consumers:** `03_Component_Library.md` (component hover/active durations), `05_Accessibility_Contract.md` §9 (reduced-motion cross-reference), every page mockup
- **Tokens defined:** 4 duration tokens + 4 easing tokens = 8 motion variables
- **Variants defined:** 9 Framer Motion variants (cardHover, buttonPress, modalEnter, pageTransition, staggerChildren, tooltipEnter, toastEnter, listItemEnter, chartDraw)
- **Reduced-motion contract verified:** CSS @media + Framer Motion MotionConfig + useReducedMotion hook — three-layer collapse to instant state changes.
