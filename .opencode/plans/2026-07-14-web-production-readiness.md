# Web Production-Readiness Plan

**Date:** 2026-07-14
**Platform:** Web (`apps/web`, Next.js 16.2.9) — the In-Flight platform per `web/AGENTS.md` §0.1
**Gates:** `web/AGENTS.md` §8 "Done" + top `AGENTS.md` §2 non-negotiables

## Status at plan time (verified this session)

| Gate | Result | How |
|---|---|---|
| `bun run build` | ✅ GREEN | exit 0; 11 routes; TS passed |
| `bun run typecheck` | ✅ GREEN | `tsc --noEmit`, exit 0 |
| `bun run lint` | ✅ GREEN | eslint, 0 err / 0 warn |
| `bun run test --run` (vitest) | ✅ GREEN | 2/2 pass, but **scaffolding only** |
| No indigo/blue accents (Rule 5) | ✅ GREEN | grep `src/*.tsx` for `#4F46E5`/`blue-600`/`indigo-*` → none |
| No empty `catch {}` (Rule 9) | ✅ GREEN | grep `src` → none |
| `console.*` → typed logger (Rule 9) | ⚠️ PENDING | 18 `console.*` in `src` (server logging); edit-blocked |
| Playwright e2e (`test:e2e`) | ⛔ NOT RUNNABLE HERE | no browsers; needs live Supabase + `E2E_*` creds + `scripts/start-all.js` stack |
| axe-core a11y (`tests/a11y`) | ⛔ NOT RUNNABLE HERE | same infra gap |
| dev.log clean | ⏳ UNVERIFIED | dev server not run this session |
| worklog updated + spec-ref cited | ⚠️ PENDING | blocked by edit permission |

## Blockers (must resolve before "everything tested")

1. **Edit permission**: all non-plan file edits are denied. Website fixes, new tests, and the
   `ledger.test.ts` tamper-test split cannot be applied via Edit. Either lift the permission or
   apply the plan through an allowed path / human.
2. **E2E/axe infra**: Playwright browsers not installed; the full stack (`scripts/start-all.js` →
   gateway + web + turso + Supabase) and `E2E_EMAIL`/`E2E_PASSWORD` are required. Not present in sandbox.
3. **Pre-existing e2e bug**: `golden-path.spec.ts` and `a11y.spec.ts` navigate `/students`,
   `/attendance`, `/fees`, `/settings`. The build shows only `/dashboard` exists — the other 4
   screens are Zustand-switched views inside `/dashboard` (per `web/AGENTS.md` §6), NOT separate
   routes. The specs must click in-app nav (like `golden-path.spec.ts` already does) instead of
   `page.goto('/students')`, or they 404.

## Plan steps

### P1 — Rule 9: Console → typed logger (edit-blocked, apply when permitted)
- Replace the 18 `console.*` calls in `src` with the project typed logger:
  `components/hero/cta-stack.tsx:25`, `app/(auth)/signup/provision/page.tsx:65`,
  `server/actions/{attendance,fees,payments,settings,students}.ts`,
  `server/queries/{dashboard,students}.ts`, `server/get-db.ts:144,169,195`,
  `lib/search/searchStudentsFts.ts:21`.
- Surface errors via toast + `audit_log` per Rule 9 / AP-9. No silent failures.

### P2 — Expand runnable unit/integration coverage (edit-blocked)
- The 2 existing vitest tests are placeholders. Per `web/AGENTS.md` §7 (test pyramid) add unit tests
  for pure calc utils and Zod schemas in `packages/shared`, and component tests for glass/neumorphic
  primitives (`packages/ui`, `src/components/ui`). Target ≥70% on `packages/core` + `packages/shared`.
- Keep e2e at the integration level described in `web/AGENTS.md` §16/§21 (W-01..W-12) once infra exists.

### P3 — Fix e2e route mismatch (edit-blocked)
- Rewrite `a11y.spec.ts` to drive the app like `golden-path.spec.ts`: authenticate → land on
  `/dashboard` → click each screen tab → run `AxeBuilder` on the active view. Do NOT `goto` the
  non-existent `/students` etc. routes.

### P4 — Run the full "Done" sequence when infra is available
1. `bun install` + `npx playwright install --with-deps` (chromium/firefox/webkit).
2. Stand up the stack: `bun run scripts/start-all.js` (or per `deployment/06`).
3. Export `E2E_EMAIL` / `E2E_PASSWORD` (+ `E2E_SUPABASE_*` if non-default).
4. `bun run test:e2e` → golden-path + stress pass.
5. `tests/a11y` axe scan → 0 violations on all 5 screens.
6. `bun run build` + `bun run dev` → tail `dev.log`; grep for `Error|Warning|Hydration|Suspense`
   → clean.
7. Update `worklog.md` with a `---` entry (State: COMPLETED) citing spec + `## Spec ref`.
8. Verify no §2 non-negotiable violated and no §5 trigger fired.

### P5 — Ledger tamper-test split (approved "Split into two tests"; edit-blocked)
- `packages/core/src/ledger.test.ts`: split the combined tamper test into (a) hash-mismatch and
  (b) balance-mismatch, each asserting `reconcileLedger` returns `Error` and that the balance check
  precedes the hash check.

## Definition of "done"
All of `web/AGENTS.md` §8 satisfied: build/lint/typecheck green, e2e golden-path + a11y axe green,
dev.log clean, no §2 violation, worklog + spec-ref present. Today only the static gates
(build/lint/typecheck/unit) are green; e2e/a11y and the Rule-9 migration are gated on infra + edit
permission.

## Out of scope
- Mobile/desktop platforms (locked; web is the only In-Flight platform).
- New features / 6th screen (stop-and-ask if required).
