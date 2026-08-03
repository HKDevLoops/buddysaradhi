# Tester Report — Theme Propagation & Responsiveness

**Date:** 2026-07-13
**Tester:** Playwright MCP (manual driver)
**App:** BuddySaradhi web (`http://localhost:3000`) — Next.js 16 / Tailwind v4
**Login:** demo creds prefilled on `/login` (email `hkdevloops@gmail.com`, password `hkdevs`)

## Environment
- Dev server: `bun run dev` on `:3000` (confirmed UP, HTTP 200).
- Routes: only `/dashboard` is a real route; Students / Attendance / Fees / Settings are
  client-side Zustand `activeScreen` switches inside `/dashboard` (matches AGENTS.md §4 "only `/` is user-facing").

## Test 1 — Theme propagates across the whole app (the reported bug)
| Step | Action | Result |
|---|---|---|
| 1 | Load `/dashboard` (default) | `data-palette=aurora-cosmic`, `data-theme=dark` ✅ |
| 2 | Open Settings → Appearance → click "Use Emerald Ledger palette" | Live `data-palette=emerald-ledger`, localStorage `buddysaradhi.palette=emerald-ledger` ✅ |
| 3 | **Reload** `/dashboard` | `data-palette=emerald-ledger`, `data-theme=dark` ✅ **PERSISTED** |

**Verdict:** BUG FIXED. Previously the inline FOUC `routeMap` in `layout.tsx` overwrote the
user's choice with a per-route hardcoded palette on every load. Now the FOUC script reads
`localStorage`, and a single `<PaletteProvider>` (mounted in `providers.tsx`) applies the
user's global choice on every route. Confirmed via `document.documentElement` attribute.

## Test 2 — Responsive layout (mobile)
| Viewport | Sidebar | Bottom-tab nav | Horizontal overflow |
|---|---|---|---|
| 390×844 (mobile) | `display:none` ✅ | present (aria-label="Primary", 5 buttons) ✅ | none ✅ |
| ≥768 (desktop) | visible ✅ | hidden ✅ | n/a |

- Content-heavy screens (Dashboard, Students) render without horizontal scroll on 390px width.
- `min-h-[100dvh]` used; safe-area inset padding applied to footer + mobile bottom-tab.

## Screenshots (saved)
- `.playwright-mcp/verify-dashboard-desktop.png`
- `.playwright-mcp/verify-dashboard-mobile.png`

## Outstanding (from security review, P2)
- **F3** Cross-device palette persistence needs a `palette` column on `Setting` (DB migration +
  gateway PATCH path). Currently palette is per-device (localStorage). Deferred — blocked by
  MCP project-ref mismatch (deploy) + requires schema migration.
- **F1** Empty `catch {}` in FOUC script — defensive no-op, acceptable.

## Verdict
PASS. Theme propagation and responsiveness fixes are verified working. Lint + typecheck clean.
