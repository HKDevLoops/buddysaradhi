# 17 — API Gateway System

> The single network chokepoint for every Buddysaradhi client — web, mobile, desktop. No platform hardcodes a service URL, a database connection string, or a storage bucket. Every client speaks to **one gateway**, over **one contract**, at **one pinned version**. This file is what makes `16_Platform_Delivery_Sequence.md` §7 Boundary Rule mechanically enforceable: if all three platforms share one gateway and one contract, then a contract change is a versioned event, not a silent cross-platform break.
>
> **Last updated: Task 17-EDGE-MIGRATION** — migrated the gateway from a sandbox-local Caddy + BFF + mini-services-on-ports (3031-3037) model to a cloud/edge deployment on **Cloudflare Workers + Durable Objects** (primary) with **Supabase Edge Functions** as fallback. The contract-first framing, the no-hardcode rule, the audit row, and the error contract are preserved verbatim. Only the HOSTING migrated. Source of truth for every technical claim below: `research_R-GQL-EDGE-REDIS.md` (cited inline).

---

## 0. The Problem This Solves

The failure mode the user named: *"hard-coding in each platform and database, storage should not fail."* Without a gateway, each platform invents its own fetch wrapper, its own auth header assembly, its own error-shape, its own retry policy, its own idea of where the ledger service lives. Three platforms × N services = 3N places for a URL to drift, a token to leak, or a storage key to be mis-scoped. The result is exactly what happened: the plan hallucinated because there was no single contract to verify against, and "the database/storage failed" because each platform reached into storage differently.

The gateway collapses that to **one ingress, one contract, one auth model, one storage model**. Platforms become thin: they import a generated SDK and call typed functions. They never see a URL.

**Why this rewrite was necessary.** The first version of this file described the gateway as a sandbox-local process: Caddy on one exposed port, a Hono BFF reverse-proxied behind it, and six mini-services listening on internal ports `3031`–`3037`, all stitched together by an `XTransformPort` query convention. That model is **dev-only** — it cannot be called from a real Expo app on a phone, a Tauri desktop build on a user's laptop, or a Next.js site deployed to Vercel. The user's report that *"POST/fetch is not possible"* is the symptom: there was no HTTPS endpoint for any non-sandbox client to call. This file now describes a single cloud/edge deployment that **all three platforms** call over HTTPS relative paths: one edge domain (`api.buddysaradhi.app`), one contract tag, one auth model. The mini-services from `18_Microservice_Architecture.md` are no longer separate processes on ports — they are co-deployed Worker functions (see §6 + `18_Microservice_Architecture.md`), dispatched in-process by the gateway router.

---

## 1. Architecture (ASCII)

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                  THE BUDDYSARADHI GATEWAY (edge deployment)              │
 │              one ingress · one contract · one auth · one domain          │
 └─────────────────────────────────────────────────────────────────────────┘

   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │   WEB    │   │  MOBILE  │   │ DESKTOP  │     (thin clients — generated
   │Next.js 16│   │ Expo SDK │   │ Tauri v2 │     SDK only, env-var base,
   │on Vercel │   │   52/RN  │   │  WebView │     NO hardcoded URLs)
   └────┬─────┘   └────┬─────┘   └────┬─────┘
        │              │              │
        │  HTTPS relative paths under one edge base, same SDK, same tag
        │  NEXT_PUBLIC_API_BASE  /  EXPO_PUBLIC_API_BASE  /  TAURI_API_BASE
        │              │              │
        ▼              ▼              ▼
   ╔═══════════════════════════════════════════════════════════════════════╗
   ║   api.buddysaradhi.app   (Cloudflare Workers — multi-region edge)      ║
   ║                                                                         ║
   ║   ┌─────────┐  ┌──────────┐  ┌─────────────┐  ┌────────┐  ┌─────────┐ ║
   ║   │  TLS    │─▶│  Auth    │─▶│ Rate-Limit  │─▶│Router  │─▶│Audit    │ ║
   ║   │(CF edge)│  │(Supabase │  │(DO per      │  │(OpenAPI│  │(CF D1 + │ ║
   ║   │  HTTP/3 │  │ RS256 JW)│  │ tutorId tok)│  │ +Zod)  │  │Upstash) │ ║
   ║   └─────────┘  └──────────┘  └─────────────┘  └───┬────┘  └────┬────┘ ║
   ║                                                   │            │       ║
   ║                       contract = contracts/vX.Y.Z tag (pinned) │       ║
   ║                                  [5] in-Worker function dispatch│       ║
   ║                                                   │            │       ║
   ║   ┌───────────────────────────────────────────────▼────────────▼────┐  ║
   ║   │  CO-DEPLOYED WORKER FUNCTIONS (no process hop — see 18)         │  ║
   ║   │  ┌──────────┐ ┌───────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ │  ║
   ║   │  │ledger-fn │ │student-fn │ │sync-fn │ │auth-fn │ │report-fn │ │  ║
   ║   │  │(Prisma+  │ │(Prisma+   │ │(DO +   │ │(Supabse│ │(PDF URL │ │  ║
   ║   │  │ libsql)  │ │ libsql)   │ │outbox) │ │ +OTP)  │ │ cache)  │ │  ║
   ║   │  └────┬─────┘ └─────┬─────┘ └───┬────┘ └───┬────┘ └────┬─────┘ │  ║
   ║   └───────┼─────────────┼───────────┼──────────┼───────────┼────────┘  ║
   ╚═══════════╪═════════════╪═══════════╪══════════╪═══════════╪═══════════╝
               │             │           │          │           │
        ┌──────▼─────────────▼───────────▼──────────▼───────────▼────────┐
        │  STATEFUL EDGE SIDE-CARS                                       │
        │                                                                │
        │  ┌──────────────────────┐        ┌──────────────────────────┐  │
        │  │ Upstash Redis        │        │ Cloudflare Durable       │  │
        │  │ (Global, REST API)   │        │ Objects (SQLite-backed)  │  │
        │  │  · tutor:dburl       │        │  · RateLimitObject       │  │
        │  │  · jwks:supabase     │        │    (token bucket/tutor)  │  │
        │  │  · rl:{tutor}:{rte}  │        │  · SyncConnectionObject  │  │
        │  │  · student:{...}     │        │    (WebSocket Hibernation│  │
        │  │  · ledger:balance    │        │     per tutor, presence) │  │
        │  │  · report:url        │        │                          │  │
        │  └──────────────────────┘        └──────────────────────────┘  │
        │                                                                │
        │  ┌──────────────────────┐        ┌──────────────────────────┐  │
        │  │ Upstash QStash       │        │ Supabase                 │  │
        │  │ (HTTP push + CRON)   │        │  · Auth (JWT RS256 JWKS) │  │
        │  │  · notif tick 1m     │        │  · provision-db Edge Fn  │  │
        │  │  · outbox drain 30s  │        │  · user_metadata store   │  │
        │  │  · report cleanup 24h│        │  · RLS on shared tables  │  │
        │  └──────────────────────┘        └──────────────────────────┘  │
        └────────────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────────────────────────────┐
        │  PER-TUTOR STORAGE  (gateway resolves tutorId → dbUrl)        │
        │  ┌──────────────────────────┐  ┌──────────────────────────┐  │
        │  │ Turso / libSQL           │  │ Vercel Blob              │  │
        │  │ (one DB per tutor;       │  │ (signed PUT/GET URLs     │  │
        │  │  Prisma v6.16 +          │  │  15-min TTL; bytes never │  │
        │  │  @prisma/adapter-libsql, │  │  transit the gateway)    │  │
        │  │  WASM Query Compiler)    │  │                          │  │
        │  └──────────────────────────┘  └──────────────────────────┘  │
        │  ┌──────────────────────────┐  ┌──────────────────────────┐  │
        │  │ CF D1 audit DB           │  │ Vercel Blob backup bucket│  │
        │  │ (gateway-owned,          │  │ (AES-256-GCM envelopes,  │  │
        │  │  append-only audit_log)  │  │  content-addressed)      │  │
        │  └──────────────────────────┘  └──────────────────────────┘  │
        └───────────────────────────────────────────────────────────────┘
```

The diagram above encodes five non-negotiables that the rest of this file unpacks:

1. **One edge domain.** `api.buddysaradhi.app` — HTTPS, HTTP/3, served from Cloudflare's multi-region edge. The same hostname answers web, mobile, and desktop. There is no `:3031`, no `localhost`, no `XTransformPort` in production code.
2. **One contract tag.** Every client pins `contracts/vX.Y.Z`. The router validates every request against that tag's OpenAPI document at boot (§2).
3. **One auth model.** Supabase JWT RS256, verified against the cached JWKS endpoint (§5). The gateway has no per-platform auth branch.
4. **Stateful concerns live in Durable Objects + Upstash Redis.** Rate-limit token buckets per tutor (DO), WebSocket sync connections per tutor (DO Hibernation API), and seven hot cache keys (Upstash Redis). Both are first-class edge primitives, not bolted-on stores — see §6.2 + §6.3.
5. **Services are Worker functions, not processes.** The "mini-services" of `18_Microservice_Architecture.md` are co-deployed in the same Worker bundle; the gateway dispatches in-process. This removes a network hop and the entire `:3031`-style port surface that the prior plan depended on.

---

## 2. The Contract Is the Source of Truth

The gateway is **contract-first**. The OpenAPI 3.1 document `contracts/openapi.json` is the single source of truth. Everything else is generated from it:

| Artefact | Generated from | Consumed by |
|---|---|---|
| `packages/shared/zod/*` | `openapi.json` schemas (via `openapi-zod-schemas`) | web, mobile, desktop — runtime validation |
| `packages/shared/sdk/*` (typed fetch client) | `openapi.json` paths (via `openapi-typescript-codegen`) | web, mobile, desktop — the ONLY way a client calls the API |
| `packages/core/` types | `openapi.json` schemas | ledger engine |
| Gateway route handlers | `openapi.json` paths (via `zod-openapi` / `@hono/zod-openapi`) | the gateway Worker itself — routes are validated against the contract at boot |
| Worker function interfaces | `openapi.json` operation → function map | ledger-fn, student-fn, sync-fn, auth-fn, report-fn |

**Consequence:** a client literally cannot construct an out-of-contract request. The SDK has no function for it. The gateway rejects any request that doesn't match the contract with `400 Contract Violation`. There is no "undocumented endpoint" to drift to.

### 2.1 Versioning

The contract is versioned semantically: `contracts/v1.0.0`. Clients pin a tag at build time (the `packages/shared` import resolves to a tagged commit). Breaking changes bump the major; the gateway serves **both** `v1` and `v2` paths in parallel during a migration window, then `v1` is retired. This is how `16_Platform_Delivery_Sequence.md` G2 (contract-frozen) is mechanically satisfied: the tag is immutable, so a frozen gate cannot silently break.

### 2.2 The No-Hardcode Rule (Hard, updated for edge)

> **No client code under `apps/web/`, `apps/mobile/`, or `apps/desktop/` may contain a URL string, a fetch to a service, a Prisma client, a Turso URL, a Blob bucket name, a `localhost:` reference, or a direct `:3031`-style port literal.** The only permitted network call is `sdk.<operation>(args)` from `packages/shared/sdk`. The API base URL is read from a per-platform env var (`NEXT_PUBLIC_API_BASE` for web, `EXPO_PUBLIC_API_BASE` for mobile, `TAURI_API_BASE` for desktop); the SDK consumes it once at module init. A `grep` for `fetch(`, `http://`, `https://`, `localhost:`, `:\d{4}/` (4-digit port literals), `libsql`, `@libsql/client`, `new PrismaClient`, `BLOB_*`, `api.buddysaradhi.app` under `apps/*/` MUST return zero results in production code. This is a CI lint (`tools/no-hardcoded-ingress.test.ts`).

The lint was tightened in this rewrite: the prior rule allowed any `https://` string as long as it wasn't a fetch call. That left a loophole — a developer could paste `https://api.buddysaradhi.app` into a config file "for documentation" and the next agent would copy-paste it into client code. The lint now forbids the literal `api.buddysaradhi.app` anywhere in `apps/*/` source. The base is an env var, full stop.

### 2.3 The Optional GraphQL Yoga BFF (read-only dashboard aggregator)

The contract spine is REST/OpenAPI. **GraphQL is NOT the primary contract.** There is an optional, opt-in **GraphQL Yoga** edge function at `/graphql` whose sole purpose is to collapse the dashboard's multi-service fan-out into one round-trip. Per the API7.ai 2025 comparison ([api7.ai/blog/graphql-vs-rest-api-comparison-2025](https://api7.ai/blog/graphql-vs-rest-api-comparison-2025)):

> *"REST is often the simplest default for resource-oriented APIs, public APIs, and cache-heavy workloads. GraphQL can be a strong fit when clients need flexible queries across complex relationships, especially for mobile or frontend-driven applications."*

The dashboard's KPI strip + recent-ledger + attendance-summary is exactly the "flexible queries across complex relationships" case where GraphQL earns its keep — three REST round-trips from a cold mobile connection is materially slower than one GraphQL POST. Everything else (mutations, sync, per-resource reads) stays REST because REST's HTTP cacheability (`Cache-Control`/`ETag`/CDN) is built-in and GraphQL's is not, per the same article.

The BFF has hard guardrails:

| Rule | Enforcement |
|---|---|
| BFF is read-only | The `/graphql` Worker only resolves Query operations; Mutation + Subscription are not registered. The Yoga schema is built from `openapi.json` GET operations only. |
| BFF never owns state | The BFF fans out to the same co-deployed Worker functions (ledger-fn, student-fn, report-fn) the REST routes use. It is a thin aggregator, not a new service. |
| BFF schema is generated, not hand-written | The Pothos schema is generated from `openapi.json` so it cannot drift from the REST contract. A diff that touches `openapi.json` regenerates the BFF schema in CI; schema drift fails the build. |
| BFF degrades to parallel REST on error | If the BFF Worker throws, the SDK catches and issues the three REST calls in parallel. The dashboard renders identically (slower). The BFF is an optimisation, not a dependency. |
| Mutations + sync stay REST | Per `mobile/04_Offline_Sync_and_Conflict_Resolution.md` the outbox+pull model is the sync contract. GraphQL subscriptions are not introduced. |
| BFF is OFF by default | The build flag `ENABLE_GRAPHQL_BFF` is false in P1 (Web In-Flight); it flips on in P2 (Mobile) only when the dashboard fan-out shows up as a measurable mobile cold-start cost. |

Yoga is chosen over Apollo Server for lower latency + higher throughput ([the-guild.dev/graphql/yoga-server/docs/comparison](https://the-guild.dev/graphql/yoga-server/docs/comparison)). The BFF runs as a second route in the same Cloudflare Worker (`/graphql` alongside `/api/v1/*`), so it inherits the same TLS, auth, rate-limit, and audit pipeline (§3). It is not a separate deployment.

**UNVERIFIED:** exact Yoga + Pothos cold-start cost on CF Workers with per-request Prisma WASM init (`research_R-GQL-EDGE-REDIS.md` Q1.4). Benchmark before enabling in P2.

---

## 3. Request Lifecycle

Every request traverses the same pipeline. No Worker function is reachable except through it.

```
 client ──HTTPS──▶ [1 TLS] ──▶ [2 AUTH] ──▶ [3 RATE-LIMIT] ──▶ [4 ROUTE]
                                                                 │
                                                                 ▼
                                                            [5 SERVICE]
                                                                 │
                                                                 ▼
   ◀──[9 AUDIT]── [8 RESP-SHAPE] ◀──[7 STORAGE] ◀── [6 AUTHZ] ◀──┘
```

| Stage | Responsibility (CF Workers edition) | Rejects with |
|---|---|---|
| 1 TLS | Cloudflare's edge TLS terminates the connection; HTTP/3 + HSTS; CF built-in DDoS + WAF. No Caddy in production — Caddy was the sandbox dev proxy only. | — (CF handles; bad certs never reach the Worker) |
| 2 AUTH | Validate Supabase JWT (RS256). JWKS fetched from Supabase's `/.well-known/jwks.json` endpoint, cached in Upstash Redis under `jwks:supabase` (TTL 10 min — Supabase rotates ≤1h, per `research_R-GQL-EDGE-REDIS.md` Q3.2). 5-min clock skew tolerance. Attach `ctx.tutorId = jwt.sub`. | `401 unauthenticated` |
| 3 RATE-LIMIT | Token bucket per `tutorId`, owned by a **Durable Object** (`RateLimitObject`, sharded `tutor:<tutorId>`). 300 req/min burst 60 default; per-route overrides (ledger read 600/m, backup initiate 2/m). The DO is single-threaded per tutor → no race on the bucket. | `429 too many requests` + `Retry-After` |
| 4 ROUTE | Match path+method to OpenAPI operation; Zod-validate request (params/query/body); tag the `operationId` onto the context. The OpenAPI doc is loaded at Worker boot and pinned to the deployed contract tag. | `400 contract violation` |
| 5 SERVICE | Dispatch to the Worker function that owns the operation (ledger-fn, student-fn, sync-fn, …). **No process hop** — the function lives in the same Worker bundle and is called as a typed TS function (see `18_Microservice_Architecture.md`). The function receives a typed, validated call — never raw HTTP. | (function errors propagate as typed `Result`) |
| 6 AUTHZ | Function enforces row-level scope: a tutor can only touch their own data (`tutorId` is non-negotiable; cross-tenant access is `403`). Supabase RLS is the backstop on shared tables; the gateway is the primary. | `403 forbidden` |
| 7 STORAGE | DB access is **Prisma ORM v6.16.0+** via `@prisma/adapter-libsql` against the per-tutor Turso DB (WASM Query Compiler, no Rust engine — `research_R-GQL-EDGE-REDIS.md` Q4). The gateway resolves `tutorId → dbUrl` from Upstash Redis (§4.1) and reuses a cached `PrismaClient` from the isolate's module-level `Map<tutorId, PrismaClient>`. File/blob operations mint **short-lived signed URLs** (15 min, Vercel Blob). Redis cache-aside sits in front of Turso for the seven hot keys (§6.3). | `503 storage unavailable` (typed, retried) |
| 8 RESP-SHAPE | Validate the response against the OpenAPI response schema before sending; a function returning a wrong shape is a `502` (gateway bug), never a client-visible schema violation. | `502 upstream contract violation` |
| 9 AUDIT | Append an `audit_log` row for every mutating + every auth-failed request (reads sampled 1%). The row is written to the **gateway-owned Cloudflare D1 audit DB** (not the per-tutor Turso DB) and **also** pushed to an Upstash Redis list buffer for the dashboard's recent-activity widget. No PII in the log (Rule 2/3). | — (audit is fire-and-forget via `ctx.waitUntil`) |

### 3.1 The Audit Row Is Non-Negotiable

Stage 9 is why "no silent failures" (Rule 9) holds at the network layer. Every mutation is auditable. The audit table is append-only and lives in the **gateway-owned CF D1**, not the per-user Turso DB — a tutor cannot alter their own audit trail. The row shape:

```typescript
// D1 audit_log (gateway-owned, append-only, hash-chained — see 10_Security.md §8)
type AuditLogRow = {
  id: string;              // ULID, monotonic
  ts: string;              // ISO 8601, UTC
  tutorId: string;         // ctx.tutorId (or "anon" for auth-failed)
  operationId: string;     // OpenAPI operationId
  method: string;          // HTTP method
  path: string;            // path (no query — query is PII-risky)
  status: number;          // HTTP status returned
  latencyMs: number;       // end-to-end gateway latency
  requestHash: string;     // SHA-256 of canonicalised request (no PII; see 10_Security.md §8.3)
  traceId: string;         // correlates to ApiError.traceId
  prevHash: string;        // hash-chained (10_Security.md §8.4)
};
```

The Upstash list buffer (`audit:recent:{tutorId}`) keeps the last 50 rows per tutor for the dashboard widget, evicted by `LTRIM`. It is a **projection** of D1, not a second source of truth — D1 is canonical.

---

## 4. Storage Abstraction (so storage "does not fail")

Storage failures are the user's named pain point. The gateway owns three storage concerns so clients never touch them directly.

### 4.1 Per-user database (Turso/libSQL via Prisma v6.16)

- The gateway resolves **`tutorId → dbUrl/dbToken`** from **Upstash Redis** (`tutor:{tutorId}:dburl`, TTL 1h, `DEL`'d on db_provision mutation). The prior plan held this map in a gateway-local `Map` — that broke the moment the gateway scaled to >1 isolate (each isolate had its own map). Redis is the shared source of truth across all Worker isolates in all regions.
- On cache miss, the gateway falls back to reading the tutor's Supabase `user_metadata` (set by the provision-db Edge Function — §5.1) and back-fills Redis with a 1h TTL.
- A client never sees a Turso URL. It calls `sdk.ledger.listEntries({ tutorId })`; the gateway resolves the tutor's DB URL from Redis, fetches or reuses a `PrismaClient` from the isolate's module-level `Map<tutorId, PrismaClient>` (LRU-evicted at ~50 active clients per isolate, per `research_R-GQL-EDGE-REDIS.md` Q4.4), runs the ORM call, returns the typed result.
- The Prisma client uses the ESM-first `prisma-client` generator with `engineType = "client"` and `runtime = "cloudflare"`, paired with `@prisma/adapter-libsql` pointed at the per-tutor Turso URL. The Rust query engine is gone in v6.16.0 ([prisma.io/blog/rust-free-prisma-orm-is-ready-for-production](https://www.prisma.io/blog/rust-free-prisma-orm-is-ready-for-production); [prisma.io/changelog](https://www.prisma.io/changelog)); the WASM Query Compiler loads via static `import` and runs on CF Workers without issue (the v6.16.0 `/edge` regression in [github.com/prisma/prisma/issues/28074](https://github.com/prisma/prisma/issues/28074) was fixed in 6.16.x).
- A `PrismaClient` extension registers the audit-log + tamper-hash + soft-delete hooks (per `10_Security.md` §8.4 and `11_Data_Model.md` §10) — these are identical to the non-edge build because the new generator supports the Client extension API unchanged.

### 4.2 File/blob storage (Vercel Blob, signed URLs)

Unchanged from the prior plan — Vercel Blob is already HTTPS-callable from any client and the signed-URL flow was correct. The gateway mints short-lived signed URLs; bytes never transit the gateway.

- Clients never call Blob directly. The flow is: client asks the gateway "I want to upload a receipt PDF" → gateway mints a signed PUT URL (15 min) → client PUTs the bytes to Blob → client calls `sdk.receipt.attachUpload({ key })` → gateway verifies the object exists (HEAD), records its hash + size in the ledger, returns the receipt row.
- Downloads are the mirror: gateway mints a signed GET URL (15 min). The bytes never transit the gateway.
- Vercel Blob's security posture (AES-256 at rest, private stores, OIDC — `research_R-GQL-EDGE-REDIS.md` S6) is the canonical reference; full threat model in `10_Security.md` §6.

### 4.3 Backup envelope store

Unchanged from the prior plan — the gateway never sees plaintext backup keys.

- Backups (`09_Backup_and_Import_Export.md`) are AES-256-GCM + Argon2id envelopes. The gateway stores the envelope (never the plaintext key) in a dedicated Vercel Blob bucket; the key is derived on-device and never sent to the gateway.
- The gateway is a content-addressed store: `put(hash, envelope)`, `get(hash) → envelope`. It cannot read what it stores.

### 4.4 Storage failure handling

| Failure | Gateway behaviour | Client sees |
|---|---|---|
| Turso primary unavailable | Retry on replica (libSQL multi-region) ×2 with 200 ms backoff; then `503`. The Prisma adapter handles the retry transparently via `@prisma/adapter-libsql`'s URL list. | `503 storage_unavailable`, SDK retries with jitter |
| Upstash Redis miss/unavailable | The gateway **always** has a fallback path: tutor-map falls back to Supabase `user_metadata`; rate-limit falls back to a per-isolate in-memory bucket (less accurate but never blocks); cache-aside reads fall through to Turso. Redis being down never blocks a request, only slows it. | transparent (latency rises, no errors) |
| Blob PUT signed-URL expired (client slow) | Client gets `403` from Blob; SDK auto-requests a fresh URL and retries once | transparent |
| Audit-log D1 down | Gateway serves the request (availability > audit) but fires a `WARN` to the ops channel + writes to a local Upstash list spool (`audit:spool`) that drains on recovery | transparent (the spool is the guarantee audit is never lost) |
| Contract response-shape mismatch | `502` + the function is flagged unhealthy; circuit opens after 5 | `502`, SDK surfaces typed error |

---

## 5. Auth Model (one model, three platforms)

All three platforms authenticate identically: **Supabase JWT (RS256)** in the `Authorization: Bearer` header. The differences are only how the JWT is obtained:

| Platform | How the JWT is obtained | How it's stored | Refresh |
|---|---|---|---|
| Web | Supabase Auth (email/OTP/magic-link) via `@supabase/ssr` | httpOnly secure cookie | `@supabase/ssr` auto-refresh on the server |
| Mobile | Supabase Auth (OTP); `expo-secure-store` holds the refresh token | Keychain/Keystore | SDK refresh-on-401, silent |
| Desktop | Supabase Auth (OTP); Tauri `keyring` holds the refresh token | OS keyring | SDK refresh-on-401, silent |

The gateway does not care which platform called. It validates the JWT against the cached JWKS, extracts `sub` (tutorId), and proceeds. **There is no per-platform auth code path on the server.** This is the single biggest win: a token-handling bug fixed once is fixed for all three. The RS256 + JWKS pattern is the Supabase-recommended 2025 production setup (HS256 is "not recommended for production" — `research_R-GQL-EDGE-REDIS.md` S1).

### 5.1 Provisioning (1 user → 1 Turso DB) — provision-db stays a Supabase Edge Function

On first sign-up, the provision-db function creates the tutor's Turso DB, runs the forward-only migrations, and writes `dbUrl`/`dbToken` into the tutor's Supabase `user_metadata`. The gateway reads `user_metadata` on first request from a new tutor and caches the mapping in Upstash Redis (`tutor:{tutorId}:dburl`, TTL 1h).

**Where provision-db lives: a Supabase Edge Function (Deno), NOT a CF Worker.** Justification, drawn from `research_R-GQL-EDGE-REDIS.md` Q2:

- provision-db needs the **Supabase `service_role` key** to write `user_metadata` for the freshly-created user. Supabase keeps that key in its own secrets store; a Supabase Edge Function reads it natively via `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` and the key never leaves the Supabase perimeter.
- Porting provision-db to a CF Worker would require copying the `service_role` key into CF Workers secrets — a key-distribution risk that violates `10_Security.md` §1 (trust model: the service_role key never crosses a vendor boundary).
- Supabase Edge Functions support WebSockets since Dec 2024 LW13 ([supabase.com/blog/edge-functions-background-tasks-websockets](https://supabase.com/blog/edge-functions-background-tasks-websockets)) and have an official Upstash integration example ([upstash.com/examples/upstashredisinsupabaseedgefunctions](https://upstash.com/examples/upstashredisinsupabaseedgefunctions)) — so provision-db can also invalidate the Upstash `tutor:{tutorId}:dburl` key on completion without needing a separate HTTP call.
- Background Tasks via `EdgeRuntime.waitUntil` give provision-db up to 150 s free / 400 s paid — enough for the Turso DB create + migrate cycle (typically 3-8 s).

**Everything else in the gateway lives on CF Workers.** provision-db is the single Supabase Edge Function in the build, and it runs only on sign-up. The gateway caches its result in Redis on first request and never calls provision-db again for that tutor.

---

## 6. The Gateway in Production

This section replaces the prior "The Gateway in This Sandbox" entirely. The sandbox Caddy + `XTransformPort` model was dev-only and did not translate to a deployable system — which is why the user's POST/fetch calls failed outside the sandbox.

### 6.1 Production topology

| Component | Where | Why |
|---|---|---|
| Gateway Worker | Cloudflare Workers (Paid, $5/mo) | 5 min CPU/req, 128 MB, 10K subrequests, 10 MB compressed code, multi-region by default, <1s cold start ([developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)) |
| Edge domain | `api.buddysaradhi.app` (CF DNS, orange-cloud) | One HTTPS endpoint for all three platforms; HTTP/3 + HSTS + built-in DDoS |
| Stateful DOs | Cloudflare Durable Objects (SQLite-backed) | Rate-limit token buckets + WebSocket sync connections via Hibernation API. Unlimited objects, 10 GB/object, ~1K req/s per object ([developers.cloudflare.com/durable-objects/platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits)) |
| Hot cache | Upstash Redis (Global, REST API) | 7 cache concerns (§6.3); HTTPS-only, no connection pool, edge-native ([upstash.com/docs/redis/features/restapi](https://upstash.com/docs/redis/features/restapi)) |
| Scheduled jobs | Upstash QStash | 3 CRON-driven HTTP pushes (§6.3); at-least-once with retry+backoff ([upstash.com/blog/qstash-announcement](https://upstash.com/blog/qstash-announcement)) |
| Audit DB | Cloudflare D1 (gateway-owned) | Append-only `audit_log`; gateway-owned so a tutor cannot alter it |
| Per-tutor DBs | Turso / libSQL | One DB per tutor; Prisma v6.16 + `@prisma/adapter-libsql` |
| Files | Vercel Blob | Signed URLs, gateway mints |
| Auth + provisioning | Supabase (Auth + 1 Edge Function) | JWT RS256 + JWKS; provision-db Edge Function (§5.1) |
| Web frontend | Vercel (Next.js 16) | Static + server components; calls `api.buddysaradhi.app` |
| Mobile | Expo SDK 52 / RN 0.76 (EAS) | Same base |
| Desktop | Tauri v2 (WebView) | Same base |

The web app on Vercel sets `NEXT_PUBLIC_API_BASE=https://api.buddysaradhi.app`. The mobile app sets `EXPO_PUBLIC_API_BASE` to the same value (EAS Build environment variable). The desktop app sets `TAURI_API_BASE` (compiled into the Tauri binary at build time from a build env var, not a source literal — the no-hardcode lint still applies). All paths are relative under that base (`/api/v1/...`, `/sync`, `/graphql`). The SDK reads the env var once at module init.

**Fallback: Supabase Edge Functions.** If the CF Workers deployment becomes untenable (billing, region policy, a CF-side incident), the entire gateway can be re-deployed to Supabase Edge Functions. Supabase Edge supports WebSockets since Dec 2024 LW13, runs the same Prisma v6.16 WASM Query Compiler, and has an official Upstash example. The fallback path is documented in `deployment/06_Edge_Function_Hosting.md` (NEW — to be written). The contract, the audit row, the rate-limit semantics, and the SDK are all identical between primary and fallback — only the runtime changes.

### 6.2 WebSocket / real-time (Durable Object + Hibernation API)

Real-time (sync push, live presence) uses a **Durable Object** (`SyncConnectionObject`, sharded by `tutor:<tutorId>`) running Cloudflare's **WebSocket Hibernation API** ([developers.cloudflare.com/durable-objects/best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets)). The Hibernation API is the deciding factor for CF Workers over Vercel Edge or Supabase Edge as the primary: it holds millions of idle WebSocket connections without per-connection compute — **only message processing bills**. Vercel Edge doesn't support WebSockets on the Edge runtime at all (Beta on Node.js runtime only — `research_R-GQL-EDGE-REDIS.md` Q2.1), and Supabase Edge WebSockets are reported fragile on the free tier.

```
   client (mobile/desktop/web)              CF edge            SyncConnectionObject (DO)
        │                                     │                       │
        │ 1 wss://api.buddysaradhi.app/sync?token=<jwt>                  │
        ├────────────────────────────────────▶│                       │
        │                                     │ 2 route to DO by       │
        │                                     │   tutorId (from JWT)   │
        │                                     ├──────────────────────▶│
        │                                     │                       │ 3 verify JWT
        │                                     │                       │   (JWKS cached in
        │                                     │                       │    Upstash 10 min)
        │                                     │                       │ 4 acceptWebSocket()
        │                                     │                       │   connection HIBERNATES
        │                                     │                       │   (zero compute billed)
        │ 5 101 Switching Protocols           │                       │
        │◀────────────────────────────────────┤◀──────────────────────┤
        │                                                             │
        │  (idle — minutes/hours — no compute billed)                 │
        │                                                             │
        │ 6 message: { type:"sync_push", outbox:[...] }               │
        ├────────────────────────────────────────────────────────────▶│
        │                                     │                       │ 7 wake, process, write
        │                                     │                       │   to per-tutor Turso,
        │                                     │                       │   broadcast to other
        │                                     │                       │   connections of same tutor
        │ 7 ack                              │                       │
        │◀────────────────────────────────────────────────────────────┤
        │                                     │                       │ 8 hibernate again
```

The handshake is authenticated: the DO verifies the JWT in the upgrade request's `?token=<jwt>` query parameter (the SDK injects it from the platform token store; the query is HTTPS-encrypted so the token never crosses the wire in the clear). Per-message authorisation (OWASP WebSocket cheat-sheet — Origin validation + per-message `tutorId` scope check) is enforced inside the DO. This is what `mobile/04_Offline_Sync_and_Conflict_Resolution.md` calls into — sync-svc is the DO + the outbox-drain QStash job (§6.3), not a separate process on `:3033`.

### 6.3 Upstash Redis + QStash topology

The seven Upstash Redis cache keys (per `research_R-GQL-EDGE-REDIS.md` Q3.2 — every TTL and invalidation rule below is from that table):

| Cache key | TTL | Invalidation | Used by |
|---|---|---|---|
| `tutor:{tutorId}:dburl` | 1h | `DEL` on db_provision mutation | Stage 7 (per-tutor DB resolution) |
| `jwks:supabase` | 10 min | none (Supabase rotates ≤1h) | Stage 2 (auth) |
| `rl:{tutorId}:{route}` | 60s sliding | none (TTL) | Stage 3 — *also* enforced authoritatively in the RateLimitObject DO; the Redis key is the cross-region projection so a request hitting a different CF colo still sees the same bucket |
| `student:{tutorId}:{studentId}` | 60s | `DEL` on student mutation | student-fn reads |
| `students:{tutorId}:list` | 30s | `DEL` on any student mutation for that tutor | student-fn list reads |
| `ledger:{tutorId}:balance` | 24h | `DEL` on new `ledger_entries` row for that tutor (append-only → safe per `10_Security.md` LEDGER-4) | ledger-fn balance reads |
| `report:{tutorId}:{reportId}:url` | 24h | none (regenerated on demand) | report-fn PDF URL cache |

The ledger balance cache is safe for 24h because the ledger is append-only — a new row is the only invalidation event, and a new row always fires the `DEL`. This is the LEDGER-4 invariant from `10_Security.md` §9 doing real work: the immutability rule is what makes the long TTL safe.

Three Upstash QStash schedules (CRON, all signed with `verifySignature` — `research_R-GQL-EDGE-REDIS.md` Q3.2):

| QStash schedule | Endpoint | Why QStash |
|---|---|---|
| `notification-svc` reminder tick | `POST https://api.buddysaradhi.app/internal/notif-tick` every 1 min | Push-based HTTP — survives Worker termination; CF Cron Triggers would also work but QStash gives at-least-once + retry/backoff out of the box |
| `sync-svc` outbox drain | `POST https://api.buddysaradhi.app/internal/outbox-drain` every 30s | Drains `sync_outbox` per-tutor; QStash retries on 5xx so a transient Turso blip doesn't lose the tick |
| `report-svc` stale-URL cleanup | `POST https://api.buddysaradhi.app/internal/report-cleanup` every 24h | Cleans expired `report:{...}:url` keys + their backing Blob objects |

QStash free tier is 500 req/day — the 1-min notification tick alone is 1440/day, so QStash moves to paid ($1/100K) at launch. The `/internal/*` routes are authenticated with a QStash signature header (`verifySignature`) — they reject anything else with `401`.

### 6.4 Local Development (so the sandbox habit doesn't come back)

A developer running the gateway locally does **not** re-introduce Caddy or per-service ports. The local stack mirrors production:

| Concern | Local | Production | Drift risk |
|---|---|---|---|
| Gateway runtime | `wrangler dev` (local V8 isolate, ports auto) | CF Workers | none — same runtime, same code |
| Durable Objects | `wrangler dev --local` (local SQLite-backed DO) | CF DO (SQLite-backed) | none — same API |
| Hot cache | local Miniflare in-memory KV (Upstash SDK's `@upstash/redis` works against a local mock) or a free-tier Upstash DB tagged `local-<dev>` | Upstash Global Redis | low — same SDK, only the URL differs |
| Per-tutor DB | local Turso (`turso dev`) or a local libSQL file | Turso cloud | none — `@prisma/adapter-libsql` accepts both |
| Auth | local Supabase (`supabase start` via the CLI) | Supabase cloud | none — same JWT RS256 + JWKS |
| Files | local filesystem via a Vercel Blob dev shim | Vercel Blob | low — signed-URL contract is identical |
| Scheduled jobs | `wrangler dev --test-scheduled` triggers the `/internal/*` routes manually | QStash CRON | none — same endpoints |

The `XTransformPort` convention and the `:3031`–`:3037` mini-service ports from the prior plan are **deleted**. A developer who wants to debug a single Worker function sets a breakpoint in `wrangler dev`; they do not start a separate process. The no-hardcode lint (§2.2) runs identically in local and CI — if a developer is tempted to paste `http://localhost:3031` into client code to "just make it work locally", the lint fails the commit.

---

## 7. Concurrency & Multithreading (summary; full spec in `19_Concurrency_and_Testing.md`)

The CF Workers + Durable Objects model inverts the prior plan's concurrency story (which assumed a Caddy + Bun multi-process mesh). The new model:

- **Cloudflare Workers are V8 isolates.** Each request runs in an isolate; isolates are multitenant (many tutors' requests share an isolate) and the runtime schedules them cooperatively on the event loop. There are no per-process threads to manage and no process pool to size. The gateway saturates the edge automatically — CF adds capacity as traffic arrives; the team never provisions a box ([developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)).
- **Durable Objects are single-threaded per object.** A `RateLimitObject` for `tutor:t_7` is the single authority for t_7's token bucket — there is no race, no lock, no CAS retry loop. A `SyncConnectionObject` for `tutor:t_7` is the single authority for t_7's WebSocket fan-out — broadcasting to t_7's other devices is a method call, not a pub/sub hop. This is the canonical use case for DOs ([developers.cloudflare.com/durable-objects/platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits)).
- **No DB connection pool to tune.** Turso is HTTP-transport (`@libsql/client/web`), so there is no TCP pool — each request is one HTTPS call. Upstash Redis is also HTTPS (REST API). The only "pool" is the module-level `Map<tutorId, PrismaClient>` per isolate, LRU-evicted at ~50 active (§4.1) — memory-bounded, no tuning.
- **CPU-bound work (PDF render, backup encryption) stays off the request path.** The `report-fn` queues PDF renders via QStash; the client polls or gets a WebSocket push. The `backup-fn` streams encryption in chunks via a `ReadableStream` so the event loop never blocks on crypto. This matches `10_Security.md` §15 (envelope encryption) and `09_Backup_and_Import_Export.md`.
- **Backpressure** is enforced at stage 3 (rate-limit DO) + a per-function concurrency cap (DO counter — max 100 in-flight per function per tutor). Overflow returns `503` with `Retry-After`, never an unbounded queue. This is identical in spirit to the prior plan; the mechanism moved from "Bun worker queue" to "DO counter", which is simpler.

The concurrency test harness in `19_Concurrency_and_Testing.md` §3 verifies this with `k6`/`autocannon` load profiles — the 500 RPS target (§10 step 6) is comfortably within a single CF Worker's envelope.

---

## 8. Error Contract

Every error response is the same shape, on every platform, for every operation:

```typescript
// packages/shared/zod/ApiError.ts — generated from openapi.json
type ApiError = {
  code: "unauthenticated" | "forbidden" | "contract_violation"
      | "not_found" | "conflict" | "rate_limited" | "storage_unavailable"
      | "upstream_violation" | "internal";
  message: string;            // human-readable, no stack trace, no PII
  retryAfterMs?: number;      // present for rate_limited / storage_unavailable
  operationId: string;        // the OpenAPI operationId, for support
  traceId: string;            // correlates to the audit_log row
};
```

The SDK throws a typed `ApiError`; clients match on `code` in a `switch`. There is no string-matching on error messages, no per-platform error parsing. A tutor sees the `message`; support sees the `traceId`.

### 8.1 Idempotency-Key (ledger mutations)

Every mutating ledger operation (`POST /api/v1/ledger/entries`, `POST /api/v1/ledger/entries/:id/void`, `POST /api/v1/receipt/attach-upload`, `POST /api/v1/sync/push`) requires an `Idempotency-Key` header — a client-generated UUID. The gateway dedupes via Upstash Redis:

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  request: POST /api/v1/ledger/entries                              │
   │           Idempotency-Key: 7c3f...e9 (UUIDv4)                      │
   │           body: { tutorId, kind:"fee_payment", amountPaise, ... }   │
   └────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  stage 4.5 (after route, before service)
        ┌──────────────────────────────────────────────────────────┐
        │  redis.SET  idem:{tutorId}:{key}  reqHash  NX  EX 86400  │
        │  ─────────────────────────────────────────────────────── │
        │  • if SET returns OK → first time seen → proceed, store  │
        │    the response in  idem:{tutorId}:{key}:resp  (EX 86400)│
        │  • if SET returns nil  → duplicate within 24h:           │
        │    - if reqHash matches stored  → replay stored response │
        │    - if reqHash differs        → 409 conflict            │
        │      (same key, different body = client bug)             │
        └──────────────────────────────────────────────────────────┘
```

The 24h TTL covers any realistic retry window (mobile offline → reconnect → outbox drain). The `reqHash` is SHA-256 of the canonicalised request body (no PII — same hash family as the audit row, `10_Security.md` §8.3). A retried POST that lost connectivity mid-flight therefore **cannot double-charge** a student — the gateway returns the stored response from the first attempt. This is the S7 gateway control from `research_R-GQL-EDGE-REDIS.md` (idempotency keys on every ledger mutation). The SDK generates the key once per logical operation and reuses it across retries.

---

## 9. What the Gateway Does NOT Do (Anti-Principles)

| Anti-pattern | Why forbidden |
|---|---|
| Gateway reads user PII to "enrich" responses | Rule 2: no network calls that process user data. The gateway routes typed bytes; it never parses ledger contents. |
| Gateway ships a telemetry SDK (PostHog, Mixpanel, …) | Rule 3: no telemetry. The audit_log is operational, not behavioural analytics. |
| Client calls a service port directly (no `:3031`, no `localhost:`) | §2.2: the no-hardcode rule. The gateway is the only ingress. The prior plan's `:3031`–`:3037` ports are gone — services are co-deployed Worker functions (§6 + `18_Microservice_Architecture.md`). |
| Gateway returns a Prisma error shape | Stage 8 rewrites every upstream error to the `ApiError` contract. Prisma internals never leak. |
| A new platform adds a new auth header | §5: one auth model. A platform difference is storage-of-token only. |
| Contract change shipped without a version bump | §2.1: breaking = major bump + parallel serve. Silent contract drift is the bug this file exists to kill. |
| **Gateway runs on a single VPS** (NEW) | The sandbox-local Caddy+ports model was effectively a single VPS. Production must be multi-region edge — Cloudflare Workers deploy to 300+ locations by default ([developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)). A single VPS is a single point of failure and a single region of latency. This is the root cause of the user's "POST/fetch not possible" report. |
| **Client hardcodes `api.buddysaradhi.app` or a version pin in source** (NEW) | §2.2: the base is an env var (`NEXT_PUBLIC_API_BASE` / `EXPO_PUBLIC_API_BASE` / `TAURI_API_BASE`); the version is the contracts tag the SDK imports. A literal hostname in client source is a CI lint failure. |
| **GraphQL becomes the primary contract** (NEW) | §2.3: REST/OpenAPI is the spine. GraphQL is a read-only BFF for dashboard fan-out, off by default in P1. Mutations, sync, and per-resource reads stay REST. Making GraphQL the primary contract would forfeit HTTP cacheability, break the no-hardcode SDK model, and add a second contract surface to drift ([api7.ai/blog/graphql-vs-rest-api-comparison-2025](https://api7.ai/blog/graphql-vs-rest-api-comparison-2025)). |
| Gateway writes the audit row to a per-tutor Turso DB | §3.1: the audit DB is gateway-owned (CF D1) so a tutor cannot alter their own audit trail. Per-tutor audit is forbidden. |

---

## 10. Implementation Order (within the Web phase, `16_Platform_Delivery_Sequence.md` §10.1)

```
   GATEWAY BUILD-OUT (part of P1: WEB IN-FLIGHT):

   1. Write contracts/openapi.json (v1.0.0) — the 5-screen surface + auth +
      sync + storage + the idempotency-key header on ledger mutations
   2. Generate packages/shared/zod + packages/shared/sdk from openapi.json
        • SDK reads NEXT_PUBLIC_API_BASE at module init (no literal hostnames)
   3. Stand up the Cloudflare Workers gateway (deployment/06_Edge_Function_Hosting.md — NEW)
        • wrangler.toml: route api.buddysaradhi.app/*
        • bindings: D1 (audit), DO classes (RateLimitObject, SyncConnectionObject),
          Upstash Redis (UPSTASH_REDIS_URL + UPSTASH_REDIS_TOKEN),
          QStash (QSTASH_TOKEN), Supabase (SUPABASE_URL + SUPABASE_ANON_KEY)
        • co-deploy ledger-fn / student-fn / sync-fn / auth-fn / report-fn
          per 18_Microservice_Architecture.md (in-process dispatch, no ports)
        • Prisma: prisma-client generator, engineType="client", runtime="cloudflare",
          @prisma/adapter-libsql; module-level Map<tutorId, PrismaClient> LRU ~50
   4. Wire provision-db Supabase Edge Function (Deno) per §5.1
        • creates Turso DB, runs migrations, writes user_metadata,
          invalidates tutor:{tutorId}:dburl in Upstash on completion
   5. Deploy; run tools/no-hardcoded-ingress.test.ts → MUST be green
        • forbidden: fetch( http:// https:// localhost: :3031 PrismaClient
                         libsql BLOB_* api.buddysaradhi.app (literal)
        • migrate apps/web/src/app/api/* → SDK calls; delete direct Prisma from clients
   6. Load harness (19_Concurrency_and_Testing.md §3) → green at 500 RPS
        • k6 profile: 500 RPS for 5 min, p95 < 200 ms, 0 errors
        • QStash schedules live: notif-tick 1m, outbox-drain 30s, report-cleanup 24h
        • D1 audit rows + Upstash list buffer in sync (sample 1% reads)
   7. Tag contracts/v1.0.0; pin apps/web to it (W3 of the Web gate)
   8. Verify in Agent Browser: every screen works through api.buddysaradhi.app
        • agent-browser navigate to https://buddysaradhi.app (Vercel)
        • every screen's data flows Vercel → CF edge → DO/Redis/Turso → response
   9. (Optional, deferred to P2 Mobile) Add GraphQL Yoga BFF at /graphql
        • generated from openapi.json GET operations, read-only,
          ENABLE_GRAPHQL_BFF flag off in P1
   ─── gateway done; web continues to W4–W7; mobile inherits the same tag ───
```

Steps 1, 2, 5 (lint), 7, 8 are unchanged in spirit from the prior plan — they were correct. Steps 3, 4, 6, 9 are rewritten: 3 swaps Caddy+ports for CF Workers + wrangler; 4 makes provision-db a Supabase Edge Function (§5.1); 6 adds the QStash schedules and the Upstash/D1 sync check; 9 adds the optional BFF as a P2 deliverable.

---

## 11. Cross-References

- `16_Platform_Delivery_Sequence.md` §7 (Boundary Rule) + §10.1 (Web phase steps) — the gateway is what makes the boundary mechanically safe; this file's §10 aligns 1:1 with §10.1 step 1.
- `18_Microservice_Architecture.md` — the services the gateway dispatches to. They are co-deployed Worker functions, not port-bound processes.
- `19_Concurrency_and_Testing.md` §3 — the gateway load + concurrency test harness (500 RPS target).
- `10_Security.md` §6 (auth), §8 (audit-log chain + tamper hashes), §9 (ledger immutability — the LEDGER-4 invariant that makes the 24h balance cache safe), §18 (the single raw-SQL exception: VACUUM, confined to `lib/db/admin.ts`).
- `11_Data_Model.md` §10 (ORM discipline) — services use Prisma ORM only; the gateway never runs SQL.
- `23_Security_Harness_Plan.md` (NEW — to be written from `research_R-GQL-EDGE-REDIS.md` + `research_R-SECURITY-HARNESS.md`) — gateway security: Durable Object rate-limit authority, idempotency-key on ledger mutations, replay window via nonce+timestamp, Workers secrets via `wrangler secret put`.
- `deployment/06_Edge_Function_Hosting.md` (NEW — to be written) — the wrangler/CF Workers deployment recipe: `wrangler.toml`, bindings, secrets, DO migration scripts, primary-vs-fallback (Supabase Edge) cutover runbook.
- `web/03_Auth_and_Provisioning.md` — the JWT + provisioning flow the gateway consumes (provision-db is now a Supabase Edge Function per §5.1).
- `mobile/04_Offline_Sync_and_Conflict_Resolution.md` — sync-fn (now the SyncConnectionObject DO + QStash outbox-drain) implements this contract.
- `research_R-GQL-EDGE-REDIS.md` — source of truth for every edge/Redis/Prisma/GraphQL claim in this file.

---

## 12. ASCII Mockup Suite (§20 Compliance)

### 12.1 The No-Hardcode Lint Result (what "green" looks like, edge edition)

```
╔══════════════════════════════════════════════════════════════════════╗
║  $ tools/no-hardcoded-ingress.test.ts                                ║
║                                                                      ║
║  scanning apps/web/**, apps/mobile/**, apps/desktop/**               ║
║  forbidden patterns: fetch(  http://  https://  localhost:           ║
║                       :\d{4}/  libsql  PrismaClient  BLOB_*          ║
║                       VITE_BLOB  @vercel/blob (in client)            ║
║                       api.buddysaradhi.app (literal hostname)        ║
║                                                                      ║
║  apps/web/      ........ 0 hits  ✅                                  ║
║       (NEXT_PUBLIC_API_BASE consumed once at sdk/init.ts)            ║
║  apps/mobile/   ........ 0 hits  ✅  (locked — not yet created)      ║
║  apps/desktop/  ........ 0 hits  ✅  (locked — not yet created)      ║
║                                                                      ║
║  RESULT: PASS — all clients use packages/shared/sdk only.            ║
║  The API base is an env var; the version is the contracts tag.       ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 12.2 A Request Through the New Pipeline (annotated)

```
 client: sdk.ledger.listEntries({ tutorId:"t_7", since:"2026-06-01" })
   │
   │  Authorization: Bearer <jwt>           (stage 1 TLS via CF edge, HTTP/3)
   │  Host: api.buddysaradhi.app            (resolved from NEXT_PUBLIC_API_BASE)
   ▼
 ┌─[1 TLS]── CF edge terminates TLS + HTTP/3; built-in DDoS + WAF ────────┐
 ┌─[2 AUTH]── JWKS fetched once, cached in Upstash jwks:supabase (10m) ───┐
 │           verify RS256 → ctx.tutorId = "t_7"                           ┐
 ┌─[3 LIMIT]── RateLimitObject DO (tutor:t_7) token bucket: 42/300/min ───┐
 │             single-threaded per tutor → no race; if over → 429         ┐
 ┌─[4 ROUTE]── GET /api/v1/ledger  operationId=ledgerListEntries          ┐
 │            zod validate { tutorId, since } → ok                        ┐
 ┌─[5 SVC]──── in-process dispatch → ledger-fn (no port, no HTTP hop) ─────┐
 ┌─[6 AUTHZ]── tutor t_7 may read tutor t_7's ledger — ok                 ┐
 ┌─[7 STORE]── Redis cache-aside:                                         ┐
 │            1. GET ledger:t_7:balance → HIT? return cached balance      ┐
 │            2. resolve tutor:t_7:dburl from Redis (HIT, 1h TTL)         ┐
 │            3. PrismaClient from module Map<tutorId, PrismaClient>      ┐
 │               (WASM QC, @prisma/adapter-libsql → Turso HTTPS)          ┐
 │            4. db.ledgerEntry.findMany({ where:{ tutorId, ...} })       ┐
 │            5. SET ledger:t_7:balance (24h TTL — append-only safe)      ┐
 ┌─[8 SHAPE]── response zod-validated vs openapi.json LedgerEntry[] ─ ok ─┐
 ┌─[9 AUDIT]── ctx.waitUntil:                                              ┐
 │            • D1 audit_log INSERT (gateway-owned, hash-chained)         ┐
 │            • Upstash RPUSH audit:recent:t_7 + LTRIM 0 49               ┐
   │
   ▼
 client receives: Result.ok(LedgerEntry[])  — typed, no surprises
```

### 12.3 Upstash Redis Cache-Aside Flow (hit / miss / invalidation)

```
   client            gateway Worker              Upstash Redis            Turso (per-tutor)
     │                     │                          │                        │
     │ 1 GET /students     │                          │                        │
     ├────────────────────▶│                          │                        │
     │                     │ 2 GET students:t_7:list  │                        │
     │                     ├─────────────────────────▶│                        │
     │                     │                          │                        │
     │                     │   ┌── HIT ──┐            │                        │
     │                     │   │ 30s TTL │            │                        │
     │                     │◀──┤ valid?  ┤────────────┤                        │
     │                     │   └─────────┘            │                        │
     │                     │ 3a return cached list    │                        │
     │◀──── Result.ok([]) ─┤                          │                        │
     │                     │                          │                        │
     │   (cache MISS path — TTL expired or first call)                        │
     │                     │ 2' GET students:t_7:list │                        │
     │                     ├─────────────────────────▶│                        │
     │                     │◀──── nil ────────────────┤                        │
     │                     │ 3' Prisma findMany       │                        │
     │                     │    (tutor:t_7:dburl HIT)  │                        │
     │                     ├──────────────────────────────────────────────────▶│
     │                     │◀──── Student[] ───────────────────────────────────┤
     │                     │ 4' SET students:t_7:list  Student[]  EX 30        │
     │                     ├─────────────────────────▶│                        │
     │                     │ 5' return list           │                        │
     │◀──── Result.ok([]) ─┤                          │                        │
     │                     │                          │                        │
     │   (INVALIDATION path — student mutation)                                │
     │  POST /students     │                          │                        │
     ├────────────────────▶│                          │                        │
     │                     │ ... mutate via Prisma ...│                        │
     │                     │ DEL students:t_7:list    │                        │
     │                     ├─────────────────────────▶│                        │
     │                     │ DEL student:t_7:{id}     │                        │
     │                     ├─────────────────────────▶│                        │
     │◀──── Result.ok(...) ┤                          │                        │
     │                     │                          │                        │

   note: ledger balance uses 24h TTL (append-only → safe); student uses 30/60s
   (mutable → short TTL + explicit DEL). Never cache writes; cache reads only.
```

### 12.4 Durable Object WebSocket Hibernation Lifecycle

```
╔═══════════════════════════════════════════════════════════════════════════╗
║  SyncConnectionObject  (Durable Object, sharded by tutor:<tutorId>)       ║
║  state: SQLite-backed; billed only on message (Hibernation API)           ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                         ║
║   t=0s   client connects:                                               ║
║          wss://api.buddysaradhi.app/sync?token=<jwt>                    ║
║          └─▶ CF edge routes to DO(tutor:t_7)                            ║
║                └─▶ DO verifies JWT (JWKS from Upstash, 10 min cache)    ║
║                └─▶ DO calls acceptWebSocket(ws)                         ║
║                └─▶ connection HIBERNATES — zero compute billed          ║
║                                                                         ║
║   t=0s..4h   idle. NO compute. NO per-connection charge.                ║
║              Connection lives in CF's global WS fabric.                  ║
║                                                                         ║
║   t=4h12m   mobile client sends sync_push with outbox batch:            ║
║             └─▶ CF wakes the DO (compute starts)                        ║
║             └─▶ DO webSocketMessage():                                  ║
║                   • for each outbox row: write to Turso (Prisma)        ║
║                   • ack row in sync_outbox                              ║
║                   • broadcast to other WS connections of tutor t_7      ║
║                     (e.g. desktop client online — receives push)        ║
║             └─▶ DO returns to hibernation                               ║
║                                                                         ║
║   t=4h13m   desktop client disconnects (user closed app):               ║
║             └─▶ DO webSocketClose() — remove from connection set        ║
║                                                                         ║
║   t=4h30m   QStash fires outbox-drain (every 30s):                      ║
║             └─▶ POST /internal/outbox-drain                             ║
║             └─▶ DO fetches stale outbox rows, replays them              ║
║             └─▶ (safety net for clients that went offline mid-push)     ║
║                                                                         ║
║   billing: only t=4h12m and t=4h13m and t=4h30m bill compute.           ║
║            4h12m of idle hibernation = $0.                              ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### 12.5 GraphQL BFF Fan-Out (dashboard query → 3 REST calls composed → one response)

```
   client (dashboard, mobile P2)          CF edge Worker
     │                                       │
     │  POST /graphql                        │
     │  { dashboard(tutorId:"t_7") {         │
     │     kpi { collectedPaise arrearsPaise │
     │           studentCount }              │
     │     recentLedger(limit:5) { id kind   │
     │           amountPaise ts }            │
     │     attendance { weekPresent         │
     │           weekAbsent }                │
     │  } }                                  │
     ├──────────────────────────────────────▶│
     │                                       │
     │                  ┌────────────────────┼────────────────────┐
     │                  │  Yoga resolver fans out (in-process):    │
     │                  │                                          │
     │                  │  ┌─ ledger-fn.balance(t_7)      ──┐      │
     │                  │  ├─ ledger-fn.recentEntries(5)  ──┤      │
     │                  │  └─ report-fn.attendanceSummary ─┘      │
     │                  │   (all hit Upstash cache; ~5ms total)   │
     │                  └──────────────────────────────────┬──────┘
     │                                                  │
     │                                                  ▼
     │  { "data": { "dashboard": {                     │
     │      "kpi": { "collectedPaise": 12660000, ... }, │
     │      "recentLedger": [ {id,kind,amountPaise,ts}, │
     │        ... 5 entries ],                          │
     │      "attendance": { "weekPresent": 184, ... }   │
     │  } } }                                          │
     │◀─────────────────────────────────────────────────┤
     │                                                  │
     │  (one HTTPS round-trip instead of three;        │
     │   GraphQL layer is read-only; mutations         │
     │   still go to POST /api/v1/ledger/entries)      │
     │                                                  │
     │  ── on BFF error: SDK catches, falls back to ── │
     │     three parallel REST calls (GET /ledger,     │
     │     GET /ledger?recent=5, GET /attendance);     │
     │     dashboard renders identically (slower).     │
```

---

## 13. Summary (the whole file in five lines)

1. **One edge domain** — `api.buddysaradhi.app` on Cloudflare Workers; web+mobile+desktop all call it over HTTPS relative paths; no `:3031`-style ports, no `localhost`, no Caddy in production.
2. **One contract tag** — `contracts/vX.Y.Z`; OpenAPI is the spine; GraphQL is an optional read-only BFF, off by default in P1.
3. **Stateful concerns in Durable Objects** — rate-limit token bucket per tutor + WebSocket sync via Hibernation API; both single-threaded per tutor, no race, no per-connection compute billed.
4. **Hot reads in Upstash Redis** — 7 cache keys + 3 QStash schedules; ledger balance safe at 24h TTL because the ledger is append-only (`10_Security.md` LEDGER-4).
5. **The contract, the audit row, the no-hardcode rule, the error contract — unchanged.** Only the HOSTING migrated: Caddy+ports → CF Workers+DO. The sandbox dev proxy was the bug; the contract-first framing was always right.
