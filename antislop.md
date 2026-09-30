# antislop.md — core

The anti-slop enforcement checklist for UI, copy, and people work. Read
`AGENTS.md` first; this file governs HOW work is produced, never WHAT the
product is. Direction comes from `13_UI_Guidelines.md` (design system) and
`01_Product_Principles.md` (tone, honesty, principles).

**Source.** Distilled from the historical `antislop.md` recovered via
`git show 91d7a7f:antislop.md` (anti-slop v2.4.0 — rules R-01..R-38, the
three tiers, the Delivery Gate), cross-checked against the `impeccable` skill
(`.agents/skills/impeccable/SKILL.md`) named as the stand-in in
`reviews/verification-production-readiness-report-2026-09-29.md` F-8. Rule
numbers (R-XX) below refer to that historical core; the Buddysaradhi spec
citations are the authority in this repo.

**Siblings.** Load with the core: UI/visual → `antislop-ui.md`; copy/text →
`antislop-copywriting.md`; people/accessibility → `antislop-human.md`.

## 1. Before starting — ask the user

Ask (in the user's chat language) before any UI or copy work starts. Do not
begin until answered:

> When should antislop apply — DURING the work (rules applied as I write), or
> AFTER it is done (numbered audit of what exists, you pick findings, I fix)?

- **During:** apply the rules while generating; end with the Delivery Gate.
- **After:** write findings to `anti-slop/audit-NNN-YYYY-MM-DD.md`, one
  numbered finding per violated rule (R-XX), priority by tier (Hard Gate =
  high, Purpose-Gate = medium, Quality Locks = low). Change nothing until the
  user approves specific numbers; unapproved numbers are never touched.

## 2. What this is, and is not

- A **filter, not a beautifier**. It removes technique-without-purpose; it
  never invents style. Direction = `13_UI_Guidelines.md` +
  `01_Product_Principles.md`, not this file.
- It does not ban techniques (gradients, glass, badges, motion). It bans
  technique used as a default with no written reason (R-01, R-31).
- Removing slop leaves a void: a sterile, lifeless "safe default" is also a
  FAIL (R-37). If direction is missing, say so and label the output a draft.

## 3. The purpose test (keystone, R-31)

Before any visual or copy decision ships, write a one-line reason: why this
colour, layout, type, spacing, icon, animation, sentence. If the reason
cannot be written in one line, revisit the decision. "It looks safe" or
"it is the AI default" is not a reason.

Identity swap test (R-20): if the logo and product name were swapped out,
would this still feel like Buddysaradhi? If no → it is generic → start over.

## 4. The three tiers

| Tier | Meaning | Failure |
| --- | --- | --- |
| **Hard Gate** | absolute: honesty, function, accessibility | FAIL regardless of purpose |
| **Purpose-Gate** | technique allowed; written reason + dose cap required | FAIL when default or unreasoned |
| **Quality Locks** | consistency: rhythm, radius, palette, voice | FAIL when template-driven |

## 5. Hard Gate (absolute)

Any failure blocks delivery — fix first (AGENTS Rule 9 and Rule 10 apply):

1. **No fabricated content.** No invented statistics, testimonials,
   security/compliance claims, names, or ghost links. Real source, or an
   honest labelled placeholder (`[REAL DATA]`, "Coming soon")
   (R-17/R-18/R-36/R-38; `01_Product_Principles.md` P15 and §Marketing:
   copy that cannot trace to a principle is a bug).
2. **No dead controls.** Every button, link, and nav item does something
   real, or is removed or visibly labelled "Coming soon" (R-26, R-24).
3. **Three states always.** Every data view ships empty, loading, and error
   states, each informative (R-27; P15 Honest Empty States).
4. **Keyboard operable.** Tab/Enter/Space/Escape work; visible focus;
   never `outline: none` without a replacement (R-32; Rule 10,
   `13_UI_Guidelines.md` §10).
5. **Contrast AA.** 4.5:1 normal text, 3:1 large text; compute, never
   eyeball (R-25; WCAG 2.1 AA → `antislop-human.md`).
6. **Mobile holds.** No horizontal overflow, no clipped cards; targets
   ≥ 44×44px (R-03; Rule 10, `13_UI_Guidelines.md` §10.2).
7. **Colour never the only signal.** Pair every status colour with an icon
   or text (AP-14; lint `no-color-only-status`).
8. **No patch scripts.** Features are written in source, never
   string-patched into `.css`/`.tsx` by an external script (R-33).
9. **Verify before you deliver.** Run the app, exercise every control,
   check the console, test both themes and breakpoints (R-35; AGENTS §16).

## 6. Purpose-Gate (allowed with a reason)

Gradients, glassmorphism, glow, shadows, radius, icons, badges, arrows,
motion, and background texture are allowed only when the reason is written
and the dose cap holds (R-01, R-04, R-06..R-14, R-19, R-22). In this repo
the reason is usually a spec line: glass tier (`13_UI_Guidelines.md` §5.2),
neumorphic control (§6.6), accent from the bioluminescent map (§2.1,
AGENTS Rule 5). Hard caps: blur on ≤1–2 elements; glow on ≤1–2 elements;
never every surface elevated at once.

## 7. Liveliness (required, not optional)

Declare the dials before building and hold them end to end: `ENERGY 1|2|3`,
`RHYTHM 1|2|3`, `MOTION 1|2|3` (calm → bold). A clean but uniform page with
no focal point FAILS. Required every screen: one clear focal point,
structural whitespace, exactly one deliberate accent, one identity motif
(core Part 3, historical). The repo's identity motif is already specified:
cosmic indigo→violet canvas + glass + bioluminescent accents
(`13_UI_Guidelines.md` §1).

## 8. Quality Locks

- No template layouts or clones of Linear/Vercel/Stripe/Notion unless
  explicitly asked (R-05, R-30).
- No pill-everything radius (R-11); palette ≤2–3 core colours + 1 accent
  (R-29).
- CTAs are specific, never "Get Started"/"Learn More" (R-15); no buzzwords
  (R-16) — see `antislop-copywriting.md`.
- Every major decision's reason is written down (R-31).

## 9. The Delivery Gate (mandatory)

Before delivering UI or copy, output a PASS/FAIL report — one line per
block, every PASS backed by concrete evidence:

1. **Hard Gate** — all nine §5 items pass.
2. **Purpose-Gate** — every technique has its written reason.
3. **Liveliness** — dials declared and followed; focal point, accent, motif.
4. **Craftsmanship** — the Quality Locks, then AGENTS §16:
   `pnpm run lint`, `pnpm run typecheck`, Agent Browser smoke (render +
   primary interaction + sticky footer), axe-core zero critical/serious.

One FAIL = do not deliver. Fix, re-run the gate, then ship. Pair the report
with the `## Spec ref` block required by AGENTS §5.3.
