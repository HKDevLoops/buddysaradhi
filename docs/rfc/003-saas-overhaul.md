# RFC-003: SaaS Overhaul — Web + Gateway (tutor OS → product)

- Status: ACCEPTED FOR IMPLEMENTATION (user directive 2026-09-30; human review
  required per AGENTS.md §8 on auth/ledger touchpoints before release cut).
- Trigger incident: production "Could not load student" — drawer `isError` UI
  plus Next.js production-generic Server Component text. Probable cause chain:
  expired/invalid Turso credentials in `user_metadata` (pre-1y tokens) → gateway
  rejects → direct-DB fallback throws the same → `fetchStudentDetailAction`
  rethrows → production masks the message. No credential-health check, no
  refresh/re-provision flow, no actionable error taxonomy exists.
- Scope: `apps/web` + `apps/gateway` ONLY. No new top-level screens (Rule 4),
  no ledger grammar change (Rule 1), no crypto-envelope change, no
  mobile/desktop touch (§9.3 lock).

## 0. Hosting budgets (Vercel Hobby + Supabase Free — HARD CONSTRAINTS)

- Vercel Hobby: ~100 GB bandwidth/mo, short serverless timeouts, 1 concurrent
  build, no cron beyond 2/day. Supabase Free: 500 MB DB, ~2 GB bandwidth/mo,
  7-day logs, Edge Function invocation caps.
- Consequences (all workstreams): cache-first reads (G-DB TTLs are budget
  controls, not just perf); smallest sufficient payloads (data-minimization
  saves bandwidth); no polling loops, no per-keystroke remote calls, no
  background intervals hitting network; lean middleware (runs per request);
  short timeouts (fail fast, never hang a serverless invocation); batch DB IO
  (every round trip costs rows-read + execution time on metered tiers).
- Turso usage (if on free tier): same logic — batch + cache, never N+1.

## 1. Goals (acceptance = all true)

1. G-AUTH: login / session / refresh / password-reset / PIN all audited,
   rate-limited, fail-closed; expired credentials produce ONE actionable UI
   state each (re-login / re-provision), never a generic crash.
2. G-FEES: every fee/payment mutation Zod-validated → integer paise → ledger
   row + `sync_outbox` + `audit_log` in ONE transaction/batch (Rule 7);
   receipt/invoice numbering monotonic (BR-RC-01); Andersen-style audit trail
   queryable per student.
3. G-DB: concurrent reads via single-flight batching (`Promise.all` +
   `client.batch`); reference data cached (63s TTL, tenant-scoped keys);
   every query bounded by timeout; pool-safe (no per-request connects).
4. G-HARDEN: no PII in client bundles beyond the visible screen; no
   `console.*` of data (Rule 9); server actions re-auth + re-validate every
   input (never trust client state); CSP enforced; API rejects forged
   tenant/sequence/amount fields.
5. G-GATEWAY: gateway implements the SAME contract (auth, validation,
   outbox+audit atomicity, caching, typed errors) — one behaviour, two runtimes.
6. G-ERR: typed error taxonomy (`AUTH_REQUIRED`, `DB_NOT_PROVISIONED`,
   `CREDENTIALS_EXPIRED`, `NEEDS_PROVISION`, `VALIDATION`, `CONFLICT`,
   `UPSTREAM`) mapped to UI states; production never shows a digest-only crash
   for recoverable states.

## 2. Workstreams (swarm, disjoint file scopes)

- **A: web-auth** (`apps/web/src/app/(auth)/`, login/signup/reset/forgot,
  `server/get-db.ts` creds/refresh, PIN, session). Deliver: credential-health
  check + refresh/re-provision flow; reset hardening; rate limits; audit rows.
- **B: web-fees** (`server/actions/fees.ts`, fees components, ledger-table,
  record-payment-sheet, invoice-sheet). Deliver: strict Zod boundaries,
  paise-only math via shared helpers, one-batch outbox+audit, receipt preview
  before post, void flow with reason (reversing entry, Rule 1).
- **C: web-db** (`server/get-db.ts` client/cache, `server/queries/*`).
  Deliver: request-scoped single-flight (`cache()`), `client.batch` reads,
  63s tenant-scoped cache with explicit invalidation on mutation, 12s timeouts
  everywhere, no `fetch` without abort signal.
- **D: web-harden** (all `*.tsx` + actions). Deliver: zero `console.*` in prod
  paths, no full-row props to client (project visible fields), server actions
  re-auth (no client-supplied tenantId/role), error taxonomy UI mapping,
  drawer `isError` split (not-found vs expired vs offline).
- **E: gateway-same** (`apps/gateway/**`): parity for A–D — auth middleware
  (expiry-aware 401 codes), fee-route strictness, `lib/cache.ts` TTL +
  invalidation, typed errors, no secret echo. New tests per route touched.

## 3. Non-goals

New screens/routes, ledger column changes, backup-envelope changes, telemetry,
any new network origin (Rule 2), mobile/desktop code.

## 4. Gates (per workstream, orchestrator re-runs serially)

`pnpm run lint` 0 · `typecheck` 0 · unit + integration green · web vitest
61+ · gateway vitest 224+ · new tests for every touched mutation path ·
e2e (bounded run) for login/reset + record-payment + void flows · no §2 rule
violated · commits <300 lines, spec-cited.

## 5. Rollout

Land behind no flags (small sequential commits, each independently green);
human review queue: auth changes (security reviewer), fee posting changes
(ledger-crypto reviewer), N1 packet from prior report still open.
