# REMEDIATION PLAN — Buddysaradhi monorepo audit

**Recorded:** 2026-10-14 · **Phase:** 2 (remediation plan) · **Baseline:** `docs/audit/BASELINE.md`
**Spec bound by:** `AGENTS.md` §8 (stop-and-ask triggers), §5.4 (reviewer counts), §12 (done), §13 (decision framework)

> **Read this first.** This plan contains findings from two completed read-only
> audit streams plus this session's own verified work. Every finding is marked
> **CONFIRMED** (source read, defect demonstrated) or **SUSPECTED** (code fact
> stated, exploitability not proven). Nothing here was fixed by deleting a test,
> weakening an assertion, or skipping a suite. Findings that require a decision
> this agent is not entitled to make are marked **§8 STOP** and are **not** fixed.

---

## 0. Disposition summary

| Class | Count | Action taken |
|---|---|---|
| **Fixed + verified this session** | 3 | Implemented, regression-tested, full gate suite re-run green |
| **CONFIRMED P0 — needs owner decision** | 4 | Documented with a recommended fix; **not** executed (§8) |
| **CONFIRMED P1** | 5 | Documented; 1 fixed (F-02), 4 queued |
| **CONFIRMED P2 / P3** | 18 | Documented and triaged |
| **SUSPECTED** | 4 | Flagged for verification, not action |

### Fixed and verified

| ID | Severity | Fix | Verification |
|---|---|---|---|
| **F-01** | **P1** | `pnpm run test:integration` was **deterministically red on `main`** and is a required CI gate (`.github/workflows/lint.yml:76`). Aligned `vitest.integration.config.ts` `testTimeout` with `apps/gateway/vitest.config.ts` (10s), and scaled the over-sized busy-wait durations while preserving every ratio and every assertion. | Suite **1 failed → 44/44 files, 698/698 tests, exit 0**. Measured: outlier-policy test **9429ms → 1712ms**, sibling **4410ms → 1771ms**. Full gate suite re-run green. |
| **F-02** | **P1** | Gateway cache HIT shipped `Cache-Control: public`, so the declared `no-store` policy was **never applied** on exactly the responses carrying student PII. `addSecurityHeaders` extracted to `lib/http-headers.ts` (importable/testable) and `Cache-Control` made an override. | 6 new tests, **negative control verified**: deleting the production override turns 3 of them red. |
| **F-05** | **P2** | `x-forwarded-for` was consumed as a trust signal but missing from the 8-header spoofable-IP strip list — per-IP rate limiting was bypassable on self-hosted deploys. Stripped **conditionally** (only when `cf-connecting-ip` is present). | `deno lint` 86 files exit 0 · `deno check` exit 0 · gateway suite 698/698. |

---

## 1. The P0s — all require an owner decision, none fixed here

> These four are the most severe findings in the audit. **None was fixed**, because
> every correct fix crosses an `AGENTS.md` §8 line and choosing unilaterally is the
> exact failure the constitution exists to prevent.

### F-03 · P0 · CONFIRMED — `sync-apply` mints its own erase credential

`apps/gateway/routes/settings.ts:255-338` accepts `{pin_proof, pin_hash}` from any
authenticated caller and writes them **verbatim** to `settings`. `settings.ts:63`
validates `pin_proof` as `/^[0-9a-f]{64}$/` — **shape only**. No recomputation, no
comparison against `pinProof(tenantId, pin)`, no nonce, no server-side binding.

`apps/gateway/routes/security.ts:119-155` then verifies the erase gate against
exactly that stored value via `constantTimeCompare`.

```
POST /api/v1/settings/sync-apply   {"pin_proof":"aaaa…a"(64×'a'),"pin_hash":"x"}
POST /api/v1/security/erase        {"tutorId":"<own>","confirm":"ERASE","pinProof":"aaaa…a"}
→ 200.  routes/security.ts:180-191 runs stmtEraseTable over 15 tables.
```

A stolen session destroys the tutor's entire institute. The repo's own test
`settings-security-gates.test.ts:624-649` ("erase succeeds against a gateway DB
written ONLY via public routes") proves the chain; no test pins that the stored
proof must equal a real one.

**Why not fixed here.** The three candidate fixes each cross a line:
(a) remove `pin_proof` from `sync-apply`'s writable surface — breaks the PIN-proof
feature shipped in `74b623b`; (b) require `GATEWAY_ADMIN_TOKEN` + a
server-to-server signature — an auth-architecture change to `10_Security.md`;
(c) make erase re-verify the actual PIN through Supabase — changes the documented
BR-SEC-04 flow. This is **§8 trigger #4 (auth/crypto) and touches data deletion**.

**Recommended:** (c), with (b) as defence in depth. The server never needs the
client's PIN to *store* a proof — it needs to be able to *re-derive* one.

### F-04 · P0 · CONFIRMED — `recordPaymentAction` has no idempotency guard

`apps/web/src/server/actions/fees.ts:194-211` writes a payment directly through
`recordPaymentPrisma` with no intent key. The sibling `voidReceiptAction`
(`fees.ts:315-318`) already forwards `Idempotency-Key`. The gap is documented in
the repo: `apps/web/src/hooks/use-confirmed-mutation.ts:36-37` — *"recordPaymentAction
must first accept `intentKey` in RecordPaymentOptions — server gap."*

**Failure (sequential, no race needed).** Payment commits → response lost → the
sheet's catch renders *"Nothing was written"* (false: `fees.ts:222-230` cannot
distinguish pre- from post-commit) → tutor taps again → **second ₹3,000 credit,
second receipt**, no key to reconcile, only two compensating voids.

**Why not fixed here.** `idempotency_keys` exists **only** in gateway DDL
(`lib/schema.ts:338`) — there is **no `IdempotencyKey` model** in
`prisma/schema.prisma`, and `AGENTS.md` §3.4's ORM-only rule bars the web from
reaching it with raw SQL. So every correct fix is either:
- **(a)** add the model + migration → **§8 trigger #1** (data model);
- **(b)** route payments through the gateway like void does → adds a **third**
  money path, violating `AGENTS.md` §3.5 ("the money logic exists exactly once");
- **(c)** repurpose the existing `AppState` model as a generic intent-key store,
  written in the payment transaction → no schema change, but it makes a
  settings-ish table the idempotency ledger.

(c) is the smallest correct move and **I recommend it**, but it writes a new
durable row type into the money transaction and deserves the ledger-crypto
reviewer that §5.4 requires for `packages/core`/ledger touches.

### F-06 · P0 · CONFIRMED — schema self-heal race can drop a tenant's invoices

`apps/gateway/lib/schema.ts:350-410`. The guard is `healedTenants.has(tenantId)`
(a plain `Set`); the tenant is added at **line 403, after the heal completes**.
Two concurrent first-requests for the same tenant both pass.

`repairLegacyInvoicesAndReceipts` (`schema.ts:571-581`) runs its 8 statements
**unbatched and outside any transaction**. Interleaving A/B: A copies `invoices`
→ `invoices_canonical`; B `DROP TABLE invoices_canonical` (A's only copy), recreates
it empty, then `DROP TABLE invoices`. Both throw; `healedTenants.add` never runs;
the **next** request's `batchExecute(CORE_DDL_STATEMENTS)` recreates an **empty**
`invoices` table. Every invoice is gone, and no `tamper_hash` or
`reconcileLedger` evidence remains to detect it.

**Trigger is normal, not exotic:** on a cold edge isolate every tenant is
unhealed, and the dashboard fans out 5 parallel server-component reads.

**Why not fixed here.** `lib/schema.ts` is one of the **two** DDL authorities
named in `AGENTS.md` §3.4, and it installs the append-only ledger triggers. A
concurrency change to it is **§8 trigger #1**.

**Recommended:** per-tenant in-flight promise memoization (the correct pattern
already exists at `apps/web/src/server/cache.ts:94-107` — `inflightLoads`),
**plus** wrapping the legacy repair in a single transaction and making it
idempotent via `CREATE TABLE IF NOT EXISTS`.

### F-07 · P0 · CONFIRMED — `voidEntry` has no double-void guard

`packages/core/src/ledger.ts:382-441`. The only guard is `original.type === "VOID"`.
There is no "does a row already carry `void_of_id = entryId`" check. The repo's own
test names it: `apps/web/src/components/fees/void-sequence.test.ts:431` —
*"KNOWN P0: voiding an already-voided payment is NOT refused by voidEntry — it
double-corrects."*

Second defect in the same function: `ledger.ts:406-416` posts the reversing row
with **no `invoiceId`**, while every `creditedForInvoice` implementation filters
over rows matched on `invoice_id` (`feesFlow.ts:412`). Voiding a core-written
payment therefore leaves the invoice reading `paid` and the Dashboard still
counting the voided credit.

**Why not fixed here.** `packages/core/src/ledger.ts` is the **explicit** §8
trigger #1 surface ("`packages/core` posting logic") and §5.4 requires 2
reviewers including the ledger-crypto reviewer.

**Recommended:** port the two guards that the gateway route **already has
correctly** — `apps/gateway/routes/ledger.ts:748` (VOID-of-VOID) and
`:752-758` (double-void, inside the same transaction) — into core, and carry
`invoiceId` onto the reversing row.

---

## 2. Confirmed P1

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| **F-08** | Gateway `POST /api/v1/ledger/payment` is a **third, divergent** money implementation: single `PAYMENT_RECEIVED` with **no `invoiceId`**, no `openInvoices`, no `creditedForInvoice`, no fail-closed `creditedPaise === amountPaise`. A gateway-recorded payment reduces the balance but leaves every invoice `unpaid` — the tutor is shown chasing fees already collected. | `routes/ledger.ts:417-573`; `ledger.ts:311-337` builds `paidMap` from `invoice_id` | Tracked as RFC-005 + `ledger-routes.test.ts:447-449`. **Queued.** |
| **F-09** | `sync_outbox` is **never drained**. `routes/sync.ts:34-55` stores an idempotency record and returns `{flushed: n}` without touching `parsed.data.ids`. No code path anywhere sets `status` away from `pending`. `GET` returns the same first 500 rows forever; the UI counter grows monotonically. | `sync.ts:34-55` vs `:26-30` | **Queued** — there is no delivery guarantee to claim until this ships. `packages/core/src/engines/sync.ts:21-45` `pushSyncOutbox` is an armed landmine: it marks rows `sent` **without sending**, bodies a `TODO(v2)`, and is exported from the barrel. **Recommend deleting it now** (§0.2 no-orphan-code) before anyone wires it. |
| **F-10** | Nothing reconciles `students.balance_paise` against the ledger. `routes/ledger.ts:395-401` serves the denormalised column; `reconcileLedger` has **35 repo-wide hits, every one a test, comment or spec** — zero production call sites. | `packages/core/src/ledger.ts:463-532` | **Queued.** This is the amplifier that makes F-06 undetectable. |
| **F-11** | `nextCreatedAtIso()` is a **per-process clock**, duplicated at `packages/core/src/ledger.ts:200-209` and `apps/gateway/lib/ledger-chain.ts:75-84`. Cross-process ties order wrongly in `reconcileLedger`, producing **false** "Balance mismatch"/"Hash mismatch". Tail reads use 4 different orderings (`created_at DESC` alone, vs `created_at DESC, rowid DESC`, vs `created_at ASC, id ASC`), so gateway and core can pick **different chain tips** in the same millisecond. | as cited | **Queued.** |
| **F-12** | Caller-controlled `x-db-url` + standalone `graphql/index.ts` with **no HMAC binding at all** → edge issues `POST https://<arbitrary-host>/v2/pipeline` (SSRF) and can `DROP TABLE` there. REST path is HMAC-protected. | `graphql/index.ts:408-424`, `lib/sql.ts:38-48`, `schema.ts:369` | **Queued.** Recommend a host allowlist in `resolveTursoUrl` **and** routing `graphql/index.ts` through `authenticateRequest` (it also carries a vendored executor copy that has already drifted from the real one). |

---

## 3. Confirmed P2 / P3 (triaged, not fixed)

**Security**

| ID | Finding | Location |
|---|---|---|
| F-13 | **The 15-attempt auth lockout is unreachable dead code.** `authenticateRequest` throws at `:274`, so `trackFailedAuth` at `:277` only runs on success and `clearFailedAuth` at `:281` clears it immediately. The counter never exceeds 1. | `index.ts:274-281` |
| F-14 | **Replay nonces and every rate limiter are per-isolate in-memory** (`crypto.ts:416`, `security.ts:58-60`). On Deno Edge/Supabase Edge a nonce presented to a cold isolate is a miss → replay succeeds. `10_Security.md §7`'s anti-replay guarantee does not hold. | as cited |
| F-15 | **No `aud`/`iss`/`nbf`/`role` assertion; sign-out does not revoke.** Signature verification *is* real (`getClaims` verifies against the project JWKS; `alg: none` fails safe; `getAlgorithm` allowlists RS256/ES256; `exp` enforced). `getClaims` is purely offline, so a stolen token stays valid for its full lifetime after sign-out. `jwt-verification.test.ts:19` **mocks `getClaims` entirely**, so no test exercises real JWKS/`exp`/`alg`. | `lib/auth.ts:99-110` |
| F-16 | **1-year Turso token in browser-readable `user_metadata`**; **shared-DB fallback** hands every tenant the same credential on any API failure. Authz is otherwise correct (uid-derived DB name — no enumeration). | `route.ts:372/389-395/404` |
| F-17 | **GraphQL: no depth/complexity/top-level cap, no dedup, sequential.** A 1 MB body of `{students{…}}` × ~30 000 → ~60 000 serialised queries, past a rate limit checked once up front. Resolver authz is neutralised by `{...f.args, ...variables}` at `executor.ts:115`. | `graphql/executor.ts:110-118` |
| F-18 | `POST /api/v1/students` reads `body.id` **pre-validation**, bypassing the Zod allowlist; `IdSchema` is `min(1).max(128)`, not a UUID check → permanently unreachable student rows. | `students.ts:538`, `sql.ts:636-637` |
| F-19 | Unbounded analytics time window (`periodStartIso=1900-01-01` reads all payment history), unbounded roster/invoice reads, `?search=` drops `take`/`skip`. `?limit=abc` → `NaN` → **500 instead of 400**. | `analytics.ts:186-197/255/266`, `students.ts:466`, `sync.ts:26` |
| F-20 | Raw pre-Zod request body persisted into `audit_log` + `sync_outbox` (~1 MB/mutation, never pruned). | `students.ts:591`, `attendance.ts:633` |
| F-21 | `notifications PATCH /:id` is **accept-and-drop 200** — tells a caller a read-state change happened for a row that may not exist (Rule 9). | `notifications.ts:110-130` |
| F-22 | `run()` fallback **drops the caller's DB credentials**, silently retargeting at `TURSO_DATABASE_URL` — a silent wrong-DB write on multi-tenant. | `sql.ts:182-197` |
| F-23 | Cache HIT echoes `X-Cache-Key: gw:<tenantId>:<path>:<full query>` — discloses tenantId and student search terms. | `index.ts:309` |

**Money / correctness**

| ID | Finding | Location |
|---|---|---|
| F-24 | Gateway ledger reads hard-capped at 200 rows with **no pager**; the web's `limit` param is ignored. `paidMap` from a 200-row slice under-reports `paid_amount_minor` for **every** invoice → dashboard aging/defaulter over-report what is owed. Silent under-reporting of money. | `routes/ledger.ts:241-245/311-324` |
| F-25 | Conflict resolution is **CAS-or-nothing with a legacy LWW hole**, not LWW; equal `updated_at` (string `!==`) silently loses — no tie-break. The CAS read *is* correctly inside the writing transaction (no TOCTOU). | `lib/cas.ts`, `settings.ts:168`, `students.ts:640` |
| F-26 | A payment bumps `students.updated_at`, silently invalidating an in-flight profile-edit CAS base → spurious 409 on a field the user never touched. Design choice, user-visible consequence. | `packages/core/src/ledger.ts:313-316` |
| F-27 | Erase audit trail not self-consistent: `erase_initiated` commits **before** the cascade, so a crash leaves a row asserting an erase that never happened. Fails toward "attempted", which is safe but unreconcilable. | `routes/security.ts:166-201` |
| F-28 | `sync_outbox` payload shape non-canonical on 4 paths (missing `status`; bare object with no `{table_name, op, payload}` envelope ×2; void path uses retired column `receipt_no`). | `feesPrisma.ts:98`, `settings.ts:186`, `students.ts:407`, `ledger.ts:869` |

**Hygiene**

| ID | Finding | Location |
|---|---|---|
| **F-35** | **`pnpm run lint` lints 12 files and ZERO TypeScript.** `apps/web/eslint.config.mjs` is `js.configs.recommended` plus one override block, with **no `files:` entry and no TS parser** — so ESLint's default `**/*.js\|mjs\|cjs` matching applies and no `.ts`/`.tsx` file is ever picked up. Measured: `apps/web` → **2** files linted against **242** TS/TSX under `src`; `packages/core` → 4; `packages/shared` → 4; `packages/security` → 1; `apps/product-page` → 1. The same override block also sets **`"no-console": "off"`** outright. | all package `eslint.config.mjs` |
| **F-36** | **Therefore `AGENTS.md` §2 Rule 9's enforcement clause is false.** It claims *"Enforced: ESLint `no-empty-catch`, `no-console`"* and §14 repeats it. Neither rule exists in any config, zero TypeScript is linted, and `scripts/principle-lints.ts` has **0 matches** for either. **Rule 9 (no silent failures) has no machine gate at all** — so the "lint: exit 0" claim in every recent worklog entry covers 12 config files, not the codebase. | `AGENTS.md` §2 Rule 9, §14 |
| **F-37** | **The erase exception has two mutually-exclusive implementations and neither works.** `10_Security.md` LEDGER-4 permits physical ledger deletion in secure-erase; the gateway's `trg_ledger_no_delete` forbids it; the web path and the `principle-lints` allowlist encode a **third** answer (silent no-op) in no ratified spec. | `apps/gateway/lib/schema.ts`, `scripts/principle-lints.ts:190-195` |
| F-29 | `rate-limit.ts` `MAX_BUCKETS` is not a real ceiling: pruning only deletes buckets that refilled **to cap**, so 1-request-per-key attackers grow the map unbounded while every request pays an O(n) scan on the middleware hot path. | `apps/web/src/server/rate-limit.ts:52-102` |
| F-30 | `catch {}` (Rule 9), fire-and-forget `void fetch().catch(()=>{})` in the audit logger (an audit row can be lost silently). | `route.ts:248`, `lib/logger.ts:83-92` |
| F-31 | `WorkerPool`/`globalWorkerPool` uses `worker_threads`, which **does not exist in Deno** — orphan code (§0.2). | `packages/core/src/worker.ts` |
| F-32 | Hardcoded Supabase project ref ×2; floating `"npm:@supabase/supabase-js@^2"` leaves the gateway's security semantics unpinned. | `sql.ts:45`, `get-db.ts:491`, `deno.json:9` |
| F-33 | Regex blocklists (`/0x[0-9a-f]+/i`, `/on\w+\s*=/i`) reject legitimate student notes; Zod is the real validator. | `security.ts:14-37` |
| F-34 | **Perf-budget tests remain load-sensitive.** `securityFail() builds a response in under 200µs` measured **0.353ms** under contention (2 concurrent agents + 44-file parallel run) and passed twice in isolation and twice in full-suite runs. The file's batching fixed per-op noise but not **cross-file** contention — 44 workers busy-waiting on a shared CPU. | `low-latency.test.ts:238` |

**SUSPECTED (verify before acting):** `x-forwarded-for` trust off-Cloudflare
(residual half of F-05); `invalidateTenant` compiles a `RegExp` from a
dev-supplied header (`cache.ts:56-68`); `auth-svc` `DELETE FROM ledger_entries`
via `$executeRawUnsafe` (`apps/services/auth-svc/src/index.ts:135`); how many
sync clients omit `base_updated_at`.

---

## 4. What is verified correct — do not re-derive

Recorded because a passing gate is not the same as a verified property, and
because the next agent should not "fix" these.

- **Ledger immutability (Rule 1) — clean.** No `ledgerEntry.update/delete` in any
  shipping path; the audited builders **throw** on update/delete of
  `ledger_entries`; both DDL authorities install `trg_ledger_no_update/_no_delete`.
- **Receipt/invoice numbering — two independent layers.** In-DB atomic increment
  (never read-modify-written in JS) **and** `UNIQUE (tenant_id, number)`.
  **Two concurrent payments cannot collide** — each opens `BEGIN IMMEDIATE`.
  Never decremented anywhere.
- **Two concurrent payments cannot under-credit an invoice** —
  `creditedForInvoice` is read *inside* the writing transaction.
- **Integer paise end-to-end, no float.** `paiseAdd/Sub/Mul/DivHalfEven` guard
  every site with overflow/NaN errors; the only discount arithmetic is
  BigInt basis-point half-to-even.
- **Promise memoization caches no rejections** (`server/cache.ts` sets the loader
  synchronously with no intervening `await`; `finally` deletes the entry).**
- **Rule 7 write side — clean.** Every traced mutation writes `sync_outbox` in the
  same transaction, and `recordOutbox`/`recordAudit` are **fail-closed**.
- **Gateway void route is the best money path in the repo** — mirrored reversing
  row, both guards inside the transaction, audit row before the money row, receipt
  `voided_at` in the same transaction. It is the reference for fixing F-07.
- **Cache keys are tenant-scoped** at both layers; secrets projected out before
  caching; invalidation after commit on every mutation.
- **JWT signature verification is real**, `alg:none` fails safe, `exp` enforced.
- **No path traversal** — zero filesystem I/O in gateway runtime code.
- **Error responses leak nothing** — 5xx collapsed, `sanitizeError` strips
  `x-db-*`/`Bearer`/IPs/UUIDs, Zod errors echo field paths not values.

---

## 5. Source-research reconciliation

The attached `deep-research-report.md` is **not evidence**. It executed nothing
by its own admission ("state 'not executed'", "A sample inventory
(illustrative)"), and its Gantt charts mark October-2026 phases `:done` for work
that does not exist here.

| Its claim | Reality |
|---|---|
| **P0** build/tests failing | **False** for JS/TS — all gates green, 1324+698 tests |
| **P1** CORS wildcard | **False** — allowlist + `Vary: Origin`, fails closed |
| **P0** gateway split | **Resolved** — mirror deleted in `2433137` |
| **P1** GraphQL depth, **P1** tenant isolation | Not self-reported; delegated to the audit streams (§ F-17, and tenant `buildTenantWhere` verified unconditional with caller keys skipped) |
| Propose `domain/`/`application/`/`infrastructure/` | **Rejected** — would fork `packages/core/src/feesFlow.ts`, the one thing already correct, and `feesDialectParity.test.ts` exists precisely to stop that drift |
| Propose Apollo + `graphql-depth-limit` | **Rejected** — new network deps breach Rule 2; the gateway is Deno with a hand-rolled schema. The equivalent control is a selection-count cap (F-17) |

Its one durable contribution — *a directory listing cannot prove a defect, and
architectural cosplay is worse than a smaller correct codebase* — is adopted as
the operating principle for this audit.

---

## 6. Recommended sequence

1. **Owner decision on F-03** (erase credential) — highest blast radius:
   irreversible loss of every row in a tenant database.
2. **F-04** payment idempotency (recommend option (c)), **F-07** core
   `voidEntry` guards (port from the gateway route). Both need the
   ledger-crypto reviewer per §5.4.
3. **F-06** schema-heal race + **F-09** outbox drain. Together these decide
   whether sync has a delivery guarantee at all — currently it does not.
4. **F-08** converge the gateway payment route onto `feesFlow`; **F-10** wire
   `reconcileLedger` into a real command so divergence is detectable.
5. **F-34** give the latency suite its own serial lane or relax it to
   informational — a perf gate that measures the machine is the defect the file
   exists to prevent, still latent.

**Not production-ready.** Four confirmed P0s are open, two of which are
irreversible-data-loss and financial-integrity failures reachable from shipped
routes.

---

## 7. Phase 2 conclusion

**State: COMPLETED.** This is a plan, not a fix. Three defects are fixed and
verified (F-01, F-02, F-05); four P0s are documented with recommended fixes and
explicitly **not** executed because they cross `AGENTS.md` §8. Next: owner
decisions on §1, then Phase 4.