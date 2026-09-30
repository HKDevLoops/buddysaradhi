# Production Readiness — Completion Report + Next-Phase Plan (2026-09-30)

Parent instruction: `reviews/verification-production-readiness-report-2026-09-29.md`
(F-1..F-12 + Phases 1-3). This file certifies what is done (with evidence),
what is present in the repo, and what the next phases must contain to reach
production-ready. Spec refs use the same IDs as the parent report.

---

## 1. Completeness check — every parent-report item

| Item | Parent-report demand | Status 2026-09-30 | Evidence |
|---|---|---|---|
| F-1 | Typed 401/503 in web `/api/v1` dispatch, never 500 | DONE | `04c43a1`, `settings-auth.spec.ts:126` matrix |
| F-2 | Applied palette wins over stale server echo | DONE | `512f0e4` (same class as density fix `103036f`) |
| F-3 | WebKit/Mobile-Safari login timeout + a11y fails | DONE (test-side) | Root cause: CSP `upgrade-insecure-requests` (`next.config.ts:22`, `proxy.ts:172`) kills WebKit hydration on plain-http origin. Helper `apps/web/tests/e2e/csp-test-helper.ts` (no-op on https) applied to all 4 specs. Verified: a11y 4/4, golden-path + settings-auth 22/22 (chromium+webkit). Commit `c066050` |
| F-4 | Deno workspace corruption made permanent | DONE | `d5b1116` (`nodeModulesDir: none`); fullpass + CI use it |
| F-5 | Web vitest in CI | DONE | `lint.yml` + `test.yml` run `pnpm --filter web exec vitest run` (61/61) |
| F-6 | e2e off production, local server | DONE | All 3 workflows: build → `next start :3300` → readiness → playwright → teardown; base URL `http://127.0.0.1:3300` |
| F-7 | Principle lints L1-L5 | DONE | `scripts/principle-lints.mjs` (517L, 0 findings/19→20 allowlisted) wired into `pnpm run lint`; `127d7a3`, `885cf9f` |
| F-8 | antislop files present | DONE | `antislop{,-ui,-copywriting,-human}.md`; `6f70023` |
| F-9 | bun→pnpm sweep + axe gate placement | DONE | AGENTS.md 21 replacements; axe is BLOCKING in `test.yml` (verified 4/4, 0 violations); `4c376f5`, `c066050` |
| F-10 | stress-shots untracked | DONE | `.gitignore` + `git rm --cached` 10 PNGs; `4c376f5` |
| F-11 | Commit S3 wave in chunks + worklog | DONE | 18 chunks `c066050..c403353` pushed `512f0e4..c403353`; worklog S3-WAVE entry (State: COMPLETED) |
| F-12 | Re-verify `next build` baseline claim | DONE | 2/2 green (exit 0, 0); earlier workStore flake not reproduced. Vercel remains the build gate |
| L6 | Coverage floors ≥70% core+shared | DONE | core 56.1%→**97.45%** (13 files), shared 4.3%→**100%** (6 files); thresholds enforced in `test.yml`; `7b212ec`, `4204bae`, `c403353` |
| Phase 3 | §3.4 amendment, execSafe, tableMap, ledger unification, monotonic seq | DONE | `204c158` (spec), `cc7666d` (proxy), core `fees.ts`/`ledgerSql.ts` + gateway `routes/ledger.ts` rewrite (`df80b02`, `73d54e7`, `a87f7a3`, `f95c78e`, `30efd5a`, `a6f2f46`) |
| B1 | Invoices DDL split (review blocker P1) | DONE | Gateway DDL = `11_Data_Model.md` §4.12 + parity test |
| B2 | Rule 7 outbox gap (review blocker P1) | DONE | outbox for all 5 mutated tables, asserted in tests |
| P1-1 | `createBackupAction` silent-empty catch (Rule 9) | DONE | catch removed; missing table = loud typed error (`242ca96`) |
| SEC-01/02 | Graduated PIN ladder 5/10/15 + wipe audit | DONE | `59473bf`; LEDGER-4 allowlisted (audited exception) |
| INV-01/03/04 | Canonical tamper hash, bps percent, invoice audit | DONE | `c664f25` |

Final gate matrix (orchestrator-run, serial): principle-lints 0 · lint 0 ·
typecheck 0 · unit **608+1** · integration **224/224** · web vitest **61/61** ·
gateway vitest **224/224** · deno lint/check 0 · a11y **4/4** · build exit 0 ×2.

---

## 2. What is present (inventory)

- **CI (`.github/workflows/`)**: `lint.yml` (lint+typecheck+unit+integration+web-vitest, no playwright),
  `test.yml` (+ web vitest, coverage floors, local-server e2e soft, **blocking axe**),
  `web-prod-gate.yml` (local-server e2e + report upload).
- **Ledger core (`packages/core/src/`)**: `ledger.ts` (hash/payload/clock exports,
  UUIDv7 order), `fees.ts` (invoice/payment writers), `ledgerSql.ts` (SQL dialect),
  `tamper.ts`, `money.ts` (guarded paise), graduated `engines/security.ts`,
  spec-aligned `engines/invoice.ts`; 97.45% line coverage.
- **Gateway (`apps/gateway/`)**: spec-aligned `schema.ts`/`orm.ts`, `lib/{sql,tx,ledger-chain}.ts`,
  rewritten `routes/ledger.ts` (seq/tamper/void-guards/full-outbox), 3 test files.
- **Web (`apps/web/`)**: thin `fees.ts` action, P1-1-free backup action, F-3 helper,
  4 green e2e specs (chromium+webkit verified; mobile projects green in a11y).
- **Docs**: AGENTS.md (pnpm), antislop ×4, verification report (09-29), this plan,
  `scratch/fullpass.sh`, worklog through S3-WAVE.

---

## 3. Next-phase plan (sequenced to production-ready)

### Phase N1 — Human reviews (gates the merge, §8)
All pushed to `main`; retrospective review required before any release cut:
1. `4c376f5` (AGENTS.md) — §8#6: **2 reviewers + orchestrator sign-off** (user
   standing approval 2026-09-30 recorded; still needs 2 humans).
2. Ledger chunks (`cef0749`, `df80b02`, `73d54e7`, `30efd5a`, `a87f7a3`, `f95c78e`,
   `59473bf`, `c664f25`) — §8#1: **2 reviewers incl. ledger-crypto**.
3. `59473bf` principle-lints allowlist (LEDGER-4 wipe) — security reviewer confirm.

### Phase N2 — Spec rulings (code is BLOCKED until these land)
4. **Rounding contradiction** (`22_Redundancy_Audit.md` §5 precedence): BR-FEE-01 +
   EC-F-01 (half-to-even) vs BR-M-05 (round-half-up). Then implement + flip the
   sole remaining `it.fails` (`invoice.test.ts:352`).
5. **feeCalc.ts RFC**: BR-CALC-09/10/11, `11_Data_Model.md:1075`, `02` §6.9.3 cite
   `expected/collected/arrearsForPeriod` + `attendancePct` + due-date/IST utils
   that do not exist — spec-first implementation task.
6. Minor spec repairs: loose `models.ts` enums (`z.string` → enums for
   ledger/attendance types); BR-M-02/04 display tension (decimals/minus sign);
   P3-11 outbox payload case codec (before any replay reader exists);
   `desktop/01_Architecture.md:121` stale `attendancePct` claim (needs a
   desktop-spec edit — platform LOCKED, human only).

### Phase N3 — Bug triage
7. **stress.spec.ts LIGHT-mode**: `<html data-theme>` stays `dark` after clicking
   Light — fails on BOTH chromium and webkit (pre-existing, engine-independent;
   possibly F-2-adjacent). Triage app vs test, fix, keep e2e soft until green.
8. Re-run FULL e2e matrix (all 4 specs × chromium + webkit) after N2/N3 fixes.

### Phase N4 — Release (S4, blocked on user actions)
9. User: `vercel login` → preview deploy → TestSprite re-runs → prod cut;
   provision `AIHUBMIX_API_KEY`; Higgsfield/NIM items per parent report.
10. Mobile/desktop stay LOCKED per `16_Platform_Delivery_Sequence.md` until
    WEB-PROD-GATE is signed (4/4 gate + reviews + N2 rulings).

---

## 4. NEXT-PHASE-01 session update (same day, later)

Deployed gateway + webpage/product-page verification and deferred-work
completion, all pushed to `main` (`b60adb3..610c73e`):

- **Gateway LIVE**: Supabase Edge Function
  `gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway` (ap-south-1) —
  `/health` 200 `{ok:true}` (0.48s); `/api/v1/students` without auth → 401
  typed (F-1 behaviour holds on the deployed box); HSTS/nosniff/DENY present.
  `api.buddysaradhi.app` does not resolve — custom domain not attached.
- **Web/product checked**: product-page builds exit 0 and serves 200 locally;
  deployed `buddysaradhi.vercel.app/login` and `product-page-one-nu.vercel.app`
  both 200 with correct HTML. No prod e2e per F-6.
- **N2-4 rounding RESOLVED** (was "needs ruling"): new `22` P16 scope-split
  (division half-to-even / display half-up / splits remainder) —
  **pending human ratification**. `paiseDivHalfEven` (BigInt-exact) in shared +
  core mirror; invoice percent uses it; pin setup fixed to bps; **zero
  `it.fails` remain** (`babe8e5`).
- **N2-5 feeCalc DONE**: `packages/shared/src/feeCalc.ts` (BR-CALC-09/10/11,
  43 tests, 100% cov). Gaps filed, not guessed: G1 (no enrolment-status DDL),
  G2 (`void_of_id` projection), G4 (null-vs-0) need spec amendments;
  `attendancePct` correctly left out (needs division → was rounding-blocked).
- **N2-6 models: findings-only, correctly NOT tightened** — DDL CHECK
  (`11_Data_Model.md:379`) and `03_User_Flows.md:302` mandate the 5th value
  `holiday`; tightening to the 4-set would reject legitimate rows. RFC filed:
  fix `generate_zod.py` to emit enums from CHECKs, or delete the orphan.
- **P3-11 codec DONE** (`fa0ba8d`): canonical snake_case codec; no replay
  reader exists — landed in time. Residual: gateway stubs vs full rows
  (follow-up RFC).
- **N3-7 stress theme FIXED**: stale server echo clobbered `data-theme`/
  `data-density` (F-2 class) → applied-first + seed-only. Stress e2e **2/2**
  (chromium+webkit); unit test 4/4 (`b60adb3`).
- **Live op-CHECK bug fixed** (`ca14b78`): settings PATCH wrote outbox op
  `upsert` (CHECK allows only insert/update/soft_delete) → `update`.
- **G3 fixed**: quarter sketch zero-pad in `02_Core_Logic.md`.
- N1 review packet grows: P16 ruling + `babe8e5` join the §8#1 ledger-crypto
  queue. Ops: no infinite servers — every run bounded
  start→poll→use→kill; ports verified free.

### Explicitly out of scope (do not start)
- `apps/mobile/`, `apps/desktop/` code or spec edits (§9.3 platform lock).
- Rounding implementation before the N2 ruling (would pick a side in a live
  contradiction).
- Re-pointing any e2e/a11y at production (F-6 — write-specs mutate the DB).
- `pnpm exec`→direct-binary or bun migrations (toolchain settled: pnpm + direct
  `node_modules/.bin`, deno `nodeModulesDir: none`).
