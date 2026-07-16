# Security & Constitution Review

**Scope:** Recent palette/theme + responsiveness changes to `apps/web`
**Constitution:** `AGENTS.md` §2 (10 Non-Negotiable Rules) + `13_UI_Guidelines.md`

## Summary

| Check | Result |
|---|---|
| Rule 5 — No indigo/blue accents | ✅ PASS |
| Rules 2/3 — No telemetry / client network calls | ✅ PASS |
| Rule 6 — Integer paise (no float money) | ✅ PASS (UI-only) |
| Rule 9 — No silent failures | ⚠️ 1 P2 |
| Rule 10 — Accessibility (44px / color+label / reduced-motion) | ⚠️ 1 P2 |
| Sticky footer (`13_UI_Guidelines`) | ✅ PASS |
| Theme correctness — single global palette, no per-route logic | ⚠️ 2 P2 |
| Other non-negotiable deviations | ⚠️ 1 P2 (dead code) |
| **Lint** (`bun run lint`) | ✅ 0 errors (8 warnings, pre-existing) |

**Totals:** P0 = 0 · P1 = 0 · P2 = 4 · PASS = 5

## Findings

| ID | Severity | Rule | File | Issue | Remediation |
|----|----------|------|------|-------|-------------|
| F1 | P2 | Rule 9, AP-9 | `src/app/layout.tsx:108-110` | FOUC inline script uses an empty `catch (e) { /* no-op */ }`. Failure is genuinely non-fatal (PaletteProvider re-applies after hydration) and is documented, but it is still an empty catch, which the rule forbids by default. | Log via `console.error` or a named no-op handler; keep the comment explaining the deliberate swallow. Low risk but should be reconciled with the lint rule. |
| F2 | P2 | Finding #7 / code-hygiene | `src/lib/palettes.ts:105,113` | `ROUTE_PALETTE_MAP` and `getPaletteForRoute()` are dead code. No importer references them (grep only finds the definitions; lint flags `pathname` as unused). The map's comment still claims a "Per-Page Palette Assignment Matrix," which contradicts the new single-global-palette architecture and is misleading to the next agent. | Delete `ROUTE_PALETTE_MAP` and `getPaletteForRoute` (or wire them nowhere). Keep the spec-aligned `PALETTES` manifest. |
| F3 | P2 | Finding #7 (theme correctness) | `src/lib/palette-provider.tsx:48-67`; `src/components/settings/appearance-section.tsx:39-49` | `PaletteProvider` reads `dbTheme` but **never reads `dbPalette`**; it resolves palette from `localStorage || fallback`. So a palette saved via `updateSettingAction('palette', …)` (gateway → DB) is NOT applied on a second device where `localStorage` is empty — cross-device persistence gap. Compounding this, `selectedPalette` in the Settings UI reads `localStorage` **first**, while the provider uses DB **first** for theme — inconsistent sources of truth. | Read `dbPalette` from settings alongside `dbTheme` and make it the highest-priority source (DB → localStorage → fallback), mirroring theme handling. Align `selectedPalette` initializer order with the provider. |
| F4 | P2 | Rule 10, P15 | `src/components/settings/appearance-section.tsx:145` | Appearance Mode toggle buttons use `min-h-[40px]`, below the 44×44px touch-target minimum required on touch devices. These buttons are reachable in Settings on mobile. | Raise to `min-h-[44px]` (and `min-w-[44px]`), consistent with the sidebar/mobile-tab targets already at 44px/56px. |

## Notes (verified clean)

- **Rule 5:** No `#4F46E5`, `blue-*`, `indigo-*`, or indigo/blue hexes introduced. Palette swatch hexes (`#00FF9D`, `#22D3EE`, `#A78BFA`, `#FB7185`, `#FB923C`, `#FF9933`, `#0F172A`) are within the declared bioluminescent/neutral palette system and are applied via CSS variables — not as new indigo/blue accents.
- **Rules 2/3:** No `fetch`/`axios`/analytics/telemetry SDK in any client component (grep across `src`). The only network calls are server-side (`gatewayPatch`, Supabase auth) inside `"use server"` actions, permitted by the constitution.
- **Rule 6:** No money/float changes; all touched files are theme/responsive UI only.
- **Sticky footer:** `glass-shell.tsx` footer uses `mt-auto` within its flex column; short pages stick, long pages scroll (matches `13_UI_Guidelines` §13). Mobile `main` has `pb-16` to clear the fixed `md:hidden` bottom-tab nav (`min-h-[56px]`) + `env(safe-area-inset-bottom)`.
- **Single global palette:** `layout.tsx` FOUC script + root `<PaletteProvider>` apply one palette from `localStorage`/DB to all routes; `html[data-palette]` is set globally, no per-route override remains in active (non-dead) code.

## Verdict

**Can ship** — no P0/P1 violations. The global single-palette architecture is correctly implemented and the no-indigo/blue, no-telemetry, sticky-footer, and money rules are clean.

Recommended (non-blocking) fixes before merge:
1. **F2** — remove dead `ROUTE_PALETTE_MAP` / `getPaletteForRoute` (misleading per-route artifact).
2. **F3** — make `PaletteProvider` honor the DB `palette` so the user's choice persists across devices (sovereignty/persistence expectation).
3. **F4** — bump the Appearance Mode buttons to ≥44px.
4. **F1** — replace the empty FOUC `catch` with a logged no-op to satisfy Rule 9's letter.
