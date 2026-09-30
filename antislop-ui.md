# antislop-ui.md — UI / visual

Load with `antislop.md` (core) for any UI or visual task in `apps/web`,
`packages/ui`, or the product page. The core holds the mechanism (purpose
test, three tiers, Delivery Gate); this file holds the UI-specific checks.

**Source.** Distilled from `git show 91d7a7f:antislop-ui.md` (anti-slop
v2.4.0, rules R-XX) and re-cited to `13_UI_Guidelines.md` and AGENTS §2/§14.

## Hard Gate (UI) — any FAIL blocks delivery

- [ ] **Tokens only.** No raw hex or `rgba()` in components; colour comes
      from the token table (`13_UI_Guidelines.md` §2.1) — AGENTS §14 check 4.
- [ ] **No indigo/blue accents.** Primary accents come from the
      bioluminescent map (emerald, cyan, flare, amber, violet); the
      indigo→violet canvas is background, not accent (AGENTS Rule 5, AP-6;
      lint `no-indigo-accent`).
- [ ] **The four prohibitions hold** (`13_UI_Guidelines.md` §1.3): no
      gradients-as-identity, no default blue-purple treatment, no
      glass-on-glass stacking (§5.3), no rainbow palette.
- [ ] **Three states** on every data surface: empty, loading, error (R-27;
      P15 Honest Empty States).
- [ ] **Sticky footer** on every web screen — root layout `min-h-screen
      flex flex-col`, footer `mt-auto` (AGENTS §6.3, `13_UI_Guidelines.md` §13).
- [ ] **Five screens only** — new capability ships inside an existing
      screen as sub-screen, drawer, or modal (AGENTS Rule 4, P2).
- [ ] **Reduced motion honoured** by every animation and transition
      (`13_UI_Guidelines.md` §7.2, AP-20).
- [ ] **Colour never the only status signal** — icon or text alongside
      (AP-14; lint `no-color-only-status`).

## Purpose-Gate (UI) — write the reason (core §6)

- **Glass** — correct tier for the surface: `glass` cards, `glass-strong`
  modals, `glass-faint` zebra rows (`13_UI_Guidelines.md` §5.2). Dose cap:
  blur on ≤1–2 elements, never navbar + cards + modals + sidebar together
  (R-10).
- **Neumorphism** — controls only, never surfaces: buttons, toggles, and
  inputs use `neumo-raised` / `neumo-inset` / `neumo-pressed`
  (`13_UI_Guidelines.md` §6.6).
- **Gradient or background texture** — only with a hierarchy or identity
  reason written down (R-01, R-07). Default blue→purple = FAIL.
- **Shadow / glow** — elevation markers, not defaults: ≤1–2 elevated
  elements, ≤1–2 glowing elements, never everything at once (R-12, R-13).
- **Radius** — from the design system; pill-everything is a FAIL (R-11).
- **Icons** — relevant to their content; no sparkle/star/magic/orb
  defaults (R-04); no decorative `→` on every button (R-08).
- **Badges** — functional status only, never "AI Powered/Beta/New" filler
  (R-09).
- **Motion** — from the motion tokens (`13_UI_Guidelines.md` §7.1) with a
  stated UX purpose; fade-up-on-everything is a FAIL (R-19).
- **Layout rhythm** — sections vary with the declared RHYTHM dial; no
  centred-title-plus-identical-card-grid on every section (R-05, R-14).

## Quality Locks (UI)

- [ ] Spacing on the 4px base scale (`13_UI_Guidelines.md` §4.1); type from
      the ramp (§3.2) — never ad-hoc sizes.
- [ ] Touch targets ≥ 44×44px everywhere (Rule 10; §10.2).
- [ ] One focal point per screen, one deliberate accent, structural
      whitespace (core §7).
- [ ] Not a clone of Linear/Vercel/Stripe/Notion unless explicitly asked
      (R-30); logo-swap test passes (core §3).
- [ ] Empty states teach: copy + primary CTA + what the screen will do
      (P15).

## Verify (UI)

`pnpm run lint` + `pnpm run typecheck`; Agent Browser: the screen renders,
the primary interaction works, the sticky footer behaves (AGENTS §16.4);
axe-core zero critical or serious violations (AGENTS §16.3). Then run the
core Delivery Gate (core §9) and report PASS/FAIL with the deliverable.
