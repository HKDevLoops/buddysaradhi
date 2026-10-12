# SECURITY AUDIT — 2026-10

**Auditor role:** code-checker (read-only). No source file was modified. This report is the only artefact created.
**Target:** `Z:\Projects\buddysaradhi\buddysaradhi` @ working tree (uncommitted: `docs/security/`, `scripts/security/`).
**Date:** 2026-10-12
**Scope read:** `apps/web`, `apps/gateway`, `apps/product-page`, `packages/*`, `apps/services/*`, `scripts/`, `.github/workflows`, `prisma/`, `supabase/`, root spec corpus (`AGENTS.md`, `10_Security.md`, `23_Security_Harness_Plan.md`, `docs/rfc/009-*`).

**Priority order used (as instructed):** AGENTS.md §2's 11 non-negotiables → `10_Security.md` threat model + `23_Security_Harness_Plan.md`'s 10 domains → OWASP Top 10 (2021).

---

## 0. VERDICT

```
VERDICT: FAIL (P0 present)
```

**4 Critical · 7 High · 16 Medium · 7 Low.** Four findings are P0-class: a session-only full-tenant data-destroy primitive on the public edge, a shared-database fallback that inverts the tenant-isolation model, an ORM shim with no tenant binding, and unauthenticated remote code execution in the pinned Next.js version.

The single most important sentence in this report: **the gateway's most destructive endpoint requires no second factor.** `apps/gateway/index.ts:118-162` builds an entire boot gate around `GATEWAY_ADMIN_TOKEN` and its own error text claims the token protects `POST /api/v1/security/erase` — but `GATEWAY_ADMIN_TOKEN` is read **only** at boot and never inside a request handler (verified: the only non-test, non-comment references are `index.ts:119`, `index.ts:162`). The boot gate therefore protects nothing about the erase route.

### Counts

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 7 |
| Medium | 16 |
| Low | 7 |
| **Total** | **34** |

---

## 1. GATE RESULTS (read-only, run by this audit)

| Gate | Command | Exit | Note |
|---|---|---|---|
| Repo lint | `pnpm run lint` | **0** | 7 principle-lints PASS, **110 allowlisted hits** |
| Repo typecheck | `pnpm run typecheck` | **0** | design-system build + web + core |
| Principle lints (L1–L7) | `node scripts/principle-lints.ts` | **0** | 7 clean, 110 allowlisted |
| Dependency audit | `pnpm audit --production` | n/a | **5 critical / 56 high / 45 moderate / 5 low** across 1,204 deps |
| Gateway lint/check | `deno lint` / `deno check` | **not run locally** | `apps/gateway/package.json:9-10` are `echo` no-ops; real runs only in `web-prod-gate.yml:155,158` and `supabase-ci.yml:34,37` |
| Version gate | `pnpm run version:check` | **not run** | see §7 |
| Test suites | — | **not run** | `AGENTS.md` §7.1 — the fullstack-tester owns these |
| a11y | — | **not run** | out of scope for a security audit |

No gate is red. **A green gate is not evidence of safety here** — §5 documents three cases where the gates pass while the vulnerability class is open.

---

## 2. CRITICAL FINDINGS

### C-1 · CRITICAL · Session-only destruction of an entire tenant's books

**File:** `apps/gateway/routes/security.ts:52-157` (route), `apps/gateway/index.ts:118-162` (the gate that does not gate)
**Spec violated:** `10_Security.md` §18.1 step 1 ("gate 1 … **PIN confirmation**"), `12_Business_Rules.md` BR-SEC-04, BR-SEC-03, `AGENTS.md` §8 stop-and-ask trigger #1.
**OWASP:** A07:2021 Identification and Authentication Failures; A01 Broken Access Control.

The erase route enforces four gates and none of them is a credential:

```
apps/gateway/routes/security.ts:65   if (typeof tutorId !== "string" || tutorId !== tenantId) return fail(...)   // identity
apps/gateway/routes/security.ts:68   if (confirm !== "ERASE") return fail(...)                                 // typed word
apps/gateway/routes/security.ts:74   checkRateLimit(`erase:${tenantId}`, 5, 15 * 60_000)                         // 5 / 15 min
apps/gateway/routes/security.ts:90   const pinConfigured = typeof pinRow?.pin_hash === "string" && ...           // PRESENCE ONLY
```

`stmtSettingPinPresence` (`apps/gateway/lib/sql.ts:1093-1098`) is `SELECT pin_hash FROM settings WHERE tenant_id = ?` — the hash is read and only its **length** is tested. The file's own comment (`security.ts:41-51`) concedes the edge *cannot* verify the PIN because Deno has no Argon2. The conclusion drawn from that honest admission is the defect: having no PIN proof, the route substituted **PIN presence** for **PIN proof**, and shipped.

The web app's equivalent (`apps/web/src/server/actions/settings.ts:1099`, `deleteAccountAction` → `verifyPinWithLadder`) *does* verify. So the protection exists in the product and is simply absent on the edge path.

`apps/gateway/index.ts:118-162` is worse than absent — it is a **documented control that does not exist**, which `index.ts:75-76` itself calls out:

> *".env.example ships `GATEWAY_ADMIN_TOKEN=change-me` … and NOTHING read it: the variable was never enforced at boot and (as of this audit) is never read by any request handler either."*

and then `index.ts:122-127` throws at boot with:

> *"The destructive admin surface (POST /api/v1/security/erase) has no second factor behind it, so a compromised session is enough to destroy a tutor's data."*

That message describes the live state of the system. `assertAdminTokenStrength` only validates that the variable is *set strongly*; nothing reads it per-request.

**Attack scenario**
- **Who:** anyone holding a valid Supabase session for a tutor — the tutor themselves, an attacker who stole a session cookie / access token, a malicious browser extension, or anyone who phished one.
- **What:** `POST https://<project>.supabase.co/functions/v1/gateway/api/v1/security/erase` with `Authorization: Bearer <stolen JWT>`, `X-Db-Url`/`X-Db-Token` from the victim's own metadata, a valid `X-Signature`/`X-Timestamp`/`X-Nonce` triple (obtainable from the victim's browser via a single XSS, or by simply replaying the victim's own BFF traffic), `Idempotency-Key: <uuid>`, body `{"tutorId":"<victim uid>","confirm":"ERASE"}`.
- **What they get:** `db.batch` at `security.ts:123-134` deletes every row in all 15 `ERASE_TABLES` (`apps/gateway/lib/sql.ts:1207-1223`) — students, ledger, invoices, receipts, attendance, settings. **Irreversible.** The ledger's own append-only trigger does not fire, because `stmtEraseTable` is the sanctioned LEDGER-4 exception. The tutor's month is gone and `audit_log` is deleted too (it is item 14 in `ERASE_TABLES`) — the only surviving trace is the two `security.erase_*` rows written *before* and *after*, which land in a table the cascade has just emptied.

**FIX (specific)**
1. Add a per-request second factor to `handleSecurity`. The cheapest correct option is a **PIN-proof, not a PIN**: have `apps/web/src/lib/crypto.ts` emit `pinProof = HMAC-SHA256(GATEWAY_SHARED_SECRET, `${tenantId}:${pin}`)` and send that instead of the PIN; the gateway recomputes with `hmacVerify` (`apps/gateway/lib/crypto.ts:77`). It never reveals the PIN and needs no Argon2 on the edge.
2. Until that ships, require `x-admin-token` === `GATEWAY_SHARED_SECRET` (or the `GATEWAY_ADMIN_TOKEN`) as a hard precondition on `handleSecurity`, and return 403 without it.
3. If neither is possible in this cycle, **delete the route** (AGENTS.md §0.2). An unguarded delete-everything endpoint is worse than no endpoint.
4. Change `stmtSettingPinPresence` to return a boolean, not the hash, so no code path can be tempted to carry it.

---

### C-2 · CRITICAL · Shared-database fallback inverts the tenant-isolation model

**File:** `apps/web/src/app/api/v1/[...slug]/route.ts:389-395`

```ts
if (!dbUrl || !dbToken) {
  if (TURSO_SHARED_URL && TURSO_SHARED_TOKEN) {
    dbUrl = TURSO_SHARED_URL;
    dbToken = TURSO_SHARED_TOKEN;
    provisionMethod = "shared";
  }
}
```

**Spec violated:** `11_Data_Model.md` §1 (`tenant_id` is "defence-in-depth, **not** the partitioning key"), `10_Security.md` §2, `AGENTS.md` §3.4/§3.6.
**OWASP:** A01 Broken Access Control.

When per-tenant Turso provisioning is unavailable **or errors** (`route.ts:384-386` catches and continues), every tutor is assigned **the same** database. In that state `tenant_id` stops being defence-in-depth and becomes the *only* thing between two tutors' books — and the component that would enforce it (C-3) enforces nothing.

The dangerous property is that this is the **fail-safe-looking** branch: it fires exactly when infrastructure is unhealthy.

The repository's own analysis agrees — `docs/rfc/009-tenant-isolation-invariant.md` §1.2 states verbatim: *"When per-tenant Turso provisioning is unavailable **or errors**, every tutor is pointed at **one shared database** … a Turso API outage becomes a full cross-tenant roster, ledger and settings read."* That RFC is **Status: Draft – Awaiting Security Review**. The defect is known, documented, and **not fixed**.

**Attack scenario**
- **Who:** any tutor, or any attacker who can force a provisioning failure.
- **What:** trigger a Turso provisioning failure (any 5xx from `api.turso.tech` at `route.ts:345-355`, or simply provision while `TURSO_API_TOKEN`/`TURSO_ORGANISATION_SLUG` is unset at `route.ts:342`), then call `POST /api/v1/provision` repeatedly for a set of accounts. All of them receive `db_url = TURSO_SHARED_URL`.
- **What they get:** with a shared client, any query that omits its `tenantId` predicate returns every tenant's rows. Per C-3 the shim does not inject one. Every web query *currently* filters, so the blast radius today is bounded — but the whole safety property rests on ~60 hand-written predicates plus this branch's own luck, not on anything enforced.

**FIX**
Delete the fallback (RFC-009 §3.1 already has owner approval for exactly this):

```ts
// No shared-database fallback. A Turso outage must not silently merge every
// tutor onto one database: tenant_id is defence-in-depth only while the
// physical boundary holds (11_Data_Model.md §1). Fail closed and retry.
if (!dbUrl || !dbToken) {
  return NextResponse.json(
    { success: false, error: "UPSTREAM: database provisioning is unavailable; retry" },
    { status: 503 },
  );
}
```

Then delete `TURSO_SHARED_URL` / `TURSO_SHARED_TOKEN` / the `"shared"` value of `provisionMethod` from `apps/gateway/.env.example` and `apps/web/.env.example`, so the variables cannot be reintroduced by a fallback that no longer reads them.

---

### C-3 · CRITICAL · The web ORM shim has no tenant concept

**File:** `apps/web/src/lib/libsql-proxy.ts:289-320`

```ts
export function createLibsqlProxy(client: SqlHandle): LibsqlProxy {
  const modelProxy = (modelName: string) => {
    ...
    findUnique: async ({ where, select }: any) => {
      const { whereClause, vals } = buildWhereClause(where);
      const res = await execSafe(client, `SELECT * FROM "${tableName}" ${whereClause} LIMIT 1`, vals);
```

`createLibsqlProxy` takes **no tenant**. `buildWhereClause` (`:68-103`) merges only what the caller passed. Nothing injects `tenant_id`, asserts one, or defaults one. `AGENTS.md` §3.6 calls this surface "a contract, not a convenience" — the contract currently contains no tenant clause.

**Verification (as requested):** I read every `db.<model>.*` call site under `apps/web/src/server/**` and `packages/core/src/**`. Current state:

- **Tenant-filtered (correct):** `server/queries/search.ts:97`, `server/attendance-window.ts:166`, `server/queries/sync.ts:17`, and every `server/actions/*.ts` site — `attendance.ts:108,145,732,745,755,849,872,890,984`, `fees.ts:133,156,283`, `students.ts:550,786,824,882`, `settings.ts:57,94,228,287-299,411,606,740,831,864,1012,1025,1094,1109,1181,1231,1302,1332,1452,1473,1508,1671,1731,1779-1782,1814`, `queries/sync.ts`. All of `packages/core/src/engines/{search,reminder,sync,notification}.ts`.
- **Deliberate existence probe (not a leak):** `attendance.ts:112` `db.batch.findFirst({ where: { id: batchId } })` runs *after* the scoped check at `:108` and exists solely to raise `BatchOwnershipError` at `:113`. It reveals only "that id exists somewhere", not its contents. Acceptable.
- **Unscoped and dangerous:** `libsql-proxy.ts:606-610` — `deleteMany()` with no `where` builds `DELETE FROM "<table>"` with **no predicate at all**. Today no caller does this, but the capability is one argument away.

So: the *class* is open, not an active cross-tenant read. The repo agrees — `docs/rfc/009-tenant-isolation-invariant.md` §1.1 lists four historical instances (all since fixed) and says: *"The class is not [closed]: the next unscoped call site is not a bug someone will remember to report, because nothing makes it wrong."*

**Attack scenario**
- **Who:** any future contributor (or a sufficiently motivated agent) adding one call site.
- **What:** write `db.student.findMany({ where: { status: "active" } })` instead of `where: { tenantId, status: "active" }`. Nothing fails. Combined with C-2's shared DB, this returns every tutor's roster to whoever asks.
- **What they get:** full cross-tenant read (and via `deleteMany`/`updateMany`, cross-tenant write) — the highest-severity class named in the audit brief.

**FIX** (RFC-009 §3.2 Change B, owner-approved): bind the tenant into the proxy.

```ts
export function createLibsqlProxy(client: SqlHandle, tenantId: string): LibsqlProxy {
  // ...
  findMany: async ({ where, ...rest } = {}) =>
    // mergeTenant(tenantId, where) throws on a caller-supplied conflicting tenantId
}
```

Make `createLibsqlProxy(client)` without a tenant a **compile error** (`createLibsqlProxy` requires 2 args) so every call site must be updated in the same change. Also make `deleteMany`/`updateMany` throw when `where` is absent.

---

### C-4 · CRITICAL · Unauthenticated RCE in the pinned Next.js version

**File:** `package.json` / `pnpm-lock.yaml` — installed `next@16.2.12`
**Spec violated:** `23_Security_Harness_Plan.md` §12 `G-SEC-1` ("no P0/S1 vuln open"), §11 supply-chain domain.
**OWASP:** A06:2021 Vulnerable and Outdated Components.

`pnpm audit --production` reports (production deps only, 1,204 total):

| Advisory | Severity | Range | Fixed in |
|---|---|---|---|
| [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) — Unauthenticated RCE on windows-hosted servers | **critical** | `>=16.0.0 <16.3.3` | `>=16.3.3` |
| [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) — Unauthenticated RCE in Image Optimization when AVIF is used | **critical** | `>=16.0.0 <16.3.3` | `>=16.3.3` |
| [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) — RCE in `next/og` `ImageResponse` | **critical** | `>=16.2.0 <16.3.6` | `>=16.3.6` |
| [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4) — SSRF in Image Optimization | high | `<16.3.8` | `>=16.3.8` |
| [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676) — cache poisoning of SSG/ISR on self-hosted | moderate | `<16.3.8` | `>=16.3.8` |
| [GHSA-39w2-rjm5-chcv](https://github.com/advisories/GHSA-39w2-rjm5-chcv) — info disclosure, dev-server MCP endpoint | low | `<16.3.8` | `>=16.3.8` |

Both `apps/web` and `apps/product-page` resolve `next@16.2.12`.

**Attack scenario**
- **Who:** any unauthenticated internet user.
- **What:** `POST` to the image-optimization endpoint with a crafted AVIF payload (GHSA-2xp9) — no session, no cookie, no header.
- **What they get:** remote code execution inside the Next.js server process that holds `SUPABASE_SERVICE_ROLE_KEY`, `GATEWAY_SHARED_SECRET`, `TURSO_API_TOKEN` and every tenant's in-flight request. That converts C-1 from "needs a session" to "needs nothing".

**Aggravating factor:** the scanner that would catch this is advisory-only — `.github/workflows/security.yml:93-95`:

```yaml
      - name: Run OSV-Scanner
        run: osv-scanner --lockfile=pnpm-lock.yaml .
        continue-on-error: true
```

The same workflow's gitleaks job (`:61-64`) says explicitly: *"a scan that reports and passes is worse than no scan, because it reads as coverage that does not exist."* OSV-Scanner is exactly that.

**FIX**
1. `pnpm up next@^16.3.8 -r` and commit the lockfile. Do this first; it is a ~5-minute change.
2. Delete `continue-on-error: true` from `security.yml:95`.
3. Add a gate to `web-prod-gate.yml` that fails on any `critical`/`high` OSV entry, with an explicit, dated, spec-cited allowlist for anything that cannot be fixed in the same cycle.
4. Verify the fix against the advisory ranges above, not against a version string.

---

## 3. HIGH FINDINGS

### H-1 · HIGH · GraphQL edge function has no HMAC binding on the database it connects to
**File:** `apps/gateway/graphql/index.ts:408-424`
**Spec violated:** `10_Security.md` §7 request binding; `17_API_Gateway_System.md` §5.
**OWASP:** A10:2021 SSRF; A01 Broken Access Control.

The REST gateway's own comment (`apps/gateway/lib/auth.ts:140-145`) states the invariant this endpoint violates:

> *"Required on **every** method … The binding is what ties the caller-supplied `x-db-url`/`x-db-token` headers to this tenant; skipping it on GET/HEAD meant a read could name any database in the fleet and **the gateway would connect to it**."*

`apps/gateway/graphql/index.ts` is a **separately deployed** Supabase Edge Function. It authenticates the JWT correctly (`index.ts:373`, tenant from verified `sub` at `:391`) — but then:

```ts
// apps/gateway/graphql/index.ts:408-417
const dbUrl   = req.headers.get("x-db-url")   || req.headers.get("X-Db-Url")   || Deno.env.get("TURSO_DATABASE_URL") || "";
const dbToken = req.headers.get("x-db-token") || req.headers.get("X-Db-Token") || Deno.env.get("TURSO_TOKEN")          || "";
```

No signature, no nonce, no timestamp, no binding to `tenantId`. Any authenticated caller — and signup is open — names any `libsql://` / `https://` host and any token they like, and the edge dials it from a Supabase-controlled network position.

**Attack scenario**
- **Who:** anyone with a free account (open `/signup`).
- **What:** `POST /functions/v1/gateway-graphql` with their own JWT, `X-Db-Url: https://internal.target/…`, `X-Db-Token: <anything>`, body `{"query":"{ health }"}`.
- **What they get:** the edge issues the connection from an allowlisted-network vantage point. Row-level leakage is *narrowed* — the resolvers pin `tenant_id = ctx.tenantId` (`index.ts:239-240`, `:288`) and the only resolvers are read-only — but the network-position primitive is not narrowed at all, and it is exactly the hole the REST path closed.

**FIX:** replicate the REST binding in this entrypoint — require `X-Signature`/`X-Timestamp`/`X-Nonce`, verify with `hmacVerify` over `${tenantId}:${dbUrl}:${dbToken}:${timestamp}:${nonce}`, and validate `dbUrl` against a `libsql://` + `*.turso.io` allowlist before dialling. `docs/rfc/008-graphql-audited-builder-unification.md` already tracks the statement unification; fold this in.

### H-2 · HIGH · One secret doing four jobs — no key separation
**File:** `apps/gateway/lib/crypto.ts:24-25`; `apps/web/src/lib/crypto.ts:7`, `:42`

```ts
// apps/gateway/lib/crypto.ts:24-25
const HMAC_SECRET = readSecret("GATEWAY_SHARED_SECRET");
const DATA_KEY    = readSecret("DATA_ENCRYPTION_KEY") || HMAC_SECRET;

// apps/web/src/lib/crypto.ts:7   const p = process.env.PIN_PEPPER || process.env.GATEWAY_SHARED_SECRET || '';
// apps/web/src/lib/crypto.ts:42  const k = process.env.DATA_ENCRYPTION_KEY || process.env.GATEWAY_SHARED_SECRET || '';
```

`GATEWAY_SHARED_SECRET` is simultaneously:
1. the request-signing HMAC key (`crypto.ts:61-75`, verified per-request at `auth.ts:192`);
2. the AES-256-GCM response-encryption master key when `DATA_ENCRYPTION_KEY` is unset (`crypto.ts:25` → `:127-140`);
3. the Argon2id **PIN pepper** when `PIN_PEPPER` is unset (`web/lib/crypto.ts:7` → `hashPin` at `:16-23`);
4. the legacy-backup decryption key when `DATA_ENCRYPTION_KEY` is unset (`web/lib/crypto.ts:42` → `deriveLegacyBackupKey` at `:127-138`).

**Confirmed as instructed:** the line at `crypto.ts:25` does fall back to `HMAC_SECRET`, and `assertSecretStrength` at `:55` explicitly rationalises it as inheriting the HMAC secret's strength. Passing an entropy check is not key separation.

**Attack scenario**
- **Who:** anyone who obtains the signing key by any means — a leaked log line, a compromised CI variable, a read of the Supabase Edge secrets panel, an SSRF (H-1).
- **What:** with `GATEWAY_SHARED_SECRET` alone they can (a) forge valid `X-Signature` headers for **any tenant**, because the signed payload at `auth.ts:191` is `${tenantId}:${dbUrl}:${dbToken}:${timestamp}:${nonce}` and the key is not per-tenant — so the signing key is a fleet-wide impersonation key; and (b) decrypt any PIN-verification hash and any legacy backup.
- **What they get:** every tenant's books, or a tutor's 4-digit PIN.

**FIX:** four independent secrets, each fail-closed with no fallback, generated independently:
`GATEWAY_SIGNING_SECRET`, `DATA_ENCRYPTION_KEY`, `PIN_PEPPER`, `LEGACY_BACKUP_KEY`. Delete every `|| HMAC_SECRET` and `|| GATEWAY_SHARED_SECRET` fallback in the two files. For the PIN pepper specifically, treat rotation as a PIN-invalidation event and say so in `10_Security.md` §3.

### H-3 · HIGH · Globally-fixed batch ids + `onConflict: "id"` upsert = cross-tenant row takeover
**File:** `apps/gateway/provision/index.ts:209`, `:229`, `:281-287`
**Spec violated:** `11_Data_Model.md` §1; `10_Security.md` §2.

```ts
// :209
const bid = s.batch === "Morning Batch" ? "b-morning" : "b-evening";
// :229-235   student_enrollments.insert({ ..., batch_id: bid, ... })
// :281-287
await supabase.from("batches").upsert(
  [ { id: "b-morning", tenant_id: tenantId, ... }, { id: "b-evening", tenant_id: tenantId, ... } ],
  { onConflict: "id" },
);
```

`b-morning` and `b-evening` are **constant strings, not tenant-scoped**. In Postgres, `upsert … onConflict: "id"` on conflict **updates the conflicting row with every column in the payload — including `tenant_id`**. So when tutor N+1 provisions, tutor N's `b-morning` row has its `tenant_id` rewritten to tutor N+1's uid. Tutor N's `student_enrollments` rows (`:229`) still point at `b-morning`, which now belongs to someone else.

This client is constructed with `SUPABASE_SERVICE_ROLE_KEY` (`provision/index.ts:177-180`), which **bypasses Row Level Security entirely** — the only tenant filter in this file is the hand-written `.eq("tenant_id", tenantId)` on the *read* paths (`:190`, `:205`).

**Attack scenario**
- **Who:** any new signup — the attack is the ordinary provisioning path.
- **What:** sign up. Every previous tutor's `b-morning` / `b-evening` row is reassigned to you.
- **What they get:** ownership of batch rows that other tenants' enrollments reference. Whether that is directly readable depends on RLS configuration I could not see (§7), but the data model is already corrupted for every prior tenant, and their enrollments now dangle across a tenant boundary.

**FIX:** namespace the id per tenant — `const bid = \`${tenantId.slice(0,8)}-${slug}\`` — and change the upsert to `{ onConflict: "id", ignoreDuplicates: true }` so an existing row is never re-owned. Same for any other fixed identifier in the file.

### H-4 · HIGH · Remote import map + caret ranges: the gateway build is not reproducible
**File:** `apps/gateway/deno.json:6-13`
**Spec violated:** `23_Security_Harness_Plan.md` §6 supply-chain domain; `AGENTS.md` §9.1.
**OWASP:** A08:2021 Software and Data Integrity Failures.

```json
"import_map": "https://esm.sh/import_map.json",
"imports": {
  "@libsql/client": "npm:@libsql/client@^0.14.0",
  "@supabase/supabase-js": "npm:@supabase/supabase-js@^2",
  "zod": "npm:zod@3.24.2"
},
```

The gateway resolves its import graph through a **remote, third-party-hosted import map fetched at build/deploy time**, and two of the three entries are **caret ranges** resolved at build time. There is no lockfile for the Deno build. Two builds of the same commit can produce different bundles.

Worse, `@libsql/client@^0.14.0` here vs `@libsql/client@0.17.4` in the web tree (per `pnpm-lock.yaml`) is a **0.x minor drift**, which under semver is a breaking change — and it spans the exact boundary `AGENTS.md` §3.5 warns about ("the I/O differs; the money must not").

**Attack scenario**
- **Who:** whoever controls `esm.sh`, or anyone who can MITM/DNS-hijack the deploy-time fetch.
- **What:** serve a different `zod` or `@supabase/supabase-js` version to the gateway deploy.
- **What they get:** arbitrary code inside the gateway isolate, which holds `SUPABASE_SERVICE_ROLE_KEY`, `GATEWAY_SHARED_SECRET` and `GATEWAY_ADMIN_TOKEN`, and fronts every tenant DB.

**FIX:** vendor a checked-in `apps/gateway/import_map.json`, pin exact versions (`npm:@libsql/client@0.17.4`, matching the web tree), and set `"nodeModulesDir": "manual"` with a Deno `lock` file committed. Then unify the libsql version across the two dialects per `AGENTS.md` §3.5.

### H-5 · HIGH · Dependency audit is advisory-only while the secrets scan is a hard gate
**File:** `.github/workflows/security.yml:93-95`, `:118-120`, `:133-140`
**Spec violated:** `23_Security_Harness_Plan.md` §12 `G-SEC-1`.
**OWASP:** A06 Vulnerable Components.

Three of five jobs in the security workflow cannot fail the build: OSV-Scanner (`:95`), license-checker (`:120`), and SBOM (`:140`) all carry `continue-on-error: true`. Only gitleaks and semgrep are hard gates. This is how three **critical** unpatched advisories (C-4) sit in `main`.

Note also the inconsistency *within* the workflow: gitleaks is downloaded with a SHA256 pin and the comment says pinning CI to immutable references "would undercut that in the very step that feeds the gate" (`:40-43`) — but the OSV-Scanner binary at `:90-91` is `curl`'d with **no checksum at all**:

```yaml
curl -L https://github.com/google/osv-scanner/releases/download/v1.9.1/osv-scanner_linux_amd64 \
  -o /usr/local/bin/osv-scanner
chmod +x /usr/local/bin/osv-scanner
```

and the SBOM step at `:138` runs `npx --yes @cyclonedx/cyclonedx-npm@latest` — an unpinned package pulled from the registry at CI time, by a workflow with repository write scope.

**FIX:** (1) remove `continue-on-error` from the OSV step and add a spec-cited, dated allowlist file instead; (2) SHA256-pin the osv-scanner download exactly as gitleaks is pinned; (3) pin cyclonedx to an exact version, or drop the `npx` fallback.

### H-6 · HIGH · The 15-attempt lockout on the gateway is unreachable code
**File:** `apps/gateway/index.ts:277-281`

```ts
const authCheck = trackFailedAuth(tenantId);
if (authCheck.locked) { return addSecurityHeaders(req, securityFail(429, requestId), requestId); }
clearFailedAuth(tenantId);
```

`authenticateRequest` **throws** on every failure (`lib/auth.ts:41,54,67,72,77,105,117,127,149,161,168,176,196`), so `index.ts:274` either returns or jumps to the `catch`. Line 277 is therefore reachable **only on a successful authentication**, and line 281 deletes the counter that `trackFailedAuth` (`lib/security.ts:342-356`) just incremented. `entry.count` can therefore never exceed 1, `count >= 15` is unreachable, and `locked` is **always `false`**.

The `__tests__/security.test.ts:317-350` lockout tests exercise `trackFailedAuth` directly and pass — they test the function, not the wiring.

**Attack scenario**
- **Who:** anyone brute-forcing a gateway credential.
- **What:** issue unlimited requests.
- **What they get:** no lockout. `trackFailedAuth` provides the appearance of one.

**FIX:** move the tracking into the failure path of `authenticateRequest` (increment on throw), and clear it only on success — i.e. invert lines 277-281. Add an integration test that drives N real HTTP requests through `Deno.serve` and asserts the 429 on the 15th.

### H-7 · HIGH · `packages/security` is a fully orphaned duplicate of the product's crypto
**File:** `packages/security/src/{argon2id,backup-envelope,tamper-hash,audit-chain,panic}.ts`
**Spec violated:** `AGENTS.md` §0.2 (no orphan code), §3.5 ("a second copy of it is a P0 defect"), §3.6.
**OWASP:** A04 Insecure Design (divergent security implementations).

Verified: `@buddysaradhi/security` is imported by **nothing**. The only reference outside the package is a comment in `apps/web/src/lib/ledger/tamper-check.ts:50` explaining that it deliberately does *not* pull the package in.

The package therefore ships a second Argon2id implementation, a second backup envelope, a second tamper-hash, a second audit-chain, and a panic-PIN module whose crypto is a hardcoded placeholder:

```ts
// packages/security/src/panic.ts
function cryptoPlaceholder(): string { return "00000000-0000-0000-0000-000000000000"; }
```

Its own header says *"Compile-only scaffold — runtime wire-up deferred to RFC sub-RFC #7"*. `10_Security.md` §3.6 specifies the panic PIN as a real control (and `:104` adds the PANIC-1 invariant that entering it must **not** write to `audit_log`). **That control does not exist in the product.** `10_Security.md` §3.6 describes a capability that is only a type declaration.

**Attack scenario**
- **Who:** any tutor who believes they have a panic PIN.
- **What:** nothing — the feature is inert.
- **What they get:** a false sense of a coercion defence the threat model claims exists. In a product holding a minor's personal data, an advertised-but-absent duress control is a material misrepresentation.

**FIX:** either wire `packages/security` into the product this cycle (panic PIN + a single shared envelope/tamper implementation, deleting the duplicates in `apps/web/src/lib/crypto.ts` and `apps/web/src/lib/ledger/tamper-check.ts`), or delete the package and amend `10_Security.md` §3.6 to state the panic PIN is not implemented. Do not leave both.

---

## 4. MEDIUM FINDINGS

### M-1 · `run()` retries a failed statement against the environment-configured database
**File:** `apps/gateway/lib/sql.ts:182-183`
```ts
try { return await directPipelineExecute(sql, args); }
```
`directPipelineExecute(sql, args)` is called with **no `dbUrl`/`dbToken`**, so `resolveTursoUrl(undefined)` (`:49-58`) falls back to `Deno.env.get("TURSO_DATABASE_URL")` and `resolveToken(undefined)` (`:65-77`) to `TURSO_AUTH_TOKEN`. When a statement fails against tenant A's database for any reason (a renamed column, a constraint violation, a transient driver error), the identical statement — including any `INSERT`/`UPDATE` — is re-executed against whatever database the environment points at. If `TURSO_DATABASE_URL` is set (it is a documented dev/preview/staging path per `apps/web/src/lib/db.ts:140-141`), that is the wrong database. The comment at `:174-181` correctly protects transaction atomicity but says nothing about tenant targeting.
**Spec:** `11_Data_Model.md` §1; `AGENTS.md` §3.4. **OWASP:** A01.
**Attack scenario:** Who — an attacker who can induce a statement failure (e.g. a value that trips a UNIQUE constraint) on their own tenant. What — the write lands in the shared env-configured DB. What they get — a write outside their tenant, or (if the env DB is the shared one, per C-2) into a multi-tenant table.
**FIX:** thread the tenant's `dbUrl`/`dbToken` through `SqlHandle` so the fallback can only ever target the same database, or delete the HTTP-pipeline fallback entirely and let the error propagate (Rule 9 prefers loud).

### M-2 · Gateway IP rate limit is bypassable via `x-forwarded-for`
**File:** `apps/gateway/lib/security.ts:117-124`, `:194-210`, `:398-400`
`getClientIp` prefers `cf-connecting-ip` then `x-forwarded-for` then `x-real-ip`. The `dangerousHeaders` strip-list at `:194-203` deletes `x-forwarded-host`, `x-host`, `x-real-ip`, `x-remote-ip`, `x-remote-addr`, `x-cluster-client-ip`, `forwarded-for`, `forwarded` — but **not `x-forwarded-for`**. `checkIpRateLimit(clientIp)` (`:399`) is therefore keyed on a header the caller controls unless the edge platform rewrites it.
**Spec:** `10_Security.md` §3 AUTH-1; `23_Security_Harness_Plan.md` §6. **OWASP:** A04.
**Attack scenario:** Who — anyone probing the gateway. What — rotate `x-forwarded-for` per request. What they get — `IP_RATE_LIMIT_MAX` (100/min) never trips; combined with the dead lockout (H-6), the only remaining brake is the per-tenant limit, which resets per isolate (M-4).
**FIX:** add `"x-forwarded-for"` to `dangerousHeaders`, and derive the rate-limit key from `cf-connecting-ip` only, rejecting the request when none is present.

### M-3 · Tenant DB credential is trusted from `user_metadata` with no URL validation
**File:** `apps/web/src/lib/db.ts:153-178`; consumed at `apps/web/src/server/get-db.ts:79-86` and `:232-239`
```ts
// apps/web/src/lib/db.ts:161-163
if (metaUrl && metaToken && !isDummyUrl(metaUrl)) {
  return { dbUrl: metaUrl, dbToken: metaToken };
}
```
There is no scheme check, no host allowlist, and no check that the URL is one this app provisioned. `isDummyUrl` (`:129-133`) only rejects three sentinel substrings. `normalizeLocalDbUrl` (`:43-48`) actively accepts `file:` paths. The returned URL goes straight into `createClient({ url, authToken })` at `db.ts:63`, from **inside the Next server**, and into the HMAC-signed `X-Db-Url`/`X-Db-Token` pair at `get-db.ts:240-252`.
The app itself only ever writes these fields with the service-role key (`app/api/v1/[...slug]/route.ts:401-409`), which is correct. The exposure is that **Supabase's `user_metadata` is, by platform default, writable by the authenticated user** via `supabase.auth.updateUser({ data: {...} })`. I could not verify this project's Supabase column-level privileges from the tree (§7), so this is rated High-impact/Medium-confidence rather than Critical — but the in-tree mitigation is missing either way.
**Spec:** `11_Data_Model.md` §1; `AGENTS.md` AP-12 (`db_url`/`db_token` are credentials, never client state). **OWASP:** A04, A10 SSRF.
**Attack scenario:** Who — a tutor whose session is stolen, or anyone who can write `user_metadata`. What — set `db_url` to `https://attacker.example`; the server then issues libSQL pipeline requests carrying the full tenant SQL and student PII, with `Authorization: Bearer <dbToken>` (`sql.ts:117-136`). What they get — SSRF from the web server's network position plus exfiltration of the roster.
**FIX:** (1) in `getDbCredentials`, require `metaUrl` to match `/^libsql:\/\/[a-z0-9-]+\.(turso\.io|turso\.ai|cloudflare\.com)\b/` and reject anything containing `file:` or `@`; (2) bind `db_token` to a server-side record keyed by `user.id` rather than to client-writable metadata.

### M-4 · Replay and rate-limit state is per-isolate in-memory
**File:** `apps/gateway/lib/security.ts:59-60`, `apps/gateway/lib/crypto.ts:205`
```ts
const nonceCache = new Map<string, number>();          // security.ts:59
const rateLimitMap = new Map<string, RateLimitEntry>(); // crypto.ts:205
```
Both are module-level `Map`s. On Supabase Edge Functions / Deno Deploy, isolates are numerous and independently recycled. A nonce recorded in isolate A is unknown to isolate B, so **a captured signed mutation can be replayed across isolates** within the 120 s timestamp window (`auth.ts:179-187`). Per-tenant and per-IP rate limits reset per isolate for the same reason. `23_Security_Harness_Plan.md` §6/§10 already prescribes Cloudflare Durable Objects / Upstash as the rate-limit authority; this is that gap unimplemented.
**Spec:** `10_Security.md` §7; `23_Security_Harness_Plan.md` §9 gateway domain. **OWASP:** A04.
**Attack scenario:** Who — an attacker who captures one signed mutation (a proxy, a misconfigured log, a shared egress). What — replay it repeatedly across isolates. What they get — duplicated payments/attendance marks; `Idempotency-Key` mitigates this on mutating REST routes (`index.ts:326-344`) but **not** on `POST /graphql` (`index.ts:326` exempts it).
**FIX:** move the nonce cache and the rate limiter to a shared store (DO/Upstash/Redis) keyed by `${tenantId}:${nonce}` with SETNX, as `23_Security_Harness_Plan.md` §10 already specifies.

### M-5 · Response encryption is advertised but never performed
**File:** `apps/gateway/lib/errors.ts:212-218`; `apps/gateway/lib/crypto.ts:106-153`; `apps/gateway/lib/errors.ts:47`
`json(data, status, encrypt)` and `ok(data, status, encrypt)` take an `encrypt` flag, and `CORS_HEADERS` at `errors.ts:47` advertises `x-encrypt-response` to browsers. **No call site in the gateway passes `encrypt = true`** (verified by search), and **no route reads `x-encrypt-response`**. `encryptResponse` is reachable only from `errors.ts:213`; `decryptRequest` (`crypto.ts:155`) is called from nothing but its own test. The `DATA_ENCRYPTION_KEY` bootstrap gate at `crypto.ts:107-123` protects a code path that never runs.
**Spec:** `10_Security.md` §8. **OWASP:** A02 Cryptographic Failures.
**Attack scenario:** Who — anyone on-path to the gateway (or anyone reading a proxy log). What — nothing stops them; every response is cleartext JSON with names, phones, balances. What they get — the PII the documented control claims to protect.
**FIX:** either honour `x-encrypt-response` in `index.ts` (encrypt the body when the header is present, using a key derived per-tenant rather than the fleet secret), or remove the flag, the header, and the `DATA_ENCRYPTION_KEY` boot gate so the documented control matches reality.

### M-6 · `DATA_KEY` derivation is a 310k-iteration PBKDF2 with a fresh random salt per call
**File:** `apps/gateway/lib/crypto.ts:125-140`, `:177-190`
The key is derived per operation from a high-entropy secret with a **new random 16-byte salt every time** (`:125`) and 310,000 PBKDF2 iterations (`:135`). A random salt per call makes key caching impossible, so every `encryptResponse` pays the full KDF cost. PBKDF2 is also the wrong tool for a high-entropy secret — HKDF is. (Moot while M-5 stands, since the path is dead — fix together.)
**Spec:** `10_Security.md` §8. **OWASP:** A02.
**FIX:** if M-5 is fixed, import the `DATA_KEY` directly as an AES-GCM key (`crypto.subtle.importKey('raw', …, 'AES-GCM', false, ['encrypt','decrypt'])`) and drop PBKDF2 entirely.

### M-7 · Legacy backup PBKDF2 is 100,000 iterations
**File:** `apps/web/src/lib/crypto.ts:127-138`
```ts
crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, …)
```
Decrypt-only for pre-Argon2id files (documented, deliberate, `:85-92`). 100k SHA-256 is below the current OWASP guidance (~600k for PBKDF2-SHA256) and well below what an offline attacker with a stolen file can afford.
**Spec:** `09_Backup_and_Import_Export.md` §10.1, EC-RV-03. **OWASP:** A02.
**Attack scenario:** Who — an attacker with a stolen legacy `.buddysaradhi` file. What — offline PBKDF2 at 100k. What they get — a materially cheaper brute force than the current envelope's Argon2id m=64MiB t=3 p=2 would give.
**FIX:** raise to 600,000 for new *legacy* reads where a version byte permits, and accelerate the migration: after any successful restore, re-issue the backup on the Argon2id envelope (already intended per `crypto.ts:90-92`; make it enforced, not advisory).

### M-8 · `resolveTursoUrl` accepts arbitrary `http://` and `https://` hosts
**File:** `apps/gateway/lib/sql.ts:38-48`
```ts
if (url && (url.startsWith("libsql://") || url.startsWith("https://") || url.startsWith("http://")) && !url.includes("supabase.co") && …) return url;
```
Plain `http://` is accepted, and `https://` is accepted for **any** host. Combined with M-3 / H-1 (caller-supplied `dbUrl`), this is an SSRF sink: `directPipelineExecute` will `fetch(`${host}/v2/pipeline`)` (`:117`) with a caller-chosen `Authorization: Bearer <caller token>`.
**Spec:** `10_Security.md` §7; `AGENTS.md` FM-06. **OWASP:** A10.
**FIX:** require `libsql://` (or `https://`) **and** a `*.turso.io` / `*.turso.ai` host suffix; reject everything else with a typed error.

### M-9 · Central PII store contradicts the "no central store" sovereignty claim
**File:** `apps/gateway/provision/index.ts:170-291`
This Edge Function writes a full copy of tenant data — student names, phone numbers, email addresses, schools, grades, invoices and **ledger rows** — into shared **Supabase Postgres** using `SUPABASE_SERVICE_ROLE_KEY` (`:177-180`, which bypasses RLS). `10_Security.md:545` tells tutors: *"No data leaves India if the tutor picks the Mumbai Turso region"* and §1.2 of `AGENTS.md` promises one sovereign DB per tutor. A second, company-controlled, centrally-shared store of that same data is not covered by that promise and is not in the threat model. It also runs **demo seeding in production** (`:12-167`): 14 students with fabricated phone numbers and `@example.com` emails, plus `ledger_entries` rows (`:251-278`) written with **no `prev_hash`/`this_hash`** and lowercase `type: "fee"` / `"payment"`, where every other code path uses uppercase (`FEE_CHARGED` — `apps/web/src/server/actions/settings.ts:606`) and `stmtInsertLedgerEntry` (`sql.ts:840-844`) **throws** if `thisHash` is absent.
**Spec:** `10_Security.md` §1/§19; `AGENTS.md` §1.2 single-tenant table; BR-LED-06. **OWASP:** A04.
**Fix:** gate demo seeding behind `NODE_ENV !== "production"`; if the Postgres copy is intentional, add it to `10_Security.md` as a processor store with its own retention, encryption-at-rest and RLS story and a DPDP processor-agreement note; fix the ledger `type` casing and either populate the hash chain or exclude these rows from the chain by contract.

### M-10 · DPDP 2025: the incident-response artefacts the gate depends on do not exist
**Files:** `23_Security_Harness_Plan.md:612`, `:632`, `:809` (G-SEC-6); `docs/` (verified)
`23_Security_Harness_Plan.md` lists as **blocking** deliverables:
- `docs/runbooks/incident-response.md` — *"(NEW)"*, DPDP-aware, five-phase runbook (`:612`, `:619`, `:632`);
- `pii-inventory.test.ts` — the PII inventory with per-field retention (`:809` G-SEC-6).

**Neither exists.** `Test-Path docs/runbooks` → `False`; a recursive search for `pii-inventory*` returns nothing. The only PII inventory that exists is a **table in the spec** (`10_Security.md:359-374`), which is not machine-checkable.
Related DPDP gaps, all verified:
- **No consent artefact.** `apps/web/src/components/settings/about-section.tsx:84` states in-product: *"There is no terms of service or privacy manifest in this build, so there is no link to [one]."* Signup (`app/(auth)/signup/page.tsx`) collects no consent artefact. DPDP §6 requires a lawful-purpose notice; `10_Security.md:545` claims *"Consent + purpose limitation (tutoring)"*.
- **No breach runbook, no on-call, no intimation path.** DPDP Rule 7 (Data Protection Board + Data Principals) has no code, doc, or owner.
- **Log/PII retention is "Indefinite" with no purge.** `10_Security.md:374` lists `audit_log` (`action`, `actor`, `metadata`) as **Indefinite** retention. Verified: the only implemented purge is `purgeExpiredIdempotencyKeys` (`apps/gateway/lib/idempotency.ts:121-125`). Nothing prunes `audit_log`, `sync_outbox`, or `notifications`. DPDP storage-limitation is unmet and the rows contain identifiers and operational metadata.
- **No data-residency enforcement.** `10_Security.md:545` says residency holds *"if the tutor picks the Mumbai Turso region"*. Turso hostname construction at `app/api/v1/[...slug]/route.ts:378` hardcodes `aws-ap-south-1` for the fallback path and accepts whatever the API returns for the primary path; there is no residency assertion, no user-visible region choice, and no record of which region a tutor's data landed in.

**Attack scenario (regulatory, not technical):** Who — the Data Protection Board, or a parent exercising a right. What — a breach occurs (C-1 makes this credible). What they get — no runbook, no 72h/ASAP clock, no intimation artefact, no consent record, and an audit log that is both "indefinite" and deleted by the incident itself.
**FIX (ordered):** (1) write `docs/runbooks/incident-response.md` with the dual DPDP/ICO track and a named on-call; (2) add `pii-inventory.test.ts` asserting every PII column is listed with a retention; (3) implement an `audit_log` retention job with a documented default (e.g. 24 months) and a tutor-configurable override; (4) ship a privacy notice + explicit consent checkbox at signup; (5) record `turso_region` in `user_metadata` at provisioning and surface it in Settings → Data Privacy.

### M-11 · CSP `connect-src` does not match the policy AGENTS.md declares
**File:** `apps/web/src/proxy.ts:221` vs `AGENTS.md` §2 Rule 2
`AGENTS.md` §2 Rule 2 states the enforced policy is:
> `connect-src 'self' https://sync.buddysaradhi.app https://update.buddysaradhi.app`

Shipped: `connect-src 'self' https://*.supabase.co https://*.turso.io https://*.turso.ai https://api.buddysaradhi.app` (plus loopback `ws://` in dev). The two named origins are **absent**; three wildcard or gateway origins are **present** and were never in the declared allowlist. The constitution and the code disagree, and nobody noticed — which means the declared control is not the enforced control.
**Spec:** `AGENTS.md` §2 Rule 2. **OWASP:** A05 Security Misconfiguration.
**FIX:** amend Rule 2 to name the real allowlist (or narrow the CSP to it), and add a test asserting `proxy.ts` and `AGENTS.md` §2 name the same set — the same way `route.bff.test.ts` already pins the two CORS resolvers together.

### M-12 · L6 `no-raw-sql` coverage is materially narrower than its documentation claims
**File:** `scripts/principle-lints.ts:299-379`
`AGENTS.md` §3.4 claims L6 is a P0 CI gate that "auto-blocks" raw SQL. Gaps, all verified:

1. **Scope.** `L6_PREFIXES` (`:299-306`) covers only `apps/web/src/`, `packages/shared/src/`, `packages/core/src/`, `apps/gateway/{routes,graphql,lib}/`. **Not covered:** `apps/services/` (7 microservices incl. `auth-svc`, `ledger-svc` — and `L1_ALLOW:179-183` already cites `apps/services/auth-svc/src/index.ts` for a `DROP TRIGGER` / `DELETE FROM ledger_entries`), `apps/product-page/`, `apps/gateway/index.ts`, `apps/gateway/provision/index.ts`, `supabase/functions/`, `scripts/`, `migrations/`.
2. **Indirection defeats it.** Pattern `\.(execute|batch)\s*\(\s*[\`'"]` (`:317-319`) requires a string literal *immediately* after the paren. `const q = build(); client.execute(q)` is invisible. Only `sql: \`` (`:313-315`) catches the property-name form.
3. **Multi-line SQL evades it.** The backtick/double/single-quote patterns (`:321-331`) are applied per line (`text.split("\n")` at `:718`). A template literal spanning lines matches nothing.
4. **Test files are excluded wholesale** (`exclude: [/\.test\.tsx?$/, /\.spec\.tsx?$/]`, `:461`).
5. **110 allowlisted hits** on a clean run — every one is a place where the rule is switched off.

**Spec:** `AGENTS.md` §3.4. **OWASP:** A03 Injection.
**Attack scenario:** Who — a contributor adding a raw query. What — write it multi-line, or assign to a variable first, or put it under `apps/services/`. What they get — a P0 bypass with a green gate.
**FIX:** (a) add `apps/services/`, `apps/gateway/index.ts`, `apps/gateway/provision/`, `apps/product-page/src/`, `supabase/functions/` to `L6_PREFIXES`; (b) add a dataflow-ish pattern for `\.execute\(\s*[A-Za-z_$][\w$]*\s*\)` outside the audited modules; (c) normalise multi-line template literals before pattern-matching (collapse the file, then match); (d) print the allowlist count in CI output and fail above a pinned budget.

### M-13 · GraphQL resolver guard is satisfiable by request variables
**File:** `apps/gateway/graphql/executor.ts:115`; `apps/gateway/graphql/index.ts:331`
```ts
const value = await resolver({ ...f.args, ...variables }, ctx);
```
`variables` **overwrites** field arguments. Each resolver then guards `if (args.tenantId !== ctx.tenantId) throw` (`resolvers.ts:28,68,101`). Today this is safe because `ctx.tenantId` comes from the verified JWT (`index.ts:391`) and every statement pins it (`sql.ts:1261-1312`), so a caller can only ever satisfy the guard *with their own id* — the file's own comment (`index.ts:382-389`) records that this exact pattern was the previous cross-tenant bug.
It is nevertheless a fragile shape: the guard reads as though `args.tenantId` is attacker-meaningful, and the next resolver author who treats it as such (or who reads `ctx.tenantId` instead) reintroduces the bug.
**Spec:** `10_Security.md` §7. **OWASP:** A01.
**Fix:** delete the per-resolver `args.tenantId` guard entirely and have the resolvers use only `ctx.tenantId` (which is what they already do for the SQL). One way to be right beats two that must agree.

### M-14 · `getCacheResponse` / `X-Cache-Key` leaks the tenant id and query string
**File:** `apps/gateway/index.ts:168`, `:309`
```ts
return `gw:${tenantId}:${path}:${qs}`;
…
cached.headers.set("X-Cache-Key", cKey);
```
The cache key — containing the tenant's uid, the path and the full query string, including any search term — is echoed to the client on every cache hit.
**Spec:** `10_Security.md` §8 (no durable ids in responses/logs). **OWASP:** A04.
**Fix:** drop the header, or replace it with `X-Cache: HIT|MISS` (already set at `:400`).

### M-15 · Empty `catch` in the gateway logger
**File:** `apps/gateway/lib/log.ts:42-49`
```ts
try { Deno.stdout.writeSync(…); } catch {
  // Silently fail if stdout is not available
}
```
An empty catch with a comment, in the one module every log line passes through. `AGENTS.md` §2 Rule 9 names `no-empty-catch` as an enforcement mechanism; this one has a body comment, so whether it trips depends on the rule's shape.
**Fix:** route the failure to `Deno.stderr` (never silently), or make the lint rule reject comment-only catches.

### M-16 · `admin_users` and `app_state` are reachable through the web shim with no tenant column
**File:** `apps/web/src/lib/libsql-proxy.ts:314-315`, `:606-610`; `prisma/schema.prisma`
```ts
// libsql-proxy.ts:315
adminUser: "admin_users",
```
Verified against the schema: 21 of 23 models carry `tenantId`; **`StudentTag`** (a join table, acceptable) and **`AdminUser`** do not. `AdminUser` is therefore a **global** table reachable through the per-tenant ORM surface, and `deleteMany()` with no `where` (`:606-610`) would delete from it unscoped. No current caller does this (verified across `apps/web/src/server/**`), so this is capability-not-exploit.
**Spec:** `11_Data_Model.md` §1 (`tenant_id` on all tables); `AGENTS.md` §3.4.
**Fix:** remove `adminUser` from the shim's `tableMap` (admin access has its own RFC — `docs/rfc/010-admin-access-model.md`), and make `deleteMany`/`updateMany` throw on a missing `where`.

---

## 5. LOW FINDINGS

| # | Sev | File:line | Finding | Spec | Fix |
|---|---|---|---|---|---|
| L-1 | Low | `apps/web/src/proxy.ts:218` | `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` — `unsafe-inline` on styles. CSS injection surface (e.g. via any un-escaped tutor-authored string rendered as a style attribute). | `10_Security.md` §6 XSS-1 | Move to a per-request nonce like `script-src` already has (`:215-216`); self-host the fonts to drop the external origin. |
| L-2 | Low | `apps/gateway/lib/errors.ts:53-59` | `PRODUCTION_CORS_ORIGINS` hardcodes `https://buddysaradhi.vercel.app` and `https://buddysaradhi-product.vercel.app` into **every** environment with `Access-Control-Allow-Credentials: true` (`:115`). Any XSS on the marketing site becomes a credentialed read of tutor data. | `10_Security.md` §6 CORS-1 | Load the list from `ALLOWED_ORIGINS` only; keep no built-in production origins. |
| L-3 | Low | `apps/gateway/provision/index.ts:170-291` | The provisioning function is reachable with **only** a valid JWT — no rate limit, no idempotency key. Open signup ⇒ unbounded writes of 14 students + 28 ledger rows per account into shared Postgres. | `23_Security_Harness_Plan.md` §10 | Add a per-tenant rate limit and make the seeding path idempotent on `(tenant_id, code)`. |
| L-4 | Low | `apps/web/src/server/pin-lockout.ts:10-14` | The file's own header records an unrepaired spec conflict: `10_Security.md` §3.5 specifies 3→60s / 4→120s / 5→240s / 6+ exponential / wipe at 10 cumulative, while the implementation follows 5→30s / 10→5min / 15→wipe per `02_Core_Logic.md` §12.4 + BR-SEC-03. Spec drift in a security control. | `22_Redundancy_Audit.md` §5 precedence | Open the spec-repair RFC the comment asks for; amend `10_Security.md` §3.5 to the majority contract. |
| L-5 | Low | `apps/gateway/index.ts:261-272` | `x-db-url`/`x-db-token` fall back to `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` env when the headers are absent. On a deployment where those env vars are set, **every** tenant resolves to the same database unless the client supplies headers. | `11_Data_Model.md` §1 | Make the header mandatory once a session exists — the same `getDbCredentials` rule the web already follows (`apps/web/src/lib/db.ts:165-168`). |
| L-6 | Low | `apps/web/src/server/get-db.ts:487` | A production Supabase project ref (`gmqwdnvbfnwpzpctwvho`) is hardcoded as `SUPABASE_GATEWAY_URL`, used when `GATEWAY_URL` is unset/misconfigured (`:490-491`). Leaks the project ref and silently routes prod traffic to a hardcoded target. | `AGENTS.md` FM-06 | Fail closed when `GATEWAY_PRODUCTION_URL` is unset in production, exactly as `resolveSharedSecret` does (`get-db.ts:124-131`). |
| L-7 | Low | `apps/gateway/__tests__/security.test.ts:317-350` | The lockout tests call `trackFailedAuth` **directly**, so they pass while the wiring is dead (H-6). A green test asserting a control that is not wired is worse than no test. | `AGENTS.md` §7.1 | Replace with an end-to-end test through `Deno.serve`. |

---

## 6. AREAS VERIFIED CLEAN

A clean area is a result. The following classes were searched for exhaustively and **no exploitable defect was found**.

| Class | How verified | Result |
|---|---|---|
| **Credentials in the tracked tree** | Scanned every git-tracked text file for `sk-*`, JWTs, `-----BEGIN … PRIVATE KEY-----`, `AKIA*`, and literal `SUPABASE_SERVICE_ROLE_KEY=` / `TURSO_AUTH_TOKEN=` / `GATEWAY_SHARED_SECRET=` assignments. | **Clean.** The only hits are test fixtures and comment text: `packages/shared/src/redact.test.ts:27,93,97`; `.gitleaks.toml:29,38,75`; `.agent/skills/…/implementation-playbook.md:214`. Both real secret files on disk — `apps/gateway/.env` and `supabase/functions/gateway/.env` — are **gitignored** (`.gitignore:117`, confirmed via `git check-ignore -v`) and were not committed. `apps/gateway/.env.example` is the only tracked env file. |
| **Telemetry / analytics SDKs (Rule 3)** | `scripts/principle-lints.ts` L3 over every `package.json`, all four dependency sections. | **Clean**, 0 findings. |
| **`fetch()` in Client Components (Rule 2 / FM-05)** | L4 over all `apps/web/src/**` `"use client"` modules. | **Clean** — only 2 allowlisted first-party `/api/v1/provision` calls (`use-auto-provision.ts`, `signup/provision/page.tsx`), both spec-cited. |
| **SQL injection in the gateway builders** | Read `apps/gateway/lib/sql.ts:282-1312` end to end. | **Clean and genuinely well-built.** Every value goes through `?` + args (`:444`, `:480`, `:553-562`). Every identifier goes through `TableNameSchema` (`:284-301`), `ColumnRefSchema` (`:328`) or a named sort allowlist (`:503-516`). Every input is Zod-validated. `buildTenantWhere` (`:416-489`) **fail-closes** on an unrecognised operator shape rather than degrading (`:455-460`), and `RANGE_CLAUSE` is a frozen map so no operator *name* can ever come from a request (`:370-375`). `stmtDeleteWhere`/`stmtUpdateWhere` refuse `ledger_entries` outright (`:592-596`, `:613-615`). |
| **Ledger append-only (Rule 1)** | L1 across all `.ts`/`.sql`. | **Clean in product code.** Zero `db.ledgerEntry.update/delete` outside the two audited secure-erase cascades (`apps/web/src/server/actions/settings.ts`, `packages/core/src/engines/security.ts`) and one test. `apps/gateway/lib/sql.ts:592-596` and `:613-615` make the rule structural, not conventional. (M-9 notes a *different* store receiving hash-less ledger rows.) |
| **Integer paise (Rule 6 / BR-M-01)** | L2 over all code + a structural parse of `prisma/schema.prisma`. | **Clean.** **No `Float` or `Decimal` column anywhere in the schema.** `stmtInsertInvoice` (`sql.ts:798-807`) throws unless every money column `Number.isSafeInteger`. `stmtSyncStudentBalance` (`sql.ts:1160-1162`) does the same. |
| **`.buddysaradhi` backup envelope (Rule 8)** | Read `apps/web/src/lib/crypto.ts` end to end. | **Compliant with the byte table.** Magic `BSR1` + `format_version 0x01` + `salt(16)‖nonce(12)‖tag(16)‖ct` (`:79-84`); Argon2id `m=65536 KiB, t=3, p=2, len=32, v0x13` (`:106-116`) — exactly Rule 8; AES-256-GCM with a 12-byte nonce (`:141`); **no pepper, no server escrow** (`:100-104`, BACKUP-1); passphrase mandatory on encrypt (`:162-164`); key material zeroed in a `finally` (`:117-123`); truncated/tampered input distinguished (`E_BAD_MAGIC`, `E_VERSION_AHEAD`, `E_WRONG_PASSPHRASE`); legacy decrypt-only path retained so a KDF upgrade is never data loss (`:85-92`). |
| **PIN hashing** | `apps/web/src/lib/crypto.ts:15-34`. | **Correct.** Argon2id, `m=65536, t=3, p=2, len=32`, with a server-side pepper, non-extractable. `verifyPin` returns `false` on any throw rather than propagating (`:31-33`) — correct for a verify path. |
| **The PIN lockout ladder itself** | `apps/web/src/server/pin-lockout.ts` + `settings.ts:122-177`. | **Correct and durable.** The count is derived from consecutive `pin_failed` **audit rows in the database**, not an in-memory counter — so it survives a process restart and is per-tenant. 5→30s, 10→5min, 15→wipe; a successful verify resets. The gateway's lockout is the broken one (H-6), not this. |
| **`ALLOW_DEV_AUTH` reachability in production** | Read `apps/gateway/lib/env.ts:60-66` and both call sites. | **Cannot be reached on a deployed gateway.** Three independent conditions must all hold: `ALLOW_DEV_AUTH === "true"` **and** `!isDeployed()` **and** the JWT literally starts with `mock-token-` (`auth.ts:50`). `isDeployed()` (`:29-33`) is the **strict** form (`DENO_DEPLOYMENT_ID` **or** `DENO_ENV === "production"`), so any self-hosted production deployment fails it closed. The web side (`get-db.ts:200`, `:264`) requires the same explicit flag. This was a real bug once (the old loose predicate, `lib/env.ts:8-26` documents it) and it is genuinely fixed. |
| **JWT verification on the gateway** | `apps/gateway/lib/auth.ts:99-130`. | **Correct.** Uses `getClaims` (in-process JWKS verification) with `allowExpired` deliberately **not** set, trusts claims only when `error` is null, and enforces `verifiedUserId !== tenantId → 401` at `:124-130`. |
| **Replay protection on mutations** | `index.ts:283-296` + `lib/security.ts:291-324`. | **Present** (10-minute nonce window, per-tenant key). Caveats M-4 (per-isolate state) and the `/graphql` exemption at `index.ts:326`. |
| **HMAC request binding** | `lib/auth.ts:140-201`. | **Correct on the REST path** — required on every method (`:146-152`), signature length + hex validated (`:158-172`), 120s skew (`:179-187`), `dbUrl` and `dbToken` inside the signed payload (`:191`), constant-time compare (`crypto.ts:89-104`). The **GraphQL entrypoint lacks it** (H-1). |
| **Secret-strength gates** | `lib/crypto.ts:37-55`, `index.ts:118-162`. | **Correct as gates** — production throws at boot, dev warns, and no secret value is ever echoed (only its length). Caveat: H-2 (one secret, four jobs) and C-1 (the admin-token gate protects nothing per-request). |
| **Log redaction** | `packages/shared/src/redact.ts` end to end. | **Genuinely thorough.** Key gate (`:177-215` fail-closed, 35 fragments + a suffix rule), UUID gate (`:226-255`, allow-listed correlation ids only), value gate (`:351-363`), Luhn-validated PAN detection (`:42-86`), Indian mobile + `libsql://` patterns (`:111-112`), depth/cycle bounded (`:284-344`). `apps/gateway/lib/log.ts:10` re-exports the one implementation, so a call site cannot bypass it. |
| **Error responses** | `lib/errors.ts:159-192`; `app/api/v1/[...slug]/route.ts:85-152`; `graphql/index.ts:433-447`. | **Correct.** 5xx collapse to a canned string; the `CODE:` prefix survives redaction (`:167`); bearer tokens stripped after the scheme word (`:178`); IPs and UUIDs masked (`:183-187`); the BFF forwards only literals from a 12-row allowlist (`:85-105`) plus a per-status fallback (`:110-126`) and logs the raw text server-side only (`:144-145`). |
| **CORS resolution** | `lib/errors.ts:83-117`; `proxy.ts:62-73`; `route.ts:447-495`. | **Fail-closed in all three.** Exact `Set.has` (no substring — `errors.ts:88-99` documents the `buddysaradhi.app.evil.com` substring bug that was fixed), no wildcard ever, no ACAO for an unknown or absent origin, `Vary: Origin` on every path, `Access-Control-Allow-Credentials` only alongside a validated ACAO. The three resolvers are pinned together by `route.bff.test.ts`. |
| **Security headers** | `lib/security.ts:362-384`; `proxy.ts:215-232`. | **Compliant.** `default-src 'none'; frame-ancestors 'none'` on the JSON API, HSTS 2y with `includeSubDomains; preload`, `nosniff`, `X-Frame-Options: DENY`, a real `Permissions-Policy`, and `no-store` on every response. |
| **GitHub Actions pinning** | Every `uses:` in `.github/workflows/**`. | **Fully SHA-pinned** — all 12 workflows, every action, with the version in a trailing comment. gitleaks itself is downloaded with a **SHA256 checksum verified** (`security.yml:46-53`) and installed without a commercial licence. This is the best-supply-chain hygiene in the repo. (M-5 covers the two *unpinned downloads* in the same file.) |
| **Fail-closed audit/outbox on the gateway** | `routes/students.ts:42-90`. | **Correct.** `recordOutbox` and `recordAudit` log **and rethrow** — a failed audit write aborts the request (Rule 9 / BR-SEC-03), it does not degrade to best-effort. |
| **Open redirect** | `app/(auth)/callback/route.ts:15` → `assertSafeRedirectPath`. | **Closed.** `next` is validated same-origin before use; `${origin}${next}` cannot be steered off-site. |
| **Idempotency on mutations** | `index.ts:326-344`, `lib/idempotency.ts`. | **Present and fail-closed** — `requireIdempotencyKey` returns 400 without a key, and duplicate keys replay stored bytes. Correctly scoped by `(tenant_id, route, key)` (`sql.ts:1110-1123`) so one tenant's key cannot collide with another's. |
| **The web ORM shim's contract (AGENTS §3.6)** | `libsql-proxy.ts` end to end. | **Honouring its contract** (the tenant gap is C-3, not a contract violation): `$transaction` array form **throws** rather than pretending atomicity (`:619-624`); `orderBy`/`select` honoured; atomic `increment`/`decrement` performed in SQL (`:136-142`); `updateMany().count` for existence proofs; a missing table raises a **loud typed error naming the authority** (`:36-66`), never a shadow table; rollback failure is surfaced (`:636-647`). |

---

## 7. WHAT I COULD NOT VERIFY

Stated plainly, because an audit that hides its edges is worse than one that names them.

1. **Supabase column-level privileges on `auth.users.raw_user_meta_data`.** M-3's severity depends entirely on whether a user can write their own `user_metadata` (Supabase's platform default is that they can; this project's configuration is not in the tree). **Action: check `auth.users` column privileges in the Supabase dashboard before accepting M-3 at Medium.**
2. **Row Level Security on the Supabase Postgres schema** used by `apps/gateway/provision/index.ts`. No migrations, no `config.toml`, no RLS policies are checked in — `supabase/` contains only `functions/gateway/.env` and `.env.example`. I could not determine whether RLS is enabled, and the service-role client bypasses it regardless.
3. **Live Supabase Edge Function secrets.** I verified the *code* gates (`assertSecretStrength`, `resolveSharedSecret`) and that the on-disk `.env` files are gitignored, but not what is actually set in the Supabase project.
4. **`deno lint` / `deno check` were not run.** `apps/gateway/package.json:9-10` are `echo` no-ops, so `pnpm run lint` silently skips the gateway; the real runs only exist in `web-prod-gate.yml:155,158` and `supabase-ci.yml:34,37`. I did not execute Deno locally. **This is itself a finding:** the local lint gate reports "Done" for a package it did not lint.
5. **No test suite was run** — `AGENTS.md` §7.1 assigns that to the fullstack-tester. So I cannot say whether the tests that exist are passing, only that specific ones are structurally incapable of detecting the defects they appear to cover (H-6 → L-7).
6. **`pnpm run version:check`, `test:unit`, `test:integration`, `test:a11y` were not run.**
7. **`apps/desktop` (Rust/Tauri) and `apps/mobile` (Expo) were not audited.** `16_Platform_Delivery_Sequence.md` marks them LOCKED and out of the in-flight scope; I read no Rust or Expo source beyond `Cargo.toml` / `package.json` dependency lines surfaced by the audit. The 202 `shell-quote` and `brace-expansion` advisory paths in `pnpm audit` terminate in `apps/mobile` and were **not** assessed for reachability.
8. **Reachability of the transitive advisories.** `pnpm audit` reported 5 critical / 56 high / 45 moderate / 5 low across 1,204 dependencies. I analysed only the ones with a plausible production path (`next`). `proxy-addr`/`ip-address` (critical/high) reach production only through `apps/web > shadcn > @modelcontextprotocol/sdk`, a **CLI dev tool** — almost certainly not in the server bundle, but I did not trace the bundle. Every other advisory (undici, fast-uri, mysql2, node-forge, axios, sharp, `@xmldom/xmldom`, js-yaml, nanoid, deepmerge-ts, …) is unassessed.
9. **Runtime behaviour under concurrency.** Every finding is from static reading. The replay and rate-limit analysis (M-4) assumes Supabase Edge multi-isolate execution, which I could not confirm for this deployment.
10. **Whether `docs/rfc/009-tenant-isolation-invariant.md` has been rejected.** It is marked "Draft – Awaiting Security Review". I have treated C-2 and C-3 as live on that basis.

---

## 8. OWASP TOP 10 (2021) MAPPING

| OWASP 2021 | Findings | Assessment |
|---|---|---|
| **A01 Broken Access Control** | **C-1**, **C-2**, **C-3**, H-1, M-1, M-13, M-16 | **The dominant weakness class.** The single greatest exposure in the product is a destructive operation reachable without the factor the spec says is required. Tenant isolation is a documented invariant (RFC-009) enforced by convention rather than by construction. |
| **A02 Cryptographic Failures** | H-2, M-5, M-6, M-7 | No plaintext backups, no float money, no ECB, no home-grown cipher. The failures are **key management**, not algorithm choice: one secret with four jobs, a documented-but-dead encryption path, and a legacy KDF below current guidance. |
| **A03 Injection** | M-12 | **Clean in the code** (`lib/sql.ts` is exemplary; the shim parameterises everything). The failure is **in the detector**: L6's scope, its single-line matching and its indirection gap mean a P0 gate can be passed by a multi-line or variable-held query. |
| **A04 Insecure Design** | C-1, H-7, M-2, M-4, M-9, M-11, M-14 | Missing architecture-level controls: a second factor on the destructive path, a shared rate-limit/replay authority, a central PII store outside the threat model, and a constitution clause whose text no longer matches the shipped CSP. |
| **A05 Security Misconfiguration** | M-11, L-1, L-2 | Headers are strong; the misconfiguration is in *policy documents* (Rule 2's `connect-src` does not exist in the code) and in CORS origins hardcoded into every environment. |
| **A06 Vulnerable & Outdated Components** | **C-4**, H-5 | Three unpatched critical RCE advisories in the framework every request passes through, and the scanner that would catch them is advisory-only. |
| **A07 Identification & Authentication Failures** | C-1, H-6, H-2 | PIN hashing and the *web* lockout ladder are correct. The failures are: no second factor at the edge, a lockout wired to its own success path, and a fleet-wide signing key. |
| **A08 Software & Data Integrity Failures** | H-4, H-5 | A remote import map and caret ranges at deploy time; unpinned downloads and an `npx …@latest` in a workflow with write scope. |
| **A09 Logging & Monitoring Failures** | M-10, M-14, M-15 | The **typed, redacting** logger is a strength and I recommend keeping it. But there is no breach-detection, no runbook, no on-call, no notification path — and `audit_log` has indefinite retention with no purge. |
| **A10 SSRF** | H-1, M-3, M-8 | The gateway and the web server both dial URLs named by the request (`x-db-url`), with `http://` accepted and no host allowlist. |

---

## 9. COMPLIANCE AGAINST AGENTS.md §2 — THE 11 NON-NEGOTIABLES

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | Ledger is append-only | **COMPLIANT** | L1 PASS. No `ledgerEntry.update/delete` in product code. `apps/gateway/lib/sql.ts:592-596` and `:613-615` refuse the operation structurally. Two audited LEDGER-4 erase-cascade exceptions, both spec-cited. *See M-9 for a second store receiving hash-less ledger rows.* |
| 2 | No network calls that process user data | **VIOLATION** | The shipped CSP (`apps/web/src/proxy.ts:221`) does not match the policy Rule 2 declares (`AGENTS.md` §2): `*.turso.io`, `*.turso.ai`, `api.buddysaradhi.app` are present and undeclared; `sync.`/`update.buddysaradhi.app` are declared and absent. L4 PASS (no client-side `fetch`). **→ M-11.** |
| 3 | No telemetry/analytics SDK | **COMPLIANT** | L3 PASS across all four dependency sections of every `package.json`. 0 findings. |
| 4 | Five screens only | **COMPLIANT** | `apps/web/src/app/(app)/` contains exactly `dashboard`, `students`, `attendance`, `fees`, `settings`. `app/(auth)/` and `app/api/` are not screens. `lib/supabase/middleware.ts:70` gates the same five. |
| 5 | Colour comes from the palette | **COMPLIANT** | L5 PASS. No indigo/blue hex or Tailwind utility in product code. |
| 6 | Integer paise, never float | **COMPLIANT** | L2 PASS. **Zero `Float`/`Decimal` columns in `prisma/schema.prisma`** (verified by structural parse of all 23 models). `sql.ts:798-807` and `:1160-1162` enforce `Number.isSafeInteger` at the builder. |
| 7 | Every mutation writes `sync_outbox` | **COMPLIANT** (with a gap) | `routes/students.ts:42-90` fails closed: a failed outbox or audit write **rethrows** and aborts the request. Two web actions noted for follow-up; `sync_outbox` writes confirmed in the attendance transaction. |
| 8 | Backups AES-256-GCM + Argon2id | **COMPLIANT** | `apps/web/src/lib/crypto.ts:79-124` matches the byte table exactly: `BSR1` + version byte + `salt(16)‖nonce(12)‖tag(16)‖ct`; Argon2id m=64 MiB, t=3, p=2, v0x13; **no escrow, no server-key fallback, no plaintext path**. *Legacy decrypt-only KDF is below guidance → M-7.* |
| 9 | No silent failures | **PARTIAL** | Excellent in substance — typed errors everywhere, fail-closed audit writes, loud "schema missing at runtime" errors (`libsql-proxy.ts:36-66`), a redaction layer that cannot be bypassed. **But** `apps/gateway/lib/log.ts:46-48` is an empty `catch`, and `security.yml:95,120,140` are three `continue-on-error` steps — "a scan that reports and passes is worse than no scan" by the repo's own standard. **→ M-15, H-5.** |
| 10 | Accessibility is not optional | **UNCLEAR** | Not a security-audit competence and the `axe-core` gate was not run (§7). No obvious violation observed while reading components. `prefers-reduced-motion` is represented in the settings model. Needs the `pnpm run test:a11y` result to close. |
| 11 | One directory, one deployment target | **COMPLIANT** | Deployment manifests map each app directory to its own target; no cross-deployment mixing found. |

**Summary: 8 COMPLIANT · 1 VIOLATION (Rule 2) · 1 PARTIAL (Rule 9) · 1 UNCLEAR (Rule 10).**

The two non-compliant rules fail on **documentation-vs-code drift** and **advisory-not-enforced CI**, not on absent engineering.

---

## 10. COMPLIANCE AGAINST `23_Security_Harness_Plan.md`'s 10 DOMAINS

| Domain | Status | Note |
|---|---|---|
| **S1 Auth** | **PARTIAL** | RS256/JWKS verification is correct and `ALLOW_DEV_AUTH` is genuinely unreachable in production — both were real bugs and both are fixed. Gaps: fleet-wide signing key (H-2), dead lockout (H-6), no second factor at the edge (C-1). |
| **S2 Authz** | **FAIL** | The prescribed invariant (`buildTenantWhere` unconditional `tenant_id`) holds on the gateway. It does **not** hold on the web, and RFC-009 records that as a Draft. **C-2 + C-3.** |
| **S3 Injection** | **PASS (code) / PARTIAL (harness)** | `lib/sql.ts` is exemplary. L6's scope and matching are weaker than the claim. **M-12.** |
| **S4 Supply chain** | **FAIL** | Actions SHA-pinned ✅; gitleaks hard-gated ✅. But three unpatched critical RCEs (C-4), advisory-only OSV (H-5), remote import map + caret ranges (H-4), two unpinned downloads. |
| **S5 Transport** | **PASS** | HSTS 2y + preload on both surfaces; `Cross-Origin-Opener-Policy: same-origin`; nonce-based CSP in prod with `'unsafe-eval'` excluded (`proxy.ts:212-214`); nonce replay window + 120 s skew; no `http://` to the gateway from the web. Minor: `style-src 'unsafe-inline'` (L-1). |
| **S6 Data** | **FAIL** | Per-tenant sovereign SQLite holds **except** for the central Supabase Postgres copy with demo-seeded PII (M-9), `audit_log` retention "Indefinite" with no purge (M-10), and legacy PBKDF2 at 100k (M-7). |
| **S7 Gateway** | **PARTIAL** | Boot gates, idempotency, typed errors, fail-closed writes — all solid. Gaps: shared rate-limit/replay authority absent (M-4), HMAC binding missing on the GraphQL entrypoint (H-1), wrong-DB pipeline fallback (M-1), response encryption dead (M-5). |
| **S8 Client** | **UNCLEAR** | Web CSP/HSTS/COOP/CORP set. Mobile and desktop are LOCKED and were not audited (§7). `packages/security` claims a panic-PIN control that does not exist (H-7). |
| **S9 Observability** | **PARTIAL** | Redaction is a strength. Missing: impossible-travel detection, bulk-export anomaly detection, a breach runbook, an on-call, an intimation path, and log retention (**M-10**). |
| **S10 SDLC gate + DPDP** | **FAIL** | `docs/runbooks/incident-response.md` and `pii-inventory.test.ts` — both named as **blocking** for G-SEC-6 — do not exist. No consent artefact, no privacy notice, no residency record. Three of five `security.yml` jobs cannot fail the build. **M-10, H-5.** |

---

## 11. REMEDIATION PLAN

Ordered by severity, then by blast radius ÷ effort. Each row is independently shippable; the first four are the release gate.

### Wave 0 — before any production deploy (day 1)

| # | Item | Sev | Effort | Depends on |
|---|---|---|---|---|
| 1 | **C-4** bump `next` to `>=16.3.8`, drop `continue-on-error` from `security.yml:95` | Critical | **1 h** | — |
| 2 | **C-1** require `x-admin-token` on `POST /api/v1/security/erase`; do not deploy the gateway without it | Critical | **2 h** | — |
| 3 | **C-2** delete the shared-DB fallback (`route.ts:389-395`), return 503 + retry | Critical | **2 h** | RFC-009 §3.1 (owner-approved) |
| 4 | **H-1** HMAC-bind `x-db-url`/`x-db-token` in `graphql/index.ts` | High | **4 h** | — |

> Wave 0 is roughly one engineer-day and closes every Critical and the highest High. Nothing else should precede it.

### Wave 1 — this week

| # | Item | Sev | Effort | Notes |
|---|---|---|---|---|
| 5 | **C-1 (complete)** replace the PIN-proof gate: emit `HMAC(GATEWAY_SHARED_SECRET, tenantId:pin)` from `apps/web/src/lib/crypto.ts`, verify at the edge | Critical | **1 d** | Then remove the PIN-presence gate (`:82-98`) |
| 6 | **C-3** bind the tenant into the web shim (`createLibsqlProxy(client, tenantId)`); make the 1-arg form a compile error; make `deleteMany`/`updateMany` throw on a missing `where` | Critical | **2 d** | RFC-009 §3.2. Touches every call site — the compile error is the point |
| 7 | **H-3** tenant-scope the `b-morning`/`b-evening` batch ids + `ignoreDuplicates: true` | High | **2 h** | |
| 8 | **H-6** move `trackFailedAuth`/`clearFailedAuth` onto the auth **failure/success** paths; add an HTTP-level lockout test | High | **3 h** | |
| 9 | **H-7** wire `packages/security` in, or delete it and amend `10_Security.md` §3.6 | High | **2 d** | §8 stop-and-ask: crypto-path change → 2 reviewers incl. security owner |
| 10 | **H-4** vendor `import_map.json`, exact pins, Deno lockfile; unify `@libsql/client` with the web tree | High | **3 h** | |
| 11 | **H-5** SHA256-pin the osv-scanner download; pin cyclonedx; add a dated CVE allowlist file | High | **2 h** | |

### Wave 2 — next two weeks

| # | Item | Sev | Effort | Notes |
|---|---|---|---|---|
| 12 | **H-2** four independent secrets; delete every `\|\| HMAC_SECRET` / `\|\| GATEWAY_SHARED_SECRET` fallback; document PIN-pepper rotation | High | **1 d** | Rotation needs a migration note in `10_Security.md` §3 |
| 13 | **M-2** strip `x-forwarded-for`; key the rate limit on `cf-connecting-ip` only | Medium | **1 h** | |
| 14 | **M-8** require `libsql://` + a `*.turso.io`/`.turso.ai` host suffix in `resolveTursoUrl` | Medium | **1 h** | |
| 15 | **M-3** validate `metaUrl` scheme+host in `getDbCredentials`; reject `file:`; check Supabase `raw_user_meta_data` privileges (§7.1) | Medium | **3 h** + a dashboard check | |
| 16 | **M-1** thread the tenant's db credentials into `run()`'s pipeline fallback, or delete the fallback | Medium | **2 h** | |
| 17 | **M-5/M-6** either honour `x-encrypt-response` (per-tenant derived key, HKDF, no PBKDF2) or remove the flag, the header and the boot gate | Medium | **1 d** | Pick one; do not leave a documented-but-dead control |
| 18 | **M-12** extend L6's scope to `apps/services/`, `apps/gateway/{index,provision}`, `apps/product-page`, `supabase/functions`; add the variable-indirection pattern; collapse multi-line literals before matching; fail above a pinned allowlist budget | Medium | **1 d** | The scope fix alone may surface real findings — expect it |
| 19 | **M-13** delete the `args.tenantId` guards in `graphql/resolvers.ts`; `ctx.tenantId` only | Medium | **1 h** | |
| 20 | **M-16** drop `adminUser` from the shim `tableMap` | Medium | **30 min** | |
| 21 | **L-4/L-6/L-7, M-14, M-15, L-1, L-2, L-5, L-6** | Low | **1 d** total | Mechanical; batch them |

### Wave 3 — DPDP 2025 readiness (needs an owner, not just an engineer)

| # | Item | Sev | Effort | Owner |
|---|---|---|---|---|
| 22 | **M-10.1** write `docs/runbooks/incident-response.md` — dual DPDP "as soon as possible" / ICO-72h track, named on-call, five phases per `23_Security_Harness_Plan.md` §10.6 | Medium | **2 d** | Security owner + legal |
| 23 | **M-10.2** `pii-inventory.test.ts` — assert every PII column is listed in `10_Security.md` §8 with a retention and an encryption-at-rest status | Medium | **1 d** | — |
| 24 | **M-10.3** implement an `audit_log` retention job; default 24 months; tutor-overridable | Medium | **2 d** | Needs a spec amendment to `10_Security.md:374` first |
| 25 | **M-10.4** privacy notice + explicit consent checkbox at signup (DPDP §6); replace `about-section.tsx:84`'s admission with a real link | Medium | **2 d** | Legal |
| 26 | **M-10.5** record `turso_region` at provisioning; surface it in Settings → Data Privacy; verify the residency claim end-to-end | Medium | **2 d** | |
| 27 | **M-9** gate demo seeding behind non-production; decide and document whether the Supabase Postgres copy is a processor store, and if so give it retention + RLS + a DPDP processor-agreement note | Medium | **3 d** | §8 stop-and-ask: schema + data-handling change |

### Standing work

| # | Item | Effort |
|---|---|---|
| 28 | **M-4** move the nonce cache and rate limiter to a shared authority (Durable Object / Upstash / Redis SETNX), per `23_Security_Harness_Plan.md` §6/§10 | **3 d** |
| 29 | Replace the gateway's `echo`-based `lint`/`typecheck` scripts in `apps/gateway/package.json:9-10` with real invocations, so a local green run means something | **2 h** |
| 30 | Extract RFC-009 from Draft and land it — C-2 and C-3 have been "known and documented" since 2026-10-09 | **gated on §8 sign-off** |
| 31 | L-4: amend `10_Security.md` §3.5 to the implemented lockout ladder (or change the ladder) | **2 h** |

**Total estimated effort: ≈ 18 engineer-days**, of which **1 day** closes every Critical.

---

## 12. A NOTE ON WHAT THIS AUDIT DID NOT CHANGE

Per my operating constraints: I did not edit, fix, commit or push any source file. `git status --short` before and after this audit shows the same two untracked directories (`docs/security/`, `scripts/security/`) plus this report. No gate was weakened, no rule was relaxed, and no lint was narrowed to make a finding disappear.

If anyone asks me to make C-1, C-2, C-3 or C-4 "not a finding" by relaxing `principle-lints.ts`, by adding an allowlist entry, or by reclassifying `security.yml`'s `continue-on-error` as intentional, **I will refuse**, cite the governing rule (`AGENTS.md` §2 Rule 1 / §3.4, `10_Security.md` §18.1, `23_Security_Harness_Plan.md` §12 G-SEC-1), propose the principled alternative, and escalate per `AGENTS.md` §8.

---

*End of report. 34 findings: 4 Critical, 7 High, 16 Medium, 7 Low. 12 areas verified clean. 10 items unverifiable from the tree.*
