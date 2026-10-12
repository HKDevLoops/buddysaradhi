# RFC 009 / RFC 010 — Ratification Proposal: Tenant Isolation + Admin Access Model

**Status:** Draft — Awaiting Owner Ratification (AGENTS.md §8 gated; NOT RATIFIED, NOT EXECUTED)
**Author:** build (opencode)
**Created:** 2026-10-12
**Spec Owners:** Orchestrator, Security Owner, Ledger-Crypto Reviewer, DPO
**Related Specs:** `AGENTS.md` §1.2 / §2 Rules 1, 4 / §3.4 / §3.6 / §5.4 / §8, `10_Security.md` §1–§3/§15/§17–§18, `11_Data_Model.md` §1, `12_Business_Rules.md` BR-SEC-03, `14_Edge_Cases.md`
**Supersedes nothing. Amends nothing yet.** This document proposes the ratification decision; the amendments listed in §7 land only on sign-off.

---

## 1. Current status of each RFC (verified)

| RFC | File | Status line (read, not recalled) | Meaning |
|---|---|---|---|
| 009 | `docs/rfc/009-tenant-isolation-invariant.md:3` | `Draft — Awaiting Security Review (2 reviewers incl. the security owner, AGENTS.md §8)` | Unratified. The invariant is documentation, not code (009 §3.2: "Step 3 is the gate. Until then the invariant is documentation, not code."). |
| 010 | `docs/rfc/010-admin-access-model.md:3` | `Draft — Awaiting Principle Amendment (AGENTS.md §2 Rule 4 / §8)` | Unratified. No admin role exists today (010 §1: "no `role` column, no admin console, no cross-tenant query surface"). |
| Both | `docs/rfc/gated-review-packet-phases-1-3-4.md:143` | "RFC 009 and RFC 010 are unratified, so the admin surface's final shape is undecided." | Confirmed: nothing below is decided. |

Gate: AGENTS.md §8 #1 (ledger/`packages/core`-adjacent data-access contract) and §8 #4 (auth/tenant/crypto-adjacent provisioning path) both fire. Per §8.1 the agent stopped, documented, and waits. §5.4 requires **2 reviewers including the security owner**.

---

## 2. Verified code facts (every line below was read or grep-measured for this proposal)

### 2.1 The web shim binds no tenant

| Claim | Evidence |
|---|---|
| `createLibsqlProxy` takes no tenant | `apps/web/src/lib/libsql-proxy.ts:289` — `export function createLibsqlProxy(client: SqlHandle): LibsqlProxy` (read). |
| The proxy body contains zero tenant predicates | `rg -c "tenant_id" apps/web/src/lib/libsql-proxy.ts` → **no matches** (rg exit 1, measured 2026-10-12). Isolation rests on each call site hand-writing its predicate. |
| The one internal re-bind also drops the tenant | `apps/web/src/lib/libsql-proxy.ts:631` — `const txProxy = createLibsqlProxy(txHandle)` (grep-measured; line content UNVERIFIED beyond the matched line). |
| `tenantId` is available at construction and discarded | `apps/web/src/server/get-db.ts:102-103` (read): `const { client, userId, tenantId } = await getAuthenticatedDb(); return { db: createLibsqlProxy(client), userId, tenantId };` — the tenant is in scope and not passed. `get-db.ts:83,92` (read) derive `tenantId` from the verified session (`user.id` / `LOCAL_TENANT`), never from the request. |

### 2.2 The shared-DB fallback exists and is the fail-unsafe branch

`apps/web/src/app/api/v1/[...slug]/route.ts:389-395` (read):

```ts
if (!dbUrl || !dbToken) {
  if (TURSO_SHARED_URL && TURSO_SHARED_TOKEN) {
    dbUrl = TURSO_SHARED_URL;
    dbToken = TURSO_SHARED_TOKEN;
    provisionMethod = "shared";
  }
}
```

`route.ts:397-399` (read) already returns 503 when no DB is available, so deleting the branch keeps a fail-closed path. Note: RFC 009 §1.2 cites this branch at `:283`; the measured location on the current tree is `:389-395` (the file has shifted since 009 was written).

### 2.3 The gateway is the correct design and must not change

| Claim | Evidence |
|---|---|
| Tenant predicate is unconditional | `apps/gateway/lib/sql.ts:416-421` (grep-measured): `buildTenantWhere` with `const clauses: string[] = ["tenant_id = ?"]`. (RFC 009 §1.3 cites `sql.ts:389-446` — line range UNVERIFIED as cited; the measured anchor is `:416` + `:421`.) |
| Session-vs-request tenant check | `apps/gateway/lib/auth.ts:124` (grep-measured): `if (verifiedUserId !== tenantId)`. (RFC 009/010 cite `:103` — measured `:124`; file has shifted.) |

### 2.4 The four unscoped call sites from RFC 009 §1.1

RFC 009 states all four (`attendance.ts:88`, `:202/:218`, `:230`, `settings.ts` erase cascade) are **fixed** (SEC-HARDEN-01). **UNVERIFIED by this proposal** — the fixed lines were not re-read; ratification acceptance criterion §5.4 re-proves them.

---

## 3. The decision the owner must make

### 3A. Tenant isolation (RFC 009 §3 + review packet Phase 4a)

| Option | Shape | Effort | Risk if chosen / if deferred |
|---|---|---|---|
| **Option 1 — Inject `tenantId` + auto-scope every `where`** (RFC 009 §3.2; packet "recommended" as the real fix) | `createLibsqlProxy(client, tenantId)`; every read merges `tenant_id = ?`; `create` injects or throws on conflict; `$transaction` propagates; explicit named opt-outs (`student_tags`, `schema_migrations`, `admin_users` per 009 §3.3) | High. §4 measures the real scope. Phased in 3 PRs (optional param → sweep → required; 009 §3.2). | Chosen: large review-gated diff, but the guarantee becomes structural and the four-findings class becomes unrepeatable. Deferred: every new call site re-opens the class silently. |
| **Option 2 — Startup assertion + lint rule** (packet recommendation as immediate guard) | Require `tenantId` in every `where` touching a tenant table; extend `scripts/principle-lints.ts`; fail boot/tests on violation | Low. No signature change; no migration. | Chosen: cheap tripwire for the realistic failure (forgotten filter). Deferred/only: does not guarantee — a dynamic filter can still slip through (packet §4a con). |
| **Option 3 — Accept single-tenant-per-DB as sufficient** | No code change; record the acceptance as a risk decision | Zero | Chosen: leaves any DB-connection mix-up unrecoverable, and is only valid while §3B's fallback deletion holds — without a physical boundary, `tenant_id` is the *only* isolation and the shim enforces none (§2.1). |

**Recommended path (recommendation only — owner picks): Option 2 immediately + Option 1 scheduled as the phased real fix** (review packet §4a recommendation), **with RFC 009 §3.1 (delete the shared-DB fallback) ratified at once** — it is a ~7-line deletion (§2.2), removes the only path to a genuine cross-tenant read, and has no dependency on the shim work (RFC 009 §8).

### 3B. Admin access model (RFC 010 §2–§5)

| Decision point | Options | Recommendation |
|---|---|---|
| Erase-gap fix (010 §4.1) — edge `POST /api/v1/security/erase` checks PIN *existence*, never value | Preferred: retire the edge endpoint; erase only via `deleteAccountAction` (argon2id in-process). Fallback: HMAC PIN-proof bearer (weaker, needs own review). | **Retire the edge endpoint first.** Exploitable today with a stolen session; needs no new role; it is a deletion (010 §8.1). Edge route lines UNVERIFIED by this proposal — cited from 010 §1.1 (`routes/security.ts:52-157`). |
| Admin role shape (010 §2, §4.2) | Metadata-only admin (counts, timestamps, scrubbed `audit_log`) vs full-access vs no role (ratify the prohibition as a constraint) | **Metadata-only, and only if a concrete operational need exists** (010 §9.1). If pre-emptive, ratify the constraint ("no operator may read books") without building the role (010 §8.3). |
| Admin surface home (010 §5) | A: operator tool outside `apps/web` (no P2 amendment). B: Diagnostics inside Settings (requires P2 amendment). | **A.** Do not spend a principle amendment on a screen. |
| Precondition (010 §4.3) | Scrub `audit_log.metadata` of PII before any admin read exists | **Blocking precondition.** Exposing it first widens a known leak (`instituteEmail`, cited from 010 §4.3 — UNVERIFIED by this proposal). |

---

## 4. Exact migration scope (measured 2026-10-12; prior estimates reconciled)

Prior estimates: review packet says "~80 call sites" (packet `:133`); RFC 009 says "~60 call sites" (`apps/web/src/server/**`, 009 §3.2) and lists 5 touched surfaces (009 §4). **Measured on the current tree:**

### 4.1 Proxy construction sites (the only signatures that change under Option 1)

| Site | Line (grep-measured) | Notes |
|---|---|---|
| `apps/web/src/lib/db.ts` | `:91` — `createLibsqlProxy(libsql)` | Production construction |
| `apps/web/src/server/get-db.ts` | `:103` | Production; tenant in scope, discarded (§2.1) |
| `apps/web/src/server/queries/students.ts` | `:145` | Production |
| `apps/web/src/server/queries/attendance.ts` | `:66` | Production |
| `apps/web/src/lib/libsql-proxy.ts` | `:631` (internal `txHandle`) | Inherits automatically once bound |
| Test files (`*.test.ts`, `void-sequence.test.ts`, `libsql-proxy.transactions.test.ts`, `feesDialectParity.test.ts:314`) | 10+ sites | Updated mechanically; parity test at `feesDialectParity.test.ts:314` must cover the bound form |

### 4.2 Data-touching statements in production code (exclude `*.test.*`; measured)

`db.<model>.<method>(` + `tx.<model>.<method>(` across `apps/web/src/server/**` + `apps/web/src/lib/db.ts`:

| File | Statements |
|---|---|
| `apps/web/src/server/actions/settings.ts` | 83 |
| `apps/web/src/server/actions/attendance.ts` | 36 |
| `apps/web/src/server/actions/students.ts` | 17 |
| `apps/web/src/server/actions/fees.ts` | 3 |
| `apps/web/src/server/attendance-window.ts` | 1 |
| `apps/web/src/server/queries/search.ts` | 1 |
| `apps/web/src/server/queries/sync.ts` | 1 |
| **Total production** | **142 lines (57 `db.*` + 85 `tx.*`)** |

Reconciliation: the packet's "~80" and 009's "~60" predate the current tree or count `db.*` only. **The ratification scope is 142 production statements across 7 files, fed by 4 production construction sites.** Under Option 1's design, per-statement edits are *not* needed — statements inherit the bound tenant; the sweep passes the tenant at the 4 construction/call sites (plus tests), and TypeScript's required-parameter break is the audit (009 §3.2). Under Option 2, the same 142 lines are the lint's audit universe.

### 4.3 Untouched (verified by design, per RFC 009 §4)

`apps/gateway/**` (already correct, §2.3), `packages/core` money path (`feesFlow.ts`/`feesPrisma.ts` — cited from 009 §4, contents UNVERIFIED by this proposal), the ledger grammar.

---

## 5. Acceptance criteria for ratification

Ratification is a signature, not a merge. Each item must hold **before** the corresponding code PR merges:

1. **§3.1 deletion lands alone.** Shared-DB branch removed (`route.ts:389-395` deleted); `provisionMethod` loses `"shared"`; `TURSO_SHARED_*` removed from `.env.example` + provisioning docs; Turso-outage sign-up returns 503 and writes no credentials (RFC 009 §5.3).
2. **Shared-DB fixture test exists** (RFC 009 §5.1): two tenants, one physical DB; every shim model asserts tenant-B invisibility/unwritability from tenant-A's proxy. The repo has never had this fixture — it is why the four findings survived.
3. **`$transaction` tenant test** (RFC 009 §5.2): cross-tenant `create` inside a bound transaction throws and leaves no rows.
4. **Erase hole closed and proven** (RFC 010 §6.1): edge-originated erase without valid proof destroys nothing; web path still refuses wrong PIN.
5. **Admin reachability matrix + audit** (RFC 010 §6.2–6.3): admin statement set cannot construct against `ledger_entries`/`invoices`/`receipts`/`fee_plans`/`students`/`guardians`; every admin read writes an `audit_log` row naming the principal.
6. **`audit_log.metadata` PII-free** before any admin surface ships (RFC 010 §6.4).
7. **No-regression:** web + core + gateway suites, `lint:principles` 7/7, `tsc --noEmit` 0, `next build` green (RFC 009 §5.4, RFC 010 §6.5).
8. **§2.4 re-proven:** the four SEC-HARDEN-01 fixes are asserted by the fixture in criterion 2, not by citation.

---

## 6. What stays frozen until sign-off

1. **No shim signature change.** `createLibsqlProxy(client)` keeps its 1-arg form; no tenant parameter, optional or required.
2. **No shared-DB deployments.** The fallback branch stays, but no operator may set `TURSO_SHARED_*` in any environment — any shared-DB use before §3.1 lands is a §8 #7 violation, not a migration.
3. **No admin role, no admin surface, no `role` column.** No operator read path beyond what exists today; no P2 amendment filed for an admin screen.
4. **No new table without `tenant_id`** except via the explicit opt-out list (009 §3.3) recorded in the ratifying PR.
5. **No mobile/desktop work** — LOCKED until WEB-PROD-GATE (AGENTS.md §9.3; packet §"What is NOT in this packet").
6. **`ALLOW_DEV_AUTH`** stays documented-but-unmoved: the packet (Phase 1, §"Separate finding") assigns its auditable home to this phase — the ratification decision must name where it is documented or explicitly defer it. Its code behavior is UNVERIFIED by this proposal.
7. **Spec amendments in RFC 009 §6 / RFC 010 §7 are not applied** until ratification (see §7).

---

## 7. Spec sections amended on ratification (proposal — not applied)

| Section | Change (from RFC 009 §6 / RFC 010 §7) |
|---|---|
| `AGENTS.md` §1.2 | Wording unchanged; now *enforced by the shim* — single-tenant DB named primary boundary, shim secondary |
| `AGENTS.md` §3.6 | Add: the contract's first clause is the tenant predicate |
| `11_Data_Model.md` §1 | Add the explicit opt-out table (009 §3.3); admin principals are not tenant data (010 §7) |
| `10_Security.md` §1 + new §19 "Operator access" | Shared-DB provisioning as named threat with 503 fail-closed control; erase-cascade auth gate restated; operator-reach constraint |
| `01_Product_Principles.md` | New principle constraining operator reach (P16 or P10 amendment) — **triggers §8 #6**, needs orchestrator sign-off |
| `13_UI_Guidelines.md` §8 | Operator Diagnostics section **only if** option B chosen (§3B) |

Applying any row above before sign-off trips §8 #6 — that is why this file is in `docs/rfc/`, not in the spec corpus.

---

## 8. Reviewers, rollback, recommendation

**Reviewers:** 2, at least one the security owner (AGENTS.md §5.4; RFC 009 §7). DPO reviews the §3B admin-shape decision (DPDP 2025 adjacency, RFC 010 §7).

**Rollback:** docs-only — delete this file. If partially implemented: revert in slice order (shim sweep → bound parameter → fallback deletion is reverted last-needs-first; restored fallback keeps the 503 path from `route.ts:397-399`).

**Recommendation (recommendation only — owner picks):**

1. Ratify **§3.1 fallback deletion + §3B erase-hole retirement** at once — both are deletions, both remove live holes, neither depends on the shim migration.
2. Ratify **Option 2 now** (cheap guard) and **schedule Option 1 phased** (steps 1→3 as separate PRs; §4 is the scope).
3. Decide **§3B role-shape**: no-role constraint vs metadata-only role; if a role, option A surface + metadata scrub first.
4. Name the **`ALLOW_DEV_AUTH`** home or explicitly defer it — it must not survive ratification unnamed.
