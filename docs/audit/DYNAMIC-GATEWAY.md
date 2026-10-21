# DYNAMIC-GATEWAY.md — Dynamic security assessment of the Buddysaradhi edge gateway

**Target:** `@apps/gateway` (Deno 2 edge function) — the single API backend for web, mobile and desktop.
**Live deployment under test:** `https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway` (owner-authorised).
**Local rig:** a copy of the gateway at `/tmp/gw-target` inside Kali WSL, backed by a real `sqld`
(Turso/libSQL) server on `127.0.0.1:8080`, driven through a real RS256 Supabase-style JWT
(local JWKS server on `127.0.0.1:9099`) so the **production** auth path — `getClaims` → claim policy →
HMAC request binding — is exercised, not the dev-auth shortcut.
**Date:** 2026-10-21.
**Tooling:** nmap/sqlmap/nikto/ffuf/wfuzz/msfconsole/tshark/burp/amass/sslscan/lynis/whatweb/zaproxy/tcpdump/netcat/curl/python3/deno 2.9.7.
**Not available and NOT installed:** `nuclei`, `httpx`, `gobuster`, `bandit`, `semgrep` (reported as a gap, not silently skipped).

---

## 1. Executive summary

The gateway's **data layer is sound**. Every SQL statement in the gateway is built by an audited,
Zod-validated builder in `lib/sql.ts` with `?`-bound values and allowlisted identifiers; there is no
raw SQL in any route; sqlmap's own "appears injectable" lead self-retracted as a false positive and
the code explains why (`search` never reaches SQL — it is filtered in JavaScript after a bounded read).
Tenant isolation, the mass-assignment surface, the secure-erase gates, the GraphQL complexity
limits, path traversal, request smuggling and the live deployment's dev-auth posture all hold up
under test.

**Three defects are real and were fixed in this session.**

1. **P0 — a captured signed payment could be replayed onto a second isolate and charged twice.**
   The nonce window lived in process memory, so on a multi-isolate deployment the "single use"
   property did not hold. The request signature binds only
   `tenantId:dbUrl:dbToken:timestamp:nonce` — **not** the method, path, body or `Idempotency-Key` —
   so a replay with a fresh Idempotency-Key produced a *second* money effect. Measured: two
   `PAYMENT_RECEIVED` rows of 4242 paise from one captured request.
   **Fixed** with a durable, tenant-database-backed nonce claim (`lib/replay.ts`) — same wire format,
   no new dependency, no new outbound origin.
2. **P1 — SSRF: the gateway dials any host the caller names in `x-db-url`**, including
   `169.254.169.254` and RFC1918 addresses, and pins the isolate on an unreachable host (no connect
   timeout). The web app signs whatever `db_url` it finds in the tutor's own `user_metadata`, so a
   tutor chooses the host the **edge function** reaches. **Fixed** with a host policy
   (`lib/db-url-policy.ts`) that refuses any non-public destination.
3. **P1 — "securely erase all tutor data" left the idempotency store behind**, and that store holds
   the stored *response body* of every mutation — receipt numbers and running balances.
   **Fixed** inside the erase cascade.

**One control does not exist at all and is now documented as such.** The 100/min per-IP limiter and
the 15-attempt credential lockout are **per-isolate in-memory maps**. Measured against the **live
deployment**: 400 concurrent `GET /health` → **400 × HTTP 200, zero 429s**; 40 requests with a bad
bearer → **40 × HTTP 401, zero 429s**. The documented ceilings never bind. On the local rig the same
controls are defeated by rotating `cf-connecting-ip` (130/130 requests served, zero lockouts in 130
failed-auth attempts). A shared store is required and is out of this scope; the control is now
recorded in `.env.example` with the measurement instead of being documented as if it exists.

---

## 2. Findings (severity-ranked)

| ID | SEV | file:line | What | Proof (command → output) | Fix | Status |
|----|-----|-----------|------|---------------------------|-----|--------|
| **GW-01** | **P0** | `apps/gateway/lib/security.ts:149,493-526` (in-memory nonce map) · `apps/gateway/lib/auth.ts:461` (signature material) · `apps/gateway/index.ts` (no durable claim) | **Cross-isolate replay of a signed money mutation ⇒ double charge.** The nonce window is a per-isolate `Map`; a captured signed request replayed onto an isolate that had never seen the nonce was accepted. The signature does not bind method/path/body/`Idempotency-Key`, so the replay carried a **new** Idempotency-Key and therefore a new effect. | `.tmp-hunt2.ts` T8 (two gateway processes, one shared tenant DB):<br>`isolate A (8000) payment -> HTTP 200 {"receiptNo":"RCP-000011","newBalance":-10253}`<br>`isolate B (8001) SAME capture -> HTTP 200 {"receiptNo":"RCP-000012","newBalance":-14495}`<br>`isolate A (8000) SAME capture -> HTTP 409`<br>ledger then held **two** `PAYMENT_RECEIVED` rows of 4242 paise, description `REPLAY`. | New `apps/gateway/lib/replay.ts`: the nonce is claimed in the **tenant's own database** (`idempotency_keys`, reserved route `NONCE-CLAIM`, UUIDv8-shaped SHA-256 digest of tenant‖nonce), so single-use holds across isolates, PoPs and restarts. Wired into `index.ts` before dispatch. | **FIXED** |
| **GW-02** | **P1** | `apps/gateway/lib/sql.ts:38-63` (`resolveTursoUrl` — scheme allowlist, **no host allowlist**) · `apps/gateway/lib/db.ts:61` (`createLibsql`) · `apps/gateway/lib/sql.ts:189-200` (`batchExecute` → `fetch(`${host}/v2/pipeline`)`) | **SSRF: the edge function will dial any host the caller names in `x-db-url`** — loopback, `169.254.169.254` (cloud metadata), RFC1918 — and a dead host **hangs the request** (the libsql client has no connect timeout). The web signs `user_metadata.db_url` (`apps/web/src/lib/db.ts:153`), which the signed-in tutor owns. | Listener on `127.0.0.1:9097` captured the dial:<br>`HIT POST http://127.0.0.1:9097/v2/pipeline`<br>`authorization: Bearer local-test-turso-token-1234567890abcdef`<br>`body: {"requests":[{"type":"execute","stmt":{"sql":"SELECT * FROM students WHERE tenant_id = ? ORDER BY first_name ASC, id ASC LIMIT ? OFFSET ?",...}}]}`<br>Shape matrix (`.tmp-hunt4.ts`): `http://169.254.169.254/…` → dialed; `http://10.0.0.5:8080` → dialed and **hung** (client timeout at 12 s, gateway still pending); `http://[::1]:9097` → dialed (36 ms); `file:///etc/passwd` → not a network location; `http://evil.supabase.co/x`, `http://x.supabase.co.evil.com/`, `http://attacker.example.com/?q=supabase.co`, `HTTP://127.0.0.1:9097`, `http://127.0.0.1:9097@evil.example.com/` → silently **substituted** (see GW-07). | New `apps/gateway/lib/db-url-policy.ts`: refuses any destination that is not a routable public host (loopback, link-local, RFC1918, CGNAT, multicast/reserved, `*.internal`/`*.local`/`localhost`, non-HTTP schemes), judged on the **parsed** host so userinfo tricks cannot mislead it. Optional operator allowlist `DB_HOST_ALLOWLIST` turns the denylist into a strict hostname allowlist. Enforced in `index.ts` **before** anything is dialed. | **FIXED** |
| **GW-03** | **P1** | `apps/gateway/lib/sql.ts:1178-1194` (`ERASE_TABLES` omits `idempotency_keys`) · `apps/gateway/routes/security.ts` (cascade) | **"Securely erase all tutor data" left the idempotency store behind.** Every row holds the stored **response body** of a mutation — for this product, a receipt number, a ledger projection and a running balance. | `__tests__/erase-wipes-idempotency-store.test.ts` (negative control): with the wipe removed the seeded rows survive —<br>`expected [ 'NONCE-CLAIM', …(2) ] to not include 'POST /api/v1/ledger/payment'` | `routes/security.ts` deletes the tenant's `idempotency_keys` rows inside the **same** cascade transaction, using the audited tenant-scoped `stmtDeleteWhere`. The erase's own idempotency record (written after the cascade) survives — it is the audit trail of the erase, not the erased data. | **FIXED** |
| **GW-04** | **P1** | `apps/gateway/lib/security.ts:149` (`ipRateLimitMap`) · `apps/gateway/lib/crypto.ts:429` (`rateLimitMap`) · `apps/gateway/lib/security.ts:246-274` (`getClientIp`) | **The per-IP limiter and the 15-attempt credential lockout do not bind.** Both are per-isolate in-memory maps; a multi-isolate deployment multiplies the effective ceiling by the number of isolates serving that client. In legacy mode (no `TRUSTED_PROXY_CIDRS`) the client IP is read from caller-written headers, so the limiter is also rotatable. | **LIVE:** `seq 1 400 \| xargs -P 8 -I{} curl … "$L/health" \| sort \| uniq -c` → `400 200` (no 429).<br>`seq 1 40 \| xargs -P 4 … -H "Authorization: Bearer not-a-real-token"` → `40 401` (no 429).<br>**LOCAL (single isolate, clean map per run):** fixed `cf-connecting-ip` → `ok=100 429=30 first429=100`; **rotating** `cf-connecting-ip` → `ok=130 429=0`; rotating `x-forwarded-for` → `ok=130 429=0`; lockout with fixed IP → `first429=14` (14 × 401 then 429); lockout with **rotating** IP → `ok=0 429=0 other={"401":130}` (never locked). | **NOT FIXABLE IN SCOPE.** A limit that must hold across isolates needs a shared store; the tenant DB is per-tenant and cannot key an IP, and adding Redis would be a new dependency + a new outbound origin (both forbidden here). The control is now **documented as not existing** in `apps/gateway/.env.example` (with the measurements and the recommendation to enforce a real limit at the edge, e.g. Cloudflare WAF), and `TRUSTED_PROXY_CIDRS` is called out as mandatory for self-hosted deployments. | **REPORTED — documented, not fixed** |
| **GW-05** | **P2** | `apps/gateway/graphql/resolvers.ts:28,68,101` (throws `forbidden: tenant mismatch`) · `apps/gateway/index.ts` (catch-all → 500) | **A client-side refusal was reported as a server fault.** The GraphQL tenant-mismatch guard throws (correctly — `graphql.test.ts` pins that contract) and the transport turned it into `500 INTERNAL: internal server error`, which is both untrue and a budget poisoner. | `.tmp-hunt3.ts` T10e: `{ students(tenantId:"<own>"){…} }` + `variables:{tenantId:"<other>"}` → **`HTTP 500 {"success":false,"error":"INTERNAL: internal server error"}`** | `index.ts` maps only that refusal to a typed `403 FORBIDDEN: tenant mismatch` (`execLocalSafe`); every other error still propagates as a 500 with the original message in the server log. | **FIXED** |
| **GW-06** | **P2** | `apps/gateway/index.ts:165-170` (`cacheKey`) | **The edge cache key omits the database identity** — `gw:<tenantId>:<path>:<qs>`. A request that names a different `x-db-url` is answered from the previous database's cached rows (observed: `http://127.0.0.1:9097@evil.example.com/` returned HTTP 200 with the tenant's rows after the URL was rejected). Correctness defect; **not** a cross-tenant leak (the tenant id *is* in the key). | `.tmp-hunt4.ts` T13 — several shapes returned `OWN-TENANT-DATA(served from the SUBSTITUTE db)` in 9–12 ms, i.e. from cache, not from the named host. | Not fixed: the cache key is in `index.ts` (mine) but the honest fix depends on GW-07's substitution semantics. Recorded for the cache owner. | **REPORTED** |
| **GW-07** | **P2** | `apps/gateway/lib/sql.ts:38-63` (`resolveTursoUrl`) — **file is dirty (another session's RFC-005 work); not edited** | **A caller-supplied database URL is silently SUBSTITUTED, not refused.** If the URL does not start with `libsql://`/`https://`/`http://` (the check is **case-sensitive**, so `HTTP://…` fails) or contains `supabase.co` anywhere, the gateway ignores it and runs the request against the deployment's own `TURSO_DATABASE_URL` — a *different database* — with no error and no audit signal. | `.tmp-hunt4.ts` T13: `http://evil.supabase.co/x`, `http://x.supabase.co.evil.com/`, `http://attacker.example.com/?q=supabase.co`, `HTTP://127.0.0.1:9097`, `http://127.0.0.1:9097@evil.example.com/` → all `HTTP 200` served from the substitute database (9–12 ms). | Recorded for the owner of `lib/sql.ts`: `resolveTursoUrl` should either accept the caller's URL or **fail closed** with a typed 4xx, never silently retarget. The new `lib/db-url-policy.ts` narrows the class of URLs that reach it (GW-02) but does not change the substitution semantics. | **REPORTED — file not mine** |
| **GW-08** | **P3** | `apps/gateway/lib/security.ts:92-128` (`SQL_INJECTION_PATTERNS`, `XSS_PATTERNS`) | **The blocklist is bypassable — by design it is defence-in-depth, but the code should say so.** `<svg/onload=alert(1)>` and `'||(SELECT tenant_secret FROM settings)||'` pass and are **stored verbatim**. | `.tmp-hunt6.ts` C: `notes="<svg/onload=alert(1)>" -> HTTP 201 (ACCEPTED — stored verbatim)`; `notes="'||(SELECT tenant_secret FROM settings)||'" -> HTTP 201`. | No change (the blocklist is not the SQL-injection control — see §4). **The rendering client must escape** stored text; the gateway stores what it is given. | **REPORTED** |
| **GW-09** | **P3** | `apps/gateway/lib/auth.ts:461` (`dataToSign = ${tenantId}:${dbUrl}:${dbToken}:${timestamp}:${nonce}`) | **The request signature binds neither the method, nor the path, nor the body, nor the `Idempotency-Key`.** It binds the tenant, the database, the timestamp and the nonce. | `.tmp-hunt2.ts` T2f — ONE signature material used twice:<br>`GET /api/v1/students -> HTTP 200`<br>`POST /api/v1/ledger/payment -> HTTP 200 {"receiptNo":"RCP-000013","newBalance":-14618}` | Deliberately **not** changed: the signed material is a published wire value (`apps/web/src/server/get-db.ts:270`), and re-binding it would break every deployed web client — an RFC, not a unilateral edit. GW-01 removes the exploitability that the missing binding created (the nonce is now durable, so a captured signature is single-use for its tenant). | **REPORTED** |
| **GW-10** | **P3** | `apps/gateway/lib/sql.ts:163-206` (`batchExecute`) — **file is dirty; not edited** | **No connect timeout on the tenant-database dial.** A dead host leaves the request pending for the OS TCP timeout; on an edge isolate that is an isolate held open. | `.tmp-hunt4.ts` T13: `http://10.0.0.5:8080` → client timed out at 12 003 ms with the gateway still working on the request. | Recorded for the owner of `lib/sql.ts`: `batchExecute` has an 8 s `AbortController`, but the hang is in the **hrana client** created by `lib/db.ts` `getTurso`, which exposes no timeout option today. GW-02 removes the reachable hosts; the timeout remains a hardening item. | **REPORTED — file not mine** |

---

## 3. Fixes made (and their verified-red negative controls)

### 3.1 GW-01 — durable, cross-isolate replay guard

* **New:** `apps/gateway/lib/replay.ts`
* **Changed:** `apps/gateway/index.ts` (claim before dispatch), `apps/gateway/__tests__/sqlite-db.ts` (optional file path so two handles can share one database)
* **New test:** `apps/gateway/__tests__/replay-cross-isolate.test.ts`

The nonce is claimed in the **tenant's own database** — the one store every isolate for that tenant
already talks to — by inserting into `idempotency_keys` under the reserved route `NONCE-CLAIM`. The
table's composite primary key `(tenant_id, route, "key")` (`lib/schema.ts:350`) gives duplicate
detection for free, and the existing 24 h TTL purge (`lib/idempotency.ts`) bounds the rows. The
`"key"` column is UUID-validated by `stmtInsertIdempotencyKey`, so the nonce is folded into a
UUIDv8-shaped SHA-256 digest of `tenantId‖0x00‖nonce` — deterministic (so the conflict fires) and
one-way (so the nonce is never stored).

**Negative control (red → green):** breaking the conflict branch of `claimNonceOnce` made the
cross-isolate test fail:

```
FAIL __tests__/replay-cross-isolate.test.ts > claims the nonce once per tenant database, not once per isolate
Error: UNIQUE constraint failed: idempotency_keys.tenant_id, idempotency_keys.route, idempotency_keys.key
Test Files  1 failed (1)
Tests  1 failed | 5 passed (6)
```
restored → `Test Files 1 passed (1) / Tests 6 passed (6)`.

**End-to-end re-test on the rig after the fix** (same harness, two isolates, one shared DB):

```
isolate A (8000) payment        -> HTTP 200 {"receiptNo":"RCP-000014","newBalance":-18860}
isolate B (8001) SAME capture    -> HTTP 409 {"success":false,"error":"conflict","requestId":"a0099bbd…"}
isolate A (8000) SAME capture    -> HTTP 409 {"success":false,"error":"conflict","requestId":"213730a7…"}
balance after : -18860
```
→ one payment, one effect. Before the fix the same sequence produced `RCP-000011` **and** `RCP-000012`
and two ledger rows.

### 3.2 GW-02 — `x-db-url` host policy (SSRF)

* **New:** `apps/gateway/lib/db-url-policy.ts`
* **Changed:** `apps/gateway/index.ts` (check the caller-supplied URL before anything is dialled)
* **New test:** `apps/gateway/__tests__/db-url-policy.test.ts`
* **Changed:** `apps/gateway/.env.example` (documents `DB_HOST_ALLOWLIST`)

Only the **caller-supplied** header is subject to the policy — the deployment's own configured
database is not, so a self-hosted gateway pointing at a private Turso keeps working.

**Negative control (red → green):** disabling the host check made 5 tests fail:

```
FAIL … > refuses loopback
FAIL … > refuses the link-local metadata address
FAIL … > refuses RFC1918 and other non-routable IPv4 space
FAIL … > refuses the well-known local and internal hostnames
FAIL … > judges the REAL host, not the userinfo an attacker wants you to read
Test Files  1 failed (1) / Tests  5 failed | 7 passed (12)
```
restored → `Test Files 1 passed (1) / Tests 12 passed (12)`.

**End-to-end re-test on the rig after the fix:**

```
http://169.254.169.254/latest/meta-data/ -> HTTP 400 {"error":"DB_URL_REJECTED: database URL host is not in the deployment's DB_HOST_ALLOWLIST"}
http://10.0.0.5:8080                     -> HTTP 400 DB_URL_REJECTED
http://192.168.1.1                       -> HTTP 400 DB_URL_REJECTED
file:///etc/passwd                       -> HTTP 400 DB_URL_REJECTED: database URL scheme "file:" is not a permitted network location
http://localhost:8080                    -> HTTP 400 DB_URL_REJECTED
```
and the SSRF listener recorded **no new hit** (only the three pre-fix dials are in its log).

### 3.3 GW-03 — erase wipes the idempotency store

* **Changed:** `apps/gateway/routes/security.ts` (tenant-scoped `DELETE FROM idempotency_keys` inside the cascade transaction)
* **New test:** `apps/gateway/__tests__/erase-wipes-idempotency-store.test.ts`

**Negative control (red → green):** removing the wipe made both tests fail:

```
FAIL … > deletes the tenant's stored mutation responses
AssertionError: expected [ 'NONCE-CLAIM', …(2) ] to not include 'POST /api/v1/ledger/payment'
FAIL … > leaves another tenant's idempotency rows untouched
Test Files  1 failed (1) / Tests  2 failed (2)
```
restored → `Test Files 1 passed (1) / Tests 2 passed (2)`.

### 3.4 GW-05 — typed GraphQL refusal

* **Changed:** `apps/gateway/index.ts` (`execLocalSafe` → `403 FORBIDDEN: tenant mismatch`)
* Re-test: `query T + variables O -> HTTP 403 {"success":false,"error":"FORBIDDEN: tenant mismatch"}` (was `HTTP 500 INTERNAL`).

### 3.5 GW-04 — documentation of a control that does not exist

* **Changed:** `apps/gateway/.env.example` — the per-isolate nature of the limiter and the lockout,
  the live measurement (400/400 at HTTP 200; 40/40 at HTTP 401), the mandatory
  `TRUSTED_PROXY_CIDRS` for self-hosted deployments, and the recommendation to enforce a real limit
  at the edge. Per AGENTS.md Rule 9 and 10_Security.md §8, a documented control that does not exist
  is worse than an undocumented one.

### 3.6 No new dependencies, no new outbound origins, no raw SQL

* The nonce claim reuses `stmtInsertIdempotencyKey` / `stmtDeleteWhere` — **no new SQL text**, no new
  table, no new DDL.
* `lib/db-url-policy.ts` contains no SQL and no network code.
* `deno check --config apps/gateway/deno.json apps/gateway/index.ts` → **passes**.
* `deno lint --config apps/gateway/deno.json apps/gateway` → **passes** (106 files checked, 0 errors).

---

## 4. Verified correct (tested, not assumed)

| Area | Evidence |
|------|----------|
| **No SQL injection** | sqlmap 1.10.8, `--dbms=sqlite --level=5 --risk=3 --technique=BEUSTQ` against `?search=`, `?status=`, `?sortCol=`, `?sortDir=`, `?page=`, `?pageSize=` → *"all tested parameters do not appear to be injectable"*; with `--tamper=space2comment` (to defeat the blocklist) sqlmap's "appears injectable" lead **self-retracted**: *"false positive or unexploitable injection point detected"*. Reason (read in code): every statement is built by `lib/sql.ts` builders with `?`-bound values, identifiers are Zod/regex-allowlisted, and `search` is filtered **in JavaScript** (`routes/students.ts:515-522`) after a capped read — it never reaches SQL. `grep` confirms **zero** SQL string literals in `apps/gateway/routes/**`. |
| **Tenant isolation** | JWT for A + `x-tutor-id: B` → `401 UNAUTHENTICATED: tenant mismatch`; JWT for A + HMAC computed for B → `401 tenant mismatch`; `GET /api/v1/students/<other-tenant's student uuid>` → `404 not_found`; `GET /api/v1/ledger?studentId=<other tenant's id>` → only the caller's rows. |
| **Mass assignment** | `PATCH /api/v1/students/:id` with `tenant_id`, `balance_paise`, `id`, `dup_key`, `deleted_at` → 200 and **nothing changed** (Zod allowlist strips unknown keys; the id is server-minted). `PATCH /api/v1/settings` with `tenant_id`, `tenant_secret`, `pin_hash`, `pin_proof`, `next_invoice_seq`, `next_receipt_seq`, `backup_passphrase_hash` → `400 VALIDATION "not a writable settings field: …"`. `POST /api/v1/students` with `tenant_id`/`balance_paise`/`id` → `balancePaise: 0`, a server-minted id. |
| **Idempotency (same route)** | Same `Idempotency-Key`, same route → byte-identical replay with `X-Idempotent-Replayed: true` (`bytes identical: true`). |
| **Secure-erase gates** | No `pinProof` → `400 "PIN confirmation required to erase this account."`; wrong proof → `401 "PIN confirmation failed; erase blocked"`; `tutorId` ≠ authenticated tenant → `400 "tutorId must match the authenticated tenant"`; missing `Idempotency-Key` → `400`; `confirm: "erase"` (lower-case) → `400 "confirm must be 'ERASE'"`. `pin_hash`/`pin_proof` are **not** echoed by `GET /api/v1/settings` or by the GraphQL `settings` resolver. |
| **GraphQL limits** | Depth → `QUERY_TOO_DEEP` (limit 8); >16 top-level fields → `QUERY_TOO_COMPLEX`; 16 aliases with different arguments → refused by the field cap (no amplification); introspection → `{"__schema":null}` (not implemented); batch array body → `{"data":{}}` (no batching); unauthenticated → `401 AUTH_REQUIRED`. |
| **GraphQL argument injection** | `{ …f.args, …variables }` lets **variables override the query's own arguments** (the documented weakness) — but every statement is built from the verified `ctx.tenantId`, so the override can only *satisfy* the resolver's own guard, never cross tenants. Proven: `query tenant O + variables tenant T` returns the caller's **own** rows, `query T + variables O` is refused. |
| **Path traversal / odd paths** | `/api/v1/students/../../settings` → 404; `/api/v1/students%2f..%2fsettings` → 400; `/api/v1/ledger;id` → 400 (command-injection pattern); `/api/v1/settings;x=1` → 400; non-UUID path id → `400 "id: must be a UUID"`. |
| **Request smuggling / CRLF** (raw socket, not a client library) | CRLF in a header value → 200 with **no** injected header in the response; duplicate `Content-Length` → 400; `Transfer-Encoding` + `Content-Length` conflict → 400; oversized declared body → 413; obsolete header line-folding → 400; absolute-form request target → 200 (normalised); bare-LF terminator → 200 (Deno's parser is lenient — residual risk is bounded because the edge terminates TLS and speaks HTTP/2 to the function, so there is no second HTTP/1 parser to desynchronise). |
| **Body/query limits** | `pageSize=100000` → clamped to 200 rows; `page=99999` → 0 rows (no unbounded read); body > 1 MiB → 413; >50 query params → 400; header value > 4096 → 400. |
| **Dev auth is closed in production** | `Authorization: Bearer mock-token-…` against the **live** deployment → `401 {"error":"UNAUTHENTICATED: development [REDACTED] not permitted in production"}`. `ALLOW_DEV_AUTH` is opt-in **and** double-gated by `isDeployed()` (`lib/env.ts:60-65`). |
| **No secret echo** | `tenant_secret`, `pin_hash`, `pin_proof` appear in **no** read route (`/api/v1/settings`, `/api/v1/students`, `/api/v1/ledger`, `/api/v1/analytics/dashboard` → `secretLeak=false` for all four). |
| **Live TLS / headers** | Live responses carry `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (all denied), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`. No `Server`/`X-Powered-By` echo. |
| **CORS** | No `Access-Control-Allow-Origin` for an origin that is not allowlisted; no wildcard; `Vary: Origin` present. |
| **Blocklist false positives** | Legitimate tutor text is **accepted**: `Sharma & Sons`, `Aarav's notes: paid 1000 on 5th`, `Class 10-A (Board)`, `Amit = Kumar`, `abc OR def (chemistry)`, `O'Brien`, `C++ / Java notes`, `Concentration = 10x` → all `201`. |
| **Ledger append-only** | `DELETE`/`UPDATE` on `ledger_entries` aborted by the SQLite triggers; the erase cascade is the single audited exception and re-creates the guards inside the same transaction (existing `__tests__/erase-cascade-completes.test.ts` stays green). |

---

## 5. Latency (measured, not guessed)

Measured on the local rig (loopback `sqld`), 12 requests per configuration, 250 ms apart to stay
under the 20/min mutation limiter:

| Path | p50 | p95 |
|------|-----|-----|
| `GET /api/v1/students` | 4 ms | 5 ms |
| `GET /api/v1/settings` | 2 ms | 3 ms |
| `GET /api/v1/ledger` | 2 ms | 3 ms |
| `GET /api/v1/analytics/dashboard` | 2 ms | 4 ms |
| `POST /api/v1/ledger/payment` — **pre-fix** (no durable claim) | 235 ms | 11 466 ms (rate-limit penalty) |
| `POST /api/v1/ledger/payment` — **post-fix** (durable claim) | 228 ms | 275 ms |

The durable nonce claim adds exactly **one** `INSERT` to the mutation path and shows **no measurable
regression** on this rig (the local `sqld` latency dominates; the spread is dominated by the
per-tenant 20/min mutation limiter, which is per-isolate and therefore also unreliable — see GW-04).

**Cache behaviour (verified):** a cache HIT still goes through the full auth path — the cache is
consulted *after* `authenticateRequest` (`index.ts`), so a cache hit never skips authentication.
`decorateCacheHit` adds exactly two headers (`X-Response-Time`, `X-Request-Id`) and echoes **no**
tenant id, cache key or query string. `Cache-Control` is overridden to `no-store, no-cache,
must-revalidate, proxy-revalidate` on every response including hits.

---

## 6. Exact commands run

```bash
# ── rig ────────────────────────────────────────────────────────────────────────
wsl -d kali-linux -u root -e bash -lc 'bash .tmp-rig.sh start; bash .tmp-rig.sh seed'
# rig repairs (in /tmp ONLY — never in the repo):
#   /tmp/gw-target/lib/db.ts    -> import { createClient as createLibsql } from "npm:@libsql/client@0.15.3/node"
#   /tmp/gw-target/lib/sql.ts   -> resolveTursoUrl accepts file: (rig-only)
#   /tmp/gw-target/index.ts     -> Deno.serve({ port: GW_PORT })  (so a 2nd isolate can run on :8001)
#   local JWKS server on :9099 + RS256 token minter (.tmp-jwt-tools.ts)
#   sqld on :8080 (--db-path /tmp/gwdb/gw.db)
fuser -k 8000/tcp; setsid bash /tmp/gw-start-local.sh …      # isolate A
fuser -k 8001/tcp; setsid bash /tmp/gw-start-8001.sh  …      # isolate B (same tenant DB)

# ── harnesses (reproduction tooling, repo root, .tmp- prefixed) ─────────────────
deno run -A --no-config .tmp-hunt1.ts    # tenant isolation, signature scope, idempotency
deno run -A --no-config .tmp-hunt2.ts    # cross-isolate replay (GW-01), mass assignment
deno run -A --no-config .tmp-hunt3.ts    # GraphQL, SQLi, blocklist, CRLF
deno run -A --no-config .tmp-hunt4.ts    # SSRF shapes, path handling, erase gates
deno run -A --no-config .tmp-hunt5.ts    # cache, latency, unbounded reads
deno run -A --no-config .tmp-hunt6.ts    # post-fix verification + blocklist/leak matrix
deno run -A --no-config .tmp-rl.ts fixed|rotating|xff|none|lockout-fixed|lockout-rotating 130
deno run -A --no-config .tmp-perf2.ts    # A/B latency pre-fix vs post-fix
python3 .tmp-raw.py                      # raw-socket smuggling / CRLF probes

# ── sqlmap ─────────────────────────────────────────────────────────────────────
sqlmap -u "http://127.0.0.1:8000/api/v1/students?search=aarav&status=active&sortCol=name&sortDir=asc&page=1&pageSize=50" \
  --headers="Authorization: Bearer mock-token-11111111-1111-7111-8111-111111111111
x-tutor-id: 11111111-1111-7111-8111-111111111111
x-db-url: http://127.0.0.1:8080
x-db-token: local-test-turso-token-1234567890abcdef" \
  --dbms=sqlite --level=5 --risk=3 --technique=BEUSTQ --batch --threads=4
sqlmap -u "http://127.0.0.1:8000/api/v1/students?search=aarav" -p search \
  --headers="…" --dbms=sqlite --level=3 --risk=2 --technique=BEUSTQ --batch \
  --threads=1 --delay=1.2 --tamper=space2comment

# ── live target ───────────────────────────────────────────────────────────────
L=https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway
curl -sS -D- "$L/health"
curl -sS "$L/api/v1/students" -H "Authorization: Bearer mock-token-<tenant>" -H "x-tutor-id: <tenant>"   # -> 401 dev tokens
curl -sS "$L/graphql" -X POST -H "Content-Type: application/json" -d '{"query":"{students(tenantId:\"x\"){items{id}}}"}'  # -> 401
seq 1 400 | xargs -P 8 -I{} curl -s -o /dev/null -w "%{http_code}\n" "$L/health" | sort | uniq -c        # -> 400 200
seq 1 40  | xargs -P 4 -I{} curl -s -o /dev/null -w "%{http_code}\n" "$L/api/v1/students" \
  -H "Authorization: Bearer not-a-real-token" | sort | uniq -c                                           # -> 40 401

# ── gates ─────────────────────────────────────────────────────────────────────
deno check --config apps/gateway/deno.json apps/gateway/index.ts
deno lint  --config apps/gateway/deno.json apps/gateway
cd apps/gateway && bunx vitest run                      # 62 files / 901 tests
cd apps/gateway && bunx vitest run __tests__/replay-cross-isolate.test.ts \
                               __tests__/db-url-policy.test.ts \
                               __tests__/erase-wipes-idempotency-store.test.ts
```

---

## 7. Test-suite state after the fixes

```
Test Files  4 failed | 58 passed (62)
Tests       11 failed | 890 passed (901)
```

The four failing files are **pre-existing and not caused by this work** — proven by reverting only
this session's three tracked files (`index.ts`, `routes/security.ts`, `__tests__/sqlite-db.ts`) to
`HEAD` and re-running them:

```
# with my three files reverted to HEAD:
Test Files  3 failed | 1 passed (4)
Tests       7 failed | 43 passed (50)
# with my three files restored:
Test Files  2 failed | 2 passed (4)
Tests       6 failed | 44 passed (50)
```

* `__tests__/ledger-routes.test.ts` and `__tests__/receipt-outbox-payload.test.ts` fail because of the
  **other session's uncommitted RFC-005 money-flow work** (`routes/ledger.ts`, `lib/vendor/feesFlow.ts`,
  `lib/vendor/tamper.ts` — files this assessment was told not to touch). The failures are about
  invoice attribution, the `Math.max(0, …)` overpayment clamp, the chain-tip balance and
  `payment_ref` null-vs-empty.
* `__tests__/low-latency.test.ts` and `__tests__/performance.test.ts` are **timing-threshold tests**
  that flake under load (e.g. `expected 0.2633865 to be less than 0.2` — a 200 µs budget on a
  loaded Windows host). Their failure count varies run to run (7 → 6 → 11) independently of this work.

The three new test files (18 assertions) are green.

---

## 8. Files changed by this assessment

```
modified  apps/gateway/index.ts                    (db-url policy, durable nonce claim, typed GraphQL refusal)
modified  apps/gateway/routes/security.ts          (erase wipes the idempotency store)
modified  apps/gateway/__tests__/sqlite-db.ts     (optional shared file path, to model two isolates)
modified  apps/gateway/.env.example                (DB_HOST_ALLOWLIST; per-isolate limiter/lockout reality)
new       apps/gateway/lib/replay.ts               (durable cross-isolate nonce claim)
new       apps/gateway/lib/db-url-policy.ts        (x-db-url host policy)
new       apps/gateway/__tests__/replay-cross-isolate.test.ts
new       apps/gateway/__tests__/db-url-policy.test.ts
new       apps/gateway/__tests__/erase-wipes-idempotency-store.test.ts
```

**Nothing was committed.** Reproduction tooling (`.tmp-*.ts`, `.tmp-raw.py`) is left at the repo root
next to the pre-existing `.tmp-rig.sh`; delete it after review.

**Files owned by another session and therefore NOT edited** — findings inside them are recorded above
with file:line and the proposed fix: `apps/gateway/lib/sql.ts` (GW-02 host allowlist at :38-63,
GW-03 `ERASE_TABLES` at :1178-1194, GW-10 connect timeout at :163-206), `apps/gateway/routes/ledger.ts`,
`apps/gateway/lib/vendor/tamper.ts`, `apps/gateway/lib/vendor/feesFlow.ts`,
`apps/gateway/__tests__/fee-strictness.test.ts`, `apps/gateway/__tests__/idempotency-cas.test.ts`,
`scripts/sync-vendor-feesflow.ts`, `deno.lock`, `filestructure_buffy.md`.

---

## 9. Tooling gaps

`nuclei`, `httpx`, `gobuster`, `bandit` and `semgrep` are **not installed** and were **not**
installed by this assessment (explicitly forbidden). The coverage they would have added was covered
by hand instead: sqlmap for injection, ffuf-style corpus probing for the blocklist, raw sockets for
smuggling, and a purpose-built Deno harness for the authenticated flows. A static-analysis pass
(`semgrep`/`bandit`) over `apps/gateway/**` is still outstanding and is recommended as the next
step — it is the one class of check this assessment could not perform.
