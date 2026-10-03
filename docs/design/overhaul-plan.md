# Visual World Overhaul — plan (2026-10-02)

> Authority: user directive 2026-10-02 + answers to 4 questions.
> Status: **approved, executing**. Reviewers still owed: §8#1 (tokens touch every
> surface) and §8#6 (AGENTS.md constitution amendment) — approved verbally by the
> project owner in this session; recorded in `worklog.md`.
> Predecessor research: [`figma-schemes.md`](./figma-schemes.md),
> [`material-modes.md`](./material-modes.md).

---

## 0. What was decided (and by whom)

| Decision | Answer | Source |
|---|---|---|
| Palette hexes | **Derived** from each Figma scheme's documented colour families, then contrast-verified (the article ships no hex values — 0 hex matches in the capture) | user |
| Brand | **Full replacement.** The cosmic indigo→violet canvas and the 8 existing palettes are removed. AGENTS Rule 5 + `13_UI_Guidelines.md` are amended to the new world | user |
| Admin page | Real ops console on the product site: subscriptions (monthly/quarterly/annual, all prepaid), entitlement grants, infrastructure access control, data-export requests, reminder policy, audit log | user |
| Platform scope | **Both** — platform-neutral tokens now **and** mobile/desktop consumption (user lifts the §9.3 platform lock for this token wave) | user |
| Product-page role | Front door: marketing + access request. Apps do login. Payments are manual; admin contracts the subscription and provisions access | user |
| Search | **One** fzf-style fuzzy engine, local DB only, no online path | user |
| Materials | Three modes: **Minimal**, **Acrylic**, **Liquid Glass** | user |
| Bar | Impeccable score ≥ 90/100 | user |

**Consequence accepted:** the Vibrant Glass identity (13_UI_Guidelines) and AGENTS
Rule 5 are retired. Rule 5's *intent* survives — no generic-SaaS blue — as
"accents come from the palette's declared accent role; indigo/blue may appear
only as canvas neutrals, never as the single primary accent".

---

## 1. The 20 palettes

From `figma-schemes.md` §2–§3 (shortlist + distinctness analysis). 10 dark + 10
light, each mapped to its Figma scheme number so the derivation is auditable.

**Dark:** 51 Inked · 52 Wraith · 24 Lapis velvet evening · 12 Yacht club ·
13 Amber walnut morning · 17 Honey opal sunset · 19 Rose quartz evening ·
15 Cocoa topaz noonday · 36 Amethyst mint harmony · 33 Royal glimmer

**Light:** 1 Ink wash · 32 Frosted aura · 49 Slate · 47 Lemon granite morning ·
2 Neutral elegance · 11 Frozen mist · 28 Amethyst dawn haze ·
16 Sandstone aquamarine serenity · 26 Emerald lavender lake ·
5 Driftwood pearl morning

Collisions resolved by the documented rule (ground temperature + saturation tier,
not hue alone) — the four retained green/yellow/brown pairs are de-duplicated on
*role*, which is what a token system needs.

---

## 2. Token architecture

### 2.1 One canonical semantic set (replaces 129 ad-hoc vars)

`globals.css` currently defines 129 custom properties across five overlapping
families (`--accent-*`, `--color-accent-*`, `--text-primary`, `--color-text-primary`,
`--foreground`, …). The new system is **one** set, generated:

```
canvas · surface-raised · surface-inset · surface-row · surface-sunken
surface-overlay(+solid) · surface-sheet(+solid) · surface-nav(+solid) · surface-scrim
border-default · border-strong · border-accent · border-focus
text-primary · text-secondary · text-muted · text-inverse
accent-primary · accent-success · accent-info · accent-warning · accent-danger
status-paid · status-partial · status-unpaid · status-overdue
chart-1 … chart-6
+ material layer: mat-blur · mat-saturate · mat-tint · mat-specular · mat-fresnel · shadow-overlay · shadow-sheet
```

### 2.2 Source of truth and emission

`packages/design-system/` is the new package that does not exist yet.

```
packages/design-system/
  src/schemes.ts      # 20 palettes: hue anchor, temperature, accent role, Figma provenance
  src/oklch.ts        # OKLCH → sRGB conversion + WCAG contrast (no deps)
  src/tokens.ts       # ramp generation + semantic role assignment
  src/material.ts     # 3 material modes × per-palette chrome overrides
  src/index.ts
  tokens.json         # EMITTED — platform-neutral, consumed by every platform
  scripts/verify-tokens.mjs   # EMITTED — CI gate: contrast + naming + uniqueness
```

`tokens.json` is the platform contract. `apps/web` consumes it through
`tokens.css`; NativeWind, Tauri, Swift and WinUI map the same names (W5).

### 2.3 Derivation method (deterministic, not hand-picked)

1. Each scheme declares a hue anchor + temperature + accent hue from the Figma
   description.
2. Surfaces are generated as an OKLCH lightness ramp at low chroma (so 10
   palettes are perceptually even and none is muddier than another).
3. The accent is placed at the L*/C that clears **4.5:1 on its own canvas** —
   computed, not eyeballed.
4. `verify-tokens.mjs` fails the build if any text role < 4.5:1, any
   meaning-carrying border < 3:1, or two palettes collapse to the same
   3-digit hex.

### 2.4 Material modes

Per `material-modes.md`: `minimal` (opaque, `--mat-blur: 0`) ·
`acrylic` (blur 40px, saturate 125%, tint 15%) · `liquid-glass` (blur 48px,
saturate 150%, Fresnel + specular double-inset). Two invariants are law:

- **`--text-*` and `--accent-*` are mode-invariant.** Switching material can
  never change a contrast ratio.
- **Translucent only where layering is real**: overlays, command palette,
  sheets, nav, floating controls. Opaque: tables, ledger rows, forms, dense lists.

Fallsbacks: `@supports (backdrop-filter: blur(1px))`, plus
`prefers-reduced-transparency`, `prefers-contrast: more`, `forced-colors`.

---

## 3. One search, local only

**Reality today:** three entry points, two engines — a local FTS5 module with zero
callers (`lib/search/searchStudentsFts.ts`), a live gateway `LIKE` search, a
duplicate inline box on Students, and a shell "Find a student…" box.

**Target:**

- `packages/shared/src/fuzzy.ts` — fzf-style: Smith-Waterman DP with fzf's
  bonuses (boundary / camel / consecutive / first-char multiplier), the extended
  search syntax fzf documents (`^prefix`, `suffix$`, `'exact`, `'boundary'`,
  `!inverse`, `|` as OR), deterministic tie-break, and **match indices returned**
  for highlighting. Verified against `junegunn/fzf` `algo.go` constants.
- Local candidates only: the tutor's own DB through the ORM shim, bounded and
  cached. **No gateway call while typing.** (P5 offline-first; Rule 2.)
- One combobox, keyboard-first: ↑↓ move, Enter select, Esc clear, `aria-activedescendant`,
  live match count, inline highlight of matched characters, explicit empty state.
- The shell's Ctrl+K palette reuses the same engine and the same candidate source.
- **Delete** `searchStudentsFts.ts`, the FTS virtual-table creation in
  `admin.ts`, and its L6 allowlist entry.

---

## 4. Product page (Persuade) + `/admin` (Operate)

### 4.1 Front door
Existing 3D product page (the narrative journey) stays and is restyled onto the
tokens. Added routes: `/pricing` (plans × billing period, **no checkout** —
"Request access" form: plan, period, name, email, institute, note) and
`/platforms`. No invented prices: the price cells are marked placeholders on the
user's replacement list until they set them.

### 4.2 `/admin` — auth-gated ops console
- **Auth:** server-side env allowlist of admin identities + signed, httpOnly,
  secure session cookie; every view and every action audited (`audit_log`).
  No admin UI path ever reads tenant **content**.
- **Subscriptions:** plan (free/…), period (monthly/quarterly/annual), status
  (trialing/active/past-due/cancelled), start/expiry dates. Admin-managed, which
  matches `settings.plan` being server-managed and denylisted in the web app.
- **Entitlements + infrastructure access:** feature flags and backend grants
  (db provisioned, export allowed, storage quota) — infrastructure only.
- **Export requests:** the zip-and-mail flow. Admin sees **metadata only**
  (filename, size, SHA-256, expiry, state). Delivery is a signed, expiring link;
  the artefact is never stored in the app and never rendered in the UI. Temp
  download window is visible to the user in the app.
- **Reminder policy:** gentle → 1 hard → downgrade to free + access removal;
  each transition audited.
- **Audit log:** every admin action, filterable, exportable.

This pass is UI/UX + the auth/audit scaffolding. The entitlement *engine*
(scheduled reminders, DB zipping, mail delivery, downgrade enforcement) is
specified in `docs/design/entitlements-contract.md` and implemented separately —
it is backend work and needs the §8#1 security review.

---

## 5. Web app (Operate)

Restyle all five screens onto the generated tokens; Settings → Appearance gains
palette (20, grouped dark/light) + material mode (3) + density, persisted locally.
Density, tabular numerals, 44px targets, and reduced-motion/contrast handling are
non-negotiable (Rule 10). Glass is not decorative (anti-slop).

---

## 6. Cross-platform tokens (user-approved exception to §9.3)

`tokens.json` → Tailwind 4 preset (`apps/web`) · NativeWind 5 config
(`apps/mobile`) · shared `globals.css` (`apps/desktop` reuses web) · mapping
specs for Swift (iOS Liquid Glass), WinUI (Acrylic/Mica), and macOS vibrancy.
Recorded as a **token-only** exception: no business logic crosses platforms.

---

## 7. Waves

| Wave | Work | Owner | Gate |
|---|---|---|---|
| W0 | design-system package, 20 palettes, 3 materials, verify-tokens, constitution amendments | lead | contrast gate green |
| W1 | fzf engine + search unification + FTS removal | subagent | shared tests green |
| W2 | web 5-screen restyle + Settings → Appearance | lead | tsc/lint/tests |
| W3 | product page restyle + pricing/request-access | subagent | impeccable detect |
| W4 | `/admin` console | subagent | security review queued |
| W5 | platform token mapping (mobile/desktop + specs) | subagent | consumes tokens.json |
| W6 | impeccable audit/critique → ≥90, then polish | lead + subagent | detector + critique score |

W1 ∥ W0. W3 ∥ W2. W4 after W3. W5 ∥ W2. W6 last.

---

## 8. Definition of done

1. 20 palettes × 2 modes? No — **20 palettes (10 dark + 10 light) × 3 materials**,
   all generated, all contrast-verified in CI.
2. Zero references to the retired palettes/canvas tokens anywhere.
3. Exactly one search engine, local, keyboard-first; no FTS5; no gateway call
   while typing.
4. Product page: marketing + pricing + request-access + `/admin`, all on tokens.
5. Mobile/desktop consume `tokens.json`; iOS/Win/macOS mappings written.
6. Impeccable detector clean on changed targets; critique ≥ 90.
7. `pnpm run lint`, `typecheck`, unit + integration, principle-lints, a11y all green.
8. worklog entry with `State:` + resume point; memory updated.