# antislop-human.md — people & accessibility

Load with `antislop.md` (core) whenever the task builds or edits UI. This
file holds the people-side depth: eyes, hands, keyboards, zoom. Accessibility
is not a bolt-on extra — it is part of "the UI holds up" (core C-4) and of
AGENTS Rule 10.

**Source.** Distilled from `git show 91d7a7f:antislop-human.md` (anti-slop
v2.4.0, rules R-25/R-26/R-27/R-32/R-34/R-35 plus the contrast checker) and
re-cited to `13_UI_Guidelines.md` §10 (Accessibility Commitments) and
AGENTS §2 Rule 10.

## Contrast — compute, never eyeball

- Normal text ≥ 4.5:1; large text (18px+) ≥ 3:1; non-text UI (borders,
  focus rings, chart segments, status chips) ≥ 3:1 (WCAG 2.1 AA §1.4.3 /
  §1.4.11; R-25; Rule 10).
- Formula: `ratio = (L1 + 0.05) / (L2 + 0.05)`, with
  `L = 0.2126·R + 0.7152·G + 0.0722·B` after sRGB linearisation
  (`c ≤ 0.03928 → c/12.92`, else `((c + 0.055)/1.055)^2.4`).
- Reference pairs: black/white 21.0 pass; white on `#333` 12.6 pass;
  white on `#666` 5.7 pass; `#777` on white 4.5 borderline — compute it;
  white on `#888` 3.5 fails normal text; white on `#999` 2.8 fails both;
  **`#555` on black = 2.8 fails** — the classic hallucinated "AA pass";
  never claim a grey pair passes without computing.
- Text over images or gradients: test the WORST spot, not the best. If any
  part of the text area fails, add a scrim or solid block behind the text.

## Keyboard & focus

- [ ] Every interactive element reachable with Tab in visual order and
      operable with Enter/Space; dialogs close with Escape (R-32, R-26;
      Rule 10 keyboard parity).
- [ ] Visible `:focus-visible` indicator on every control, ≥3:1 against
      neighbours, in every theme you ship; `outline: none` only with an
      equally visible replacement (R-32, R-34).
- [ ] No hover-only menus, no mouse-only patterns; source order matches
      visual order (R-32).

## Status & states

- [ ] Colour is never the only signal — pair paid/unpaid, present/absent,
      synced/stale with icon or text (AP-14; lint `no-color-only-status`;
      `13_UI_Guidelines.md` §10.6).
- [ ] Empty, loading, and error states exist AND are perceivable — text,
      not a bare spinner (R-27; P15 Honest Empty States).
- [ ] Error copy says what happened and what to do next (AGENTS Rule 9).

## Touch, zoom, motion

- [ ] All targets ≥ 44×44px (Rule 10; `13_UI_Guidelines.md` §10.2).
- [ ] Text survives 200% zoom with no clipping and no horizontal scroll
      (WCAG 1.4.4; R-35).
- [ ] The mobile keyboard never covers the focused input — scroll into
      view with bottom padding (R-35).
- [ ] Every animation checks `prefers-reduced-motion: reduce` and degrades
      to an instant state change (`13_UI_Guidelines.md` §7.2, AP-20).
- [ ] If a theme toggle ships, BOTH modes work; a broken second mode is a
      defect, not a follow-up (R-34).

## Verify (people)

`pnpm run test:a11y` — axe-core, zero critical or serious violations
(AGENTS §16.3); a keyboard-only pass in Agent Browser (Tab → Enter →
Escape); then the core Delivery Gate (core §9). A failing accessibility
check blocks delivery exactly like a failing lint does.
