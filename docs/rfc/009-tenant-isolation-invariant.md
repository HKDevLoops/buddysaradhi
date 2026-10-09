# RFC 009 — Tenant Isolation Becomes an Invariant, Not a Convention

**Status:** Draft — Awaiting Security Review (2 reviewers incl. the security owner, AGENTS.md §8)
**Author:** build (space-bunny)
**Created:** 2026-10-09
**Spec Owners:** Orchestrator, Security Owner, Ledger-Crypto Reviewer
**Related Specs:** `AGENTS.md` §1.2 / §2 Rule 1 / §3.4 / §3.6, `10_Security.md` §1–§2, `11_Data_Model.md` §1, `14_Edge_Cases.md`

---

## 1. Problem Statement

The product is single-tenant: **each tutor gets their own libSQL/Turso database**, and `11_Data_Model.md` §1 states that `tenant_id` is *defence-in-depth and not the partitioning key*. An audit on 2026-10-09 found that claim is **true on the gateway and false on the web**, and that a fallback branch makes the documented model's premise invert.

### 1.1 Finding A — the web ORM shim has no tenant concept

`apps/web/src/lib/libsql-proxy.ts:282` — `createLibsqlProxy(client)` takes **no tenant**. No model method injects one, asserts one, or defaults one. Every predicate is hand-written per call site.

AGENTS.md §3.6 describes this surface as "a contract, not a convenience". The contract currently contains no tenant clause. Isolation on the web path therefore rests on ~60 individual call sites each remembering to include `tenantId`. Four do not:

| Location | Statement |
|---|---|
| `apps/web/src/server/actions/attendance.ts:88` | `db.batch.findFirst({ where: { id: batchId } })` — **fixed** in SEC-HARDEN-01 |
| `apps/web/src/server/actions/attendance.ts:202, 218` | `attendanceRecord.findMany({ where: { sessionId } })` — **fixed** |
| `apps/web/src/server/actions/attendance.ts:230` | `upsert` keyed `{ sessionId, studentId }` — **fixed** |
| `apps/web/src/server/actions/settings.ts` (erase cascade) | `studentTag.deleteMany({})` — **fixed** |

Those four are closed. **The class is not**: the next unscoped call site is not a bug someone will remember to report, because nothing makes it wrong.

### 1.2 Finding B — the shared-DB fallback inverts the model

`apps/web/src/app/api/v1/[...slug]/route.ts:283`:

```ts
if (!dbUrl || !dbToken) {
  if (TURSO_SHARED_URL && TURSO_SHARED_TOKEN) {
    dbUrl = TURSO_SHARED_URL;
    dbToken = TURSO_SHARED_TOKEN;
    provisionMethod = "shared";
  }
}
```

When per-tenant Turso provisioning is unavailable **or errors**, every tutor is pointed at **one shared database**. In that state `tenant_id` stops being defence-in-depth and becomes the *only* thing between two tutors' books — and Finding A says the one component that could enforce it enforces nothing.

The critical property: **this is the fail-safe-looking branch.** It fires precisely when infrastructure is unhealthy. Neither defect alone is catastrophic; together, a Turso API outage becomes a full cross-tenant roster, ledger and settings read.

### 1.3 Why the gateway is not affected

`apps/gateway/lib/sql.ts:389-446` `buildTenantWhere` opens with an unconditional `clauses = ["tenant_id = ?"]`, and `createPrismaOrm` has no path that emits a query without it. Caller-supplied `tenantId` keys are skipped at `:397`, so a request cannot override the derived tenant. `lib/auth.ts:103` enforces `ud.user.id !== tenantId → 401`. The gateway is the correct design and must not change.

---

## 2. The Invariant

> **No code path may read or write a tenant's rows without a tenant predicate that was derived from the verified session, not from the request.**

Two enforcement points, matching the two findings:

- **A.** Provisioning **fails closed**. There is no code path that assigns a tutor to a database other than the one provisioned for them.
- **B.** The web shim **binds** the tenant. A proxy carries a tenant; every statement merges `tenant_id = ?` unconditionally; a caller-supplied conflicting `tenantId` is a hard error.

B makes A's guarantee load-bearing even if a shared-database deployment ever exists, and makes the four closed findings unrepeatable.

---

## 3. Proposed Change

### 3.1 Change A — delete the shared-DB fallback

**Decision (owner, 2026-10-09):** delete it. When per-tenant provisioning is unavailable or errors, sign-up returns **503** with a retryable typed body.

```ts
// No shared-database fallback. A Turso outage must not silently merge every
// tutor onto one database: `tenant_id` is defence-in-depth only while the
// physical boundary holds (11_Data_Model.md §1). Fail closed and retry.
```

- Sign-up is the only caller. A tutor who cannot provision simply retries; they are never silently merged.
- The `provisionMethod` field loses its `"shared"` value; the remaining values (`turso`, and the local-dev `file:` path) are unchanged.
- `TURSO_SHARED_URL` / `TURSO_SHARED_TOKEN` are deleted from `apps/gateway/.env.example` and the provisioning code.

**Rejected alternative:** keep it for local dev, hard-refuse in production. Rejected because the same branch would still be reachable in any deployment where `NODE_ENV` is unset or misconfigured — which is exactly how the `mock-token-` guard already failed open once (`DENO_DEPLOYMENT_ID` gating, `apps/gateway/lib/auth.ts:47`).

### 3.2 Change B — bind the tenant into the web shim

```ts
createLibsqlProxy(client: Client, tenantId: string)
```

- Every `findMany` / `findFirst` / `findUnique` / `update` / `delete*` / `count` / `aggregate` / `groupBy` merges `tenantId` into its predicate.
- `create` injects `tenantId` into `data` unless the caller supplied one **equal** to the bound tenant; a different one throws.
- `$transaction` propagates the bound tenant into the transaction proxy, so a transaction cannot straddle two tenants.
- A model whose table genuinely has no `tenant_id` (`student_tags`) opts out **explicitly and by name**, with the reason recorded — the SEC-HARDEN-01 fix is the reference implementation of that case.

**Migration shape (why this is phased):** the blast radius is every call site in `apps/web/src/server/**`. Making the parameter required breaks compilation at all of them at once, which is the point — TypeScript becomes the audit. Phased approach:

1. Add the parameter as **optional**; when absent, log a warning and behave as today.
2. Sweep the ~60 call sites to pass it. `tsc` finds them all.
3. Make it **required**, delete the fallback branch.

Step 3 is the gate. Until then the invariant is documentation, not code.

### 3.3 Tables with no `tenant_id`

| Table | Why | Treatment |
|---|---|---|
| `student_tags` | pure join table `(student_id, tag_id)` | explicit opt-out; scoped by the tenant's student ids (SEC-HARDEN-01) |
| `schema_migrations` | process-level bookkeeping | explicit opt-out |
| `admin_users` | not tenant data | explicit opt-out |

Any new table without `tenant_id` must be added to this list deliberately. That is the reviewable surface.

---

## 4. Blast Radius

| Surface | Change |
|---|---|
| `apps/web/src/app/api/v1/[...slug]/route.ts` | fallback branch deleted |
| `apps/web/src/lib/libsql-proxy.ts` | new parameter, injected clause, explicit opt-out list |
| `apps/web/src/server/**` (~60 call sites) | pass the bound tenant |
| `apps/web/src/lib/db.ts` | proxy construction passes the tenant; cache key unchanged (already URL-keyed) |
| `.env.example`, provisioning docs | `TURSO_SHARED_*` removed |

Untouched: `apps/gateway/**` (already correct), `packages/core` (already tenant-scoped in `feesFlow.ts` and `feesPrisma.ts`), the ledger grammar, the money path.

---

## 5. Test Gate

The invariant must be **falsifiable**, so:

1. **A shared-database scenario becomes a test fixture.** Create two tenants in one physical DB and assert, for every model in the shim, that tenant A's rows are invisible and unwritable from tenant B's proxy. This is the fixture the repo has never had — it is why the four findings survived.
2. **`$transaction` tenant test** — a transaction opened under tenant A that attempts a `create` carrying `tenantId: B` throws and leaves no rows.
3. **Provisioning test** — with Turso unreachable, `POST /api/v1/provision` returns 503 and writes **no** `user_metadata` credentials.
4. **No-regression:** web suite, core suite, gateway suite, `lint:principles` 7/7, `tsc --noEmit` 0.

A CI lint (extend `scripts/principle-lints.ts`) should fail any `createLibsqlProxy(` call that does not pass a tenant, once step 3 lands.

---

## 6. Spec Sections Amended on Ratification

| Section | From | To |
|---|---|---|
| `AGENTS.md` §1.2 | "tenant_id … defence-in-depth, not the partitioning key" | unchanged in wording, but now **enforced by the shim**, with the single-tenant DB named as the primary boundary and the shim as the secondary one |
| `AGENTS.md` §3.6 | "contract, not a convenience" | add: *the contract's first clause is the tenant predicate* |
| `11_Data_Model.md` §1 | §1.1 above | add the explicit opt-out table (§3.3) |
| `10_Security.md` §1 | threat model | add the shared-DB provisioning path as a named threat with the 503 fail-closed control |

---

## 7. Reviewers Required

AGENTS.md §5.4 — **2 reviewers, at least one the security owner**. This touches the data-access contract and the credential/provisioning path. §8 trigger 7 applies: a "quick fix" here would be worse than the defect.

## 8. Recommendation

Ratify **§3.1 immediately** — it is a deletion of ~6 lines, it removes the only path to a genuine cross-tenant read, and it has no dependency on §3.2. Land it while the amendment is in review; the fallback is indefensible on its own merits.

Ratify **§3.2 as a phase**, and run steps 1→3 as separate PRs so the ~60-site sweep is reviewable in slices.