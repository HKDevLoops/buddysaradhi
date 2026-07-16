# 06 — Edge Function Hosting (Cloudflare Workers + Durable Objects primary, Supabase Edge fallback)

> The concrete deployment recipe for hosting the API gateway + `db_provision` + all 7 microservices (ledger / student / attendance / sync / report / notification / auth) as one Cloudflare Workers deployment fronting one HTTPS edge domain (`api.buddysaradhi.app`), with Supabase Edge Functions as the documented fallback runtime. This is the HOW-TO for `17_API_Gateway_System.md` §6 (gateway in production) and the expansion of `18_Microservice_Architecture.md` §7 (the wrangler.toml skeleton). The three platforms — Next.js 16 web (Vercel), Expo mobile, Tauri desktop — all hit the same edge domain over HTTPS. This file is the answer to user requirement #1 ("update the deployment of api gateway + db_provision + all microservices and make sure to host as a cloud/edge function") and requirement #3 ("must be such that all the platforms desktop mobile, website and other must be able to use same cloud function").

Last updated: Task 06-EDGE-HOSTING

---

## 0. What This File Adds

The `deployment/` folder already contains:

| File | Owns |
|---|---|
| `01_Vercel_Hosting.md` | Vercel account + project setup for the **web frontend** (Next.js 16, App Router). Cross-cutting Vercel concerns: env-var matrix, domains, preview vs. production, free-tier limits. |
| `02_Vercel_Blob_Build_Storage.md` | Vercel Blob for **desktop installer artifacts + APK mirror** + signed-URL contract. |
| `03_EAS_Build_and_Update_Channels.md` | Expo Application Services for **mobile** (Android + iOS) build channels + OTA updates. |
| `04_Release_Pipeline.md` | The end-to-end `git tag v1.x.y` → all three surfaces live rhythm. |
| `05_CI_CD_GitHub_Actions.md` | The CI/CD pipeline skeleton shared across all three platforms. |
| `06_Edge_Function_Hosting.md` ← **THIS FILE** | The **edge function** hosting recipe for the shared cloud function (gateway + services + db_provision) that all three platforms call. CF Workers + Durable Objects primary, Supabase Edge fallback. |

**Non-overlap statement.** Files `01`-`05` cover the **client surfaces** (web hosting, blob storage, mobile build, release rhythm, CI/CD). This file covers the **server edge** — the single HTTPS cloud function (`api.buddysaradhi.app`) the clients call. The CI/CD pipeline in `05_CI_CD_GitHub_Actions.md` is the cross-platform harness; this file's §10 extends it with the edge-deploy stage (`wrangler deploy` + smoke test). The Vercel hosting in `01_Vercel_Hosting.md` is for the web **frontend** (`buddysaradhi.app`); this file is for the **edge backend** (`api.buddysaradhi.app`). The two are different subdomains, different providers (Vercel + Cloudflare), and different responsibilities — they share only the Vercel account (Blob is on Vercel, web is on Vercel) and the GitHub repo.

**What changed from the prior plan.** The prior deployment model assumed a Caddy reverse proxy + Bun mini-service processes on ports `:3031`-`:3037` running inside a dev sandbox — a model that did not translate to a deployable system and is the root cause of the user's "POST/fetch is not working" report. `17_API_Gateway_System.md` §6 rewrote the gateway spec; `18_Microservice_Architecture.md` §7 rewrote the services spec. Both reference this file as the concrete recipe. This file delivers that recipe: accounts, CLI tools, project layout, `wrangler.toml`, Prisma config, `db_provision`, Upstash wiring, client wiring, local dev, CI/CD, rollback, observability.

---

## 1. The Target Topology

One edge domain (`api.buddysaradhi.app`) fronting one Cloudflare Workers deployment. Three clients (web + mobile + desktop) all hit the same domain over HTTPS. Stateful concerns (sync WebSocket + rate-limit) live in Cloudflare Durable Objects. Hot cache + Pub/Sub live in Upstash Redis (Global, REST). Scheduled work lives in Upstash QStash. Per-tutor data lives in Turso/libSQL DBs via Prisma v6.16 + `@prisma/adapter-libsql`. Auth + provisioning live in Supabase (JWT RS256 + JWKS + one Deno Edge Function). Files live in Vercel Blob. The audit log lives in Cloudflare D1 (gateway-owned — a tutor cannot alter it).

```
                ┌─────────────────────────────────────────────────────────────────────┐
                │                THREE CLIENTS — same SDK, same domain                │
                │                                                                     │
                │   apps/web (Next.js 16 on Vercel)   apps/mobile (Expo / EAS)        │
                │   NEXT_PUBLIC_API_BASE              EXPO_PUBLIC_API_BASE            │
                │   = https://api.buddysaradhi.app    = https://api.buddysaradhi.app  │
                │                                                                     │
                │   apps/desktop (Tauri v2)                                           │
                │   TAURI_API_BASE (compiled from build env, never a source literal)  │
                │   = https://api.buddysaradhi.app                                    │
                └────────────────────────────────┬────────────────────────────────────┘
                                                 │
                                                 │  HTTPS (TLS 1.3 + HSTS)
                                                 │  relative paths under base
                                                 │  /api/v1/* /sync /graphql /health
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │   api.buddysaradhi.app   (CF DNS, orange)    │
                          │   CF global edge — HTTP/3 + DDoS + WAF       │
                          └──────────────────────────┬───────────────────┘
                                                     │
                                                     │  ONE wrangler deploy
                                                     │  (workers/gateway/, ~10 MB max)
                                                     ▼
        ┌────────────────────────────────────────────────────────────────────────────┐
        │              Cloudflare Workers — buddysaradhi-gateway                     │
        │              src/router.ts dispatches by route prefix                      │
        │                                                                            │
        │   /api/v1/ledger/*        → services/ledger/handlers.ts                   │
        │   /api/v1/students/*      → services/student/handlers.ts                  │
        │   /api/v1/attendance/*    → services/attendance/handlers.ts               │
        │   /api/v1/sync/*          → services/sync/handlers.ts  (upgrades → SyncDO)│
        │   /api/v1/reports/*       → services/report/handlers.ts (5min CPU)        │
        │   /api/v1/notifications/* → services/notification/handlers.ts             │
        │   /api/v1/auth/*          → services/auth/handlers.ts                     │
        │   /internal/*             → QStash-signed only (notif-tick/outbox/cleanup)│
        │   /health                 → aggregator (calls each svc /health)           │
        └────┬───────────────────┬──────────────────┬──────────────────┬───────────┘
             │                   │                  │                  │
             ▼                   ▼                  ▼                  ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐
   │ Durable Objects │  │ Upstash Redis   │  │ Upstash QStash  │  │ Supabase       │
   │ (SQLite-backed) │  │ (Global, REST)  │  │ (3 CRON POSTs)  │  │ (Auth + Edge)  │
   │                 │  │                 │  │                 │  │                │
   │ • SyncDO        │  │ • 7 cache keys  │  │ • notif-tick 1m │  │ • JWT RS256    │
   │   per tutor     │  │ • Pub/Sub 4ch   │  │ • outbox 30s    │  │ • JWKS         │
   │   Hibernation   │  │ • no pool       │  │ • cleanup 24h   │  │ • provision-db │
   │ • RateLimitDO   │  │   (HTTPS only)  │  │ • verifySig     │  │   (Deno EF)    │
   │   per tutor     │  │                 │  │                 │  │                │
   └─────────────────┘  └────────┬────────┘  └─────────────────┘  └───────┬────────┘
                                 │                                         │
                                 │ resolve tutorId → dbUrl                 │ POST
                                 │ (tutor:{id}:dburl, TTL 1h)              │ /internal/provision
                                 ▼                                         ▼
                          ┌──────────────────┐                  ┌──────────────────────┐
                          │ Turso / libSQL   │                  │ Cloudflare D1        │
                          │ per-tutor DBs    │                  │ (gateway-owned)      │
                          │                  │                  │                      │
                          │ Prisma v6.16 +   │                  │ audit_log            │
                          │ @prisma/         │                  │ (append-only +       │
                          │ adapter-libsql   │                  │  tamper hash chain)  │
                          │                  │                  │                      │
                          │ Map<tutorId,     │                  │ Workers Analytics +  │
                          │  PrismaClient>   │                  │ Logs (tail)          │
                          │  LRU ~50 / iso   │                  │                      │
                          └──────────────────┘                  └──────────────────────┘

                          ┌──────────────────┐
                          │ Vercel Blob      │
                          │ (files, signed)  │
                          │ gateway mints    │
                          └──────────────────┘
```

The five external dependencies (Cloudflare, Upstash, Turso, Supabase, Vercel) are each replaceable in isolation: Vercel Blob → R2, Upstash → Upstash-compatible Redis, Turso → Cloudflare D1, Supabase Auth → Clerk, Cloudflare Workers → Supabase Edge Functions (§6 fallback). The contract, the audit row, the rate-limit semantics, and the SDK are all identical between primary and fallback — only the runtime changes ([research_R-GQL-EDGE-REDIS.md](../../research_R-GQL-EDGE-REDIS.md) Q2.3).

**Why Cloudflare Workers + Durable Objects primary** (per `research_R-GQL-EDGE-REDIS.md` Q2.3): CF Workers+DO wins on every axis — stateful WebSocket sync via DO Hibernation (unmatched, [developers.cloudflare.com/durable-objects/best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets)), CPU headroom (30 s default → 5 min max vs. Vercel 300 s vs. Supabase 400 s bg), code-size budget (10 MB compressed vs. Vercel Edge's 1-4 MB), subrequest budget (10,000 vs. unspecified), first-class Prisma v6.16 WASM support ([prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare](https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare)). Vercel Edge is **not recommended** as primary — Vercel themselves recommend migrating from Edge to Node.js for "improved performance and reliability" ([vercel.com/docs/functions/runtimes/edge](https://vercel.com/docs/functions/runtimes/edge)), the 1-4 MB code-size cap is too tight for the 7-service Prisma bundle, and WebSockets aren't supported on the Edge runtime.

---

## 2. Prerequisites

### 2.1 Accounts

| Account | Plan | Why | Cite |
|---|---|---|---|
| **Cloudflare** | Workers Paid ($5/mo) for production; Free (100K req/day) for dev | Workers Paid: no daily req cap, 5 min CPU/req, 128 MB memory, 10K subrequests, 10 MB compressed code, <1 s startup. Free tier is fine for beta — switch to Paid before public launch. | [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits) |
| **Cloudflare** | Durable Objects (included in Workers Paid) | Unlimited Objects, 500 classes/account, 10 GB storage/Object, ~1K req/s per Object, SQLite-backed, WebSocket Hibernation API. | [developers.cloudflare.com/durable-objects/platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits) |
| **Cloudflare** | D1 (Free 5 GB / Paid per-GB) | Gateway-owned `audit_log` (append-only + tamper hash chain per `10_Security.md` §8). | [developers.cloudflare.com/d1](https://developers.cloudflare.com/d1) |
| **Upstash** | Redis Global (Free 256 MB / 500K cmd/mo / 10 GB bw) + QStash (Free 500 req/day) | Hot cache (7 keys) + Pub/Sub (4 channels) + 3 CRON schedules. Pick **Global** database type to minimize latency from all edge locations. QStash free = 500/day = 21/hr — the 1-min notif-tick alone is 1440/day, so QStash moves to paid ($1/100K) at launch. | [upstash.com/pricing/redis](https://upstash.com/pricing/redis); [upstash.com/blog/qstash-announcement](https://upstash.com/blog/qstash-announcement) |
| **Turso** | Free (500 DBs, 9 GB total) → paid per-DB | One DB per tutor (`research_R-GQL-EDGE-REDIS.md` Q2 multi-tenancy). Free tier covers the 250-tutor beta. | [turso.tech/multi-tenancy](https://turso.tech/multi-tenancy) |
| **Supabase** | Free (50K MAU) → paid | Auth (JWT RS256 + JWKS, [supabase.com/docs/guides/auth/signing-keys](https://supabase.com/docs/guides/auth/signing-keys)) + Edge Functions (Deno) + provision-db Edge Function. | [supabase.com/docs/guides/functions](https://supabase.com/docs/guides/functions) |
| **Vercel** | Hobby → Pro | Web frontend (`buddysaradhi.app`) + Vercel Blob (file storage — see `02_Vercel_Blob_Build_Storage.md`). | [vercel.com/docs](https://vercel.com/docs) |

### 2.2 CLI tools (versions cited from `research_R-GQL-EDGE-REDIS.md`)

| Tool | Version (Oct 2025) | Purpose |
|---|---|---|
| `wrangler` | ≥ 3.99 | Cloudflare Workers + DO + D1 deploy, secret management, local dev (`wrangler dev`). `npm i -g wrangler` or `bunx wrangler`. |
| `@upstash/redis` | ≥ 1.34 | Upstash Redis client (REST, no pool — designed for the edge). `bun add @upstash/redis`. |
| `@upstash/qstash` | ≥ 2.6 | QStash client + `verifySignature` middleware. `bun add @upstash/qstash`. |
| `@libsql/client` | ≥ 6.0 | Turso/libSQL HTTP client (`@libsql/client/web` — edge transport). `bun add @libsql/client`. |
| `@prisma/adapter-libsql` | ≥ 6.16 | Prisma driver adapter for Turso. GA in Prisma v6.16.0 (Sep 10, 2025). `bun add @prisma/adapter-libsql`. |
| `prisma` (CLI) | ≥ 6.16 | Schema migration + client generation (ESM-first `prisma-client` generator, `engineType = "client"`, WASM Query Compiler). | 
| `@prisma/client` | ≥ 6.16 | The generated client base (used with the adapter). |
| `turso-cli` | ≥ 1.10 | `turso db create`/`turso db tokens` for `db_provision` (drives Turso org API). |
| `supabase-cli` | ≥ 1.219 | `supabase functions deploy` for the provision-db Edge Function; `supabase start` for local dev. |
| `bun` | ≥ 1.3 | Workspace install + script runner across `apps/web`, `apps/mobile`, `apps/desktop`, `packages/shared`, `workers/gateway`. |

Cite: [prisma.io/blog/rust-free-prisma-orm-is-ready-for-production](https://www.prisma.io/blog/rust-free-prisma-orm-is-ready-for-production); [prisma.io/changelog](https://www.prisma.io/changelog); [docs.turso.tech/sdk/ts/orm/prisma](https://docs.turso.tech/sdk/ts/orm/prisma); [supabase.com/docs/guides/functions](https://supabase.com/docs/guides/functions).

---

## 3. Project Layout

The gateway lives in `workers/gateway/` at the monorepo root, alongside `apps/{web,mobile,desktop}` and `packages/shared`. The `mini-services/` folder from the prior plan is **deprecated for production** — kept only as a legacy dev fallback (§9.2).

```
buddysaradhi/                                # monorepo root (bun workspaces)
├── apps/
│   ├── web/                                  # Next.js 16 on Vercel (01_Vercel_Hosting.md)
│   ├── mobile/                               # Expo / EAS (03_EAS_Build_and_Update_Channels.md)
│   └── desktop/                              # Tauri v2 (desktop/*)
├── packages/
│   └── shared/                               # SDK + Zod schemas (consumed by all 3 apps)
│       ├── src/
│       │   ├── sdk/                          # generated from contracts/openapi.json
│       │   ├── zod/                          # generated from contracts/openapi.json
│       │   └── config.ts                     # reads *_API_BASE at module init
│       └── package.json
├── contracts/
│   └── openapi.json                          # contract source of truth (17 §2)
├── workers/
│   └── gateway/                              # ← THIS FILE'S SUBJECT
│       ├── wrangler.toml                     # §4 — full annotated skeleton
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── router.ts                     # route-prefix dispatcher (17 §1)
│       │   ├── index.ts                      # default export fetch() handler
│       │   ├── env.ts                        # typed Env bindings (DOs, secrets, vars)
│       │   ├── middleware/
│       │   │   ├── auth.ts                   #   JWT verify (JWKS cached in Upstash)
│       │   │   ├── ratelimit.ts              #   RateLimitDO + Upstash rl:{id}:{route}
│       │   │   ├── audit.ts                  #   write audit_log row to D1
│       │   │   ├── idempotency.ts            #   Idempotency-Key on ledger mutations
│       │   │   └── error.ts                  #   8-code ApiError (17 §8)
│       │   ├── services/                     # the 7 microservices (18 §1)
│       │   │   ├── ledger/handlers.ts
│       │   │   ├── student/handlers.ts
│       │   │   ├── attendance/handlers.ts
│       │   │   ├── sync/handlers.ts          # upgrades WebSocket → SyncDO
│       │   │   ├── report/handlers.ts        # 5min CPU; PDF via QStash
│       │   │   ├── notification/handlers.ts
│       │   │   └── auth/handlers.ts          # calls provision-db Supabase Edge Fn
│       │   ├── do/
│       │   │   ├── SyncDO.ts                 # WebSocket Hibernation per tutor:<id>
│       │   │   └── RateLimitDO.ts            # token-bucket authority per tutor:<id>
│       │   ├── internal/
│       │   │   ├── notif-tick.ts             # QStash 1m  (17 §6.3)
│       │   │   ├── outbox-drain.ts           # QStash 30s (18 §4.2)
│       │   │   └── report-cleanup.ts         # QStash 24h (17 §6.3)
│       │   ├── lib/
│       │   │   ├── prisma.ts                 # Map<tutorId, PrismaClient> LRU ~50 / iso
│       │   │   ├── turso.ts                  # resolve tutorId → dbUrl (Upstash)
│       │   │   ├── upstash.ts                # Redis + QStash clients (REST)
│       │   │   ├── audit.ts                  # D1 append + tamper hash
│       │   │   └── admin.ts                  # VACUUM raw-SQL exception (10 §18)
│       │   └── health.ts                     # /health aggregator
│       ├── prisma/
│       │   ├── schema.ledger.prisma          # ledger_entries, etc.
│       │   ├── schema.student.prisma         # students, guardians
│       │   ├── schema.attendance.prisma      # sessions, attendance
│       │   ├── schema.sync.prisma            # sync_outbox, sync_state
│       │   ├── schema.report.prisma          # reports, report_artifacts
│       │   ├── schema.notification.prisma    # notifications, devices
│       │   ├── schema.auth.prisma            # sessions (mirror of Supabase auth)
│       │   ├── schema.combined.prisma        # all models — for migrate diff
│       │   └── migrations/                   # forward-only migration SQL
│       ├── migrations/
│       │   └── 0001_init.sql                 # D1 audit_log schema (gateway-owned)
│       └── test/
│           ├── no-hardcoded-ingress.test.ts  # the no-hardcode lint (17 §2.2)
│           ├── contract.test.ts              # SDK ↔ openapi.json parity
│           └── load/                         # k6 / autocannon profiles
├── supabase/
│   └── functions/
│       └── provision-db/                     # Deno Edge Function (§6)
│           ├── index.ts
│           └── deno.json
└── mini-services/                            # DEPRECATED for production (§9.2 legacy dev)
    └── README.md                             # says "do not use in prod — see 18 §7.1"
```

The `packages/shared/` workspace is the **single SDK** that the three apps consume. It is generated from `contracts/openapi.json` (the contract spine per `17_API_Gateway_System.md` §2). The SDK reads the platform-specific env var (`NEXT_PUBLIC_API_BASE` / `EXPO_PUBLIC_API_BASE` / `TAURI_API_BASE`) once at module init — no hostnames are hardcoded anywhere in `apps/*` source (the no-hardcode lint enforces this — `17_API_Gateway_System.md` §2.2).

---

## 4. The wrangler.toml

This is the full annotated skeleton. The abridged version in `18_Microservice_Architecture.md` §7 + §12.5 is the same shape; this section expands every binding, var, secret, and CI-relevant comment so a release-engineering agent can deploy cold.

```toml
# workers/gateway/wrangler.toml — One deployment. One bundle. One domain. Three platforms.
# Cite: https://developers.cloudflare.com/workers/platform/limits
#       https://developers.cloudflare.com/durable-objects/platform/limits

name              = "buddysaradhi-gateway"
main              = "src/index.ts"           # default export: fetch(request, env, ctx)
compatibility_date = "2025-10-01"
compatibility_flags = ["nodejs_compat"]       # required for @prisma/adapter-libsql WASM

# ─── ROUTE — one edge domain, every platform calls it. ───────────────────────
# Cite: https://developers.cloudflare.com/workers/configuration/routing/routes
# ─────────────────────────────────────────────────────────────────────────────
routes = [
  { pattern = "api.buddysaradhi.app/*", zone_name = "buddysaradhi.app", custom_domain = false }
]

# (Optional) workers_dev = false to disable the *.workers.dev preview URL in prod.
workers_dev = false

# ─── DURABLE OBJECT BINDINGS — the only stateful services. ───────────────────
#   SyncDO        — per tutor:<tutorId>  (WebSocket Hibernation)
#   RateLimitDO   — per tutor:<tutorId>  (token-bucket authority)
# Cite: https://developers.cloudflare.com/durable-objects/best-practices/websockets
#       https://developers.cloudflare.com/durable-objects/platform/limits
# ─────────────────────────────────────────────────────────────────────────────
[[durable_objects.bindings]]
name       = "SYNC_DO"
class_name = "SyncDO"

[[durable_objects.bindings]]
name       = "RATE_LIMIT_DO"
class_name = "RateLimitDO"

# DO migration tag — bump on schema change to the DO storage format.
# Cite: https://developers.cloudflare.com/durable-objects/reference/sqlite-in-durable-objects
[[migrations]]
tag          = "v1"
new_sqlite_classes = ["SyncDO", "RateLimitDO"]

# ─────────────────────────────────────────────────────────────────────────────
# D1 BINDING — gateway-owned audit_log (append-only + tamper hash chain).
#   The tutor cannot alter it (it's not in their per-tutor Turso DB).
#   10_Security.md §8 — audit_log is gateway-owned by design.
# ─────────────────────────────────────────────────────────────────────────────
[[d1_databases]]
binding       = "AUDIT_DB"
database_name = "buddysaradhi-audit"
database_id   = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # from `wrangler d1 create`

# ─────────────────────────────────────────────────────────────────────────────
# VARS (non-secret) — set inline; rotated by editing this file + redeploy.
# ─────────────────────────────────────────────────────────────────────────────
[vars]
# Upstash Redis (Global, REST API). Cite: https://upstash.com/docs/redis/features/restapi
UPSTASH_REDIS_REST_URL   = "https://xxx-xxx.upstash.io"

# Supabase — public URL + anon key (anon is fine in vars; service_role is a secret below).
SUPABASE_URL             = "https://xxx.supabase.co"
SUPABASE_ANON_KEY        = "eyJhbGciOi..."          # public, fine in vars

# Turso org — used by the gateway to resolve per-tutor DBs (the API token is a secret).
TURSO_ORG                = "buddysaradhi"

# Vercel Blob — base URL + read-only token; the write token is a secret.
BLOB_BASE_URL            = "https://xxx.public.blob.vercel-storage.com"

# Environment marker — the SDK + clients branch on this for telemetry.
DEPLOY_ENV               = "production"             # | "preview" | "development"

# Feature flags — read by router.ts; default off in prod until P2.
ENABLE_GRAPHQL_BFF       = "false"                  # 17 §2.3 — P2 deliverable

# ─────────────────────────────────────────────────────────────────────────────
# SECRETS — set via `wrangler secret put <NAME>`, NEVER in this file.
#   Cite: https://developers.cloudflare.com/workers/configuration/secrets
# Each secret is encrypted at rest and only decrypted inside the Worker isolate.
# ─────────────────────────────────────────────────────────────────────────────
#   UPSTASH_REDIS_REST_TOKEN          (read+write to the Redis DB)
#   UPSTASH_QSTASH_TOKEN              (publish + schedule)
#   UPSTASH_QSTASH_CURRENT_SIGNING_KEY (verify /internal/* signatures)
#   UPSTASH_QSTASH_NEXT_SIGNING_KEY   (rotation — read alongside CURRENT)
#   SUPABASE_SERVICE_ROLE_KEY         (used ONLY by provision-db Supabase Edge Fn,
#                                      NOT by this Worker — documented for parity)
#   TURSO_API_TOKEN                   (org-level — gateway uses to list/create DBs
#                                      in the rare path; per-DB tokens are per-tutor)
#   BLOB_WRITE_TOKEN                  (Vercel Blob — mint signed URLs)

# ─────────────────────────────────────────────────────────────────────────────
# OBSERVABILITY — Workers Analytics + Logs.
# Cite: https://developers.cloudflare.com/workers/observability/logs
# ─────────────────────────────────────────────────────────────────────────────
[observability]
enabled = true
head_sampling_rate = 1            # 100% sampled in prod; drop to 0.1 at scale

# ─────────────────────────────────────────────────────────────────────────────
# LIMITS — per-Worker CPU. Default 30s; bumped to 5 min for report-svc PDF.
# Cite: https://developers.cloudflare.com/workers/platform/limits
# ─────────────────────────────────────────────────────────────────────────────
[limits]
cpu_ms = 300000                   # 5 min max — only report-svc hits this;
                                  # others override per-route via ctx.waitUntil

# ─────────────────────────────────────────────────────────────────────────────
# NO KV NAMESPACES — Upstash Redis replaces KV for caching (research Q3).
# (KV is a last-resort fallback if Upstash is down — wired in lib/upstash.ts,
#  not declared here. The cache-aside helper falls through to Turso on miss.)
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# NO CRON TRIGGERS — scheduled work is in Upstash QStash (§7).
# (CF Cron Triggers would also work but QStash gives at-least-once + retry/backoff
#  out of the box — research_R-GQL-EDGE-REDIS.md Q3.1.)
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# BUILD — bundle the Prisma WASM Query Compiler (v6.16+ static import).
# The @prisma/adapter-libsql + libsql/client/web are ESM and import cleanly.
# ─────────────────────────────────────────────────────────────────────────────
[build]
command = "bun run build:gateway"   # generates per-service Prisma clients first
```

**Secrets rotation.** Every secret has a CURRENT + NEXT pair (Upstash QStash calls this the "grace period" — [upstash.com/docs/qstash](https://upstash.com/docs/qstash)). The verify step accepts either; rotation = swap CURRENT ← NEXT, generate a new NEXT, redeploy. The audit log records each rotation (D1 `audit_log` row with `action="secret_rotated"`).

**Bundle size check.** The 7 services + Prisma WASM + the router + middleware must stay under **10 MB compressed** (CF Workers Paid limit — [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)). The Prisma WASM QC is ~1.2 MB compressed (research Q4.4); per-service Prisma clients are small (each client only includes its own models per `18_Microservice_Architecture.md` §5.2). The `bun run build:gateway` script runs `wrangler deploy --dry-run` first and fails the build if the bundle exceeds 9 MB (safety margin).

---

## 5. Prisma on the Edge

Prisma ORM v6.16.0 (Sep 10, 2025) is the inflection point: the Rust query engine is gone, driver adapters are GA, and a new ESM-first `prisma-client` generator with `engineType = "client"` + `runtime = "cloudflare"` uses a WASM Query Compiler that loads via static `import` (not `WebAssembly.instantiate`) — runs on Cloudflare Workers, Vercel Edge, and Supabase Edge alike ([prisma.io/blog/rust-free-prisma-orm-is-ready-for-production](https://www.prisma.io/blog/rust-free-prisma-orm-is-ready-for-production); [prisma.io/changelog](https://www.prisma.io/changelog)). For Turso per-user DBs: `@prisma/adapter-libsql` ([docs.turso.tech/sdk/ts/orm/prisma](https://docs.turso.tech/sdk/ts/orm/prisma)). For CF D1: `@prisma/adapter-d1` ([blog.cloudflare.com/prisma-orm-and-d1](https://blog.cloudflare.com/prisma-orm-and-d1)).

### 5.1 The per-service schema (`prisma/schema.<service>.prisma`)

```prisma
// workers/gateway/prisma/schema.ledger.prisma — only ledger's models.
// Same shape for schema.{student,attendance,sync,report,notification,auth}.prisma.

generator client {
  provider   = "prisma-client"          // ESM-first, v6.16+ (replaces "prisma-client-js")
  engineType = "client"                  // WASM Query Compiler, no Rust binary
  runtime    = "cloudflare"              // CF Workers target (also: "node", "deno", "bun")
  output     = "../generated/ledger"     // per-service client, keeps bundle small
  // NOTE: driverAdapters preview flag is GONE in v6.16 — drop it.
  //       Cite: https://www.prisma.io/blog/rust-free-prisma-orm-is-ready-for-production
}

datasource db {
  provider = "sqlite"                    // Turso is wire-compatible libSQL/SQLite
  url      = env("TURSO_DB_URL")         // per-tutor URL — resolved at runtime, NOT build time
}

// Only this service's models — per 18_Microservice_Architecture.md §5.2.
model ledger_entries {
  id              String   @id @default(cuid())
  tutorId         String                         // tenant scoping (one DB per tutor)
  studentId       String
  amountPaise     Int                            // integer-paise (10_Security.md LEDGER-2)
  direction       String                         // "credit" | "debit"
  idempotencyKey  String   @unique               // 17 §8.1 — ledger mutations
  voidOfId        String?                        // LEDGER-4: voids via reversing entry
  createdAt       DateTime @default(now())
  auditHash       String                         // tamper-evidence (10_Security.md §8)

  @@index([tutorId, studentId, createdAt])
}
```

### 5.2 The combined schema for migrations (`prisma/schema.combined.prisma`)

```prisma
// workers/gateway/prisma/schema.combined.prisma
// All seven services' models in one file — used ONLY by `prisma migrate diff`
// to generate forward-only migration SQL. The runtime uses per-service clients.

generator client {
  provider   = "prisma-client"
  engineType = "client"
  runtime    = "cloudflare"
  output     = "../generated/combined"
}

datasource db {
  provider = "sqlite"
  url      = env("TURSO_DB_URL")
}

// (All models from the seven per-service schemas concatenated here.
//  Each model carries @@index([tutorId, ...]) for tenant-scoped reads.)
```

### 5.3 Per-request PrismaClient with the libSQL adapter

```typescript
// workers/gateway/src/lib/turso.ts — resolve tutorId → dbUrl, cache in Upstash 1h.
import { Redis } from "@upstash/redis/cloudflare";

export async function resolveTutorDbUrl(
  tutorId: string,
  redis: Redis,
  tursoApiToken: string,
  tursoOrg: string,
): Promise<{ url: string; authToken: string }> {
  const cacheKey = `tutor:${tutorId}:dburl`;            // research Q3.2 — TTL 1h
  const cached = await redis.get<{ url: string; authToken: string }>(cacheKey);
  if (cached) return cached;

  // Cache miss — call Turso org API. (Hot path is rare: ~1/h per active tutor.)
  const resp = await fetch(
    `https://api.turso.tech/v1/organizations/${tursoOrg}/databases/tutor-${tutorId}`,
    { headers: { Authorization: `Bearer ${tursoApiToken}` } },
  );
  if (!resp.ok) throw new Error(`turso_resolve_failed:${resp.status}`);
  const db = await resp.json();

  // Mint a per-tutor DB token (scoped, not the org token).
  const tokenResp = await fetch(
    `https://api.turso.tech/v1/organizations/${tursoOrg}/databases/tutor-${tutorId}/auth/tokens`,
    { method: "POST", headers: { Authorization: `Bearer ${tursoApiToken}` } },
  );
  const { token: authToken } = await tokenResp.json();

  const resolved = {
    url: `libsql://tutor-${tutorId}-${tursoOrg}.turso.io`,
    authToken,
  };
  await redis.set(cacheKey, resolved, { ex: 3600 });    // 1h TTL
  return resolved;
}
```

```typescript
// workers/gateway/src/lib/prisma.ts — module-level LRU per isolate.
// Cite: research_R-GQL-EDGE-REDIS.md Q4.4 — "cache in module-level Map<tutorId,
//       PrismaClient> with LRU eviction (~50 active) to bound memory."
import { PrismaClient } from "../generated/ledger";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client/web";       // edge transport (HTTP)

const MAX_ACTIVE = 50;                                    // per isolate
const clients = new Map<string, PrismaClient>();          // tutorId → PrismaClient

export async function getPrisma(
  tutorId: string,
  dbUrl: string,
  authToken: string,
): Promise<PrismaClient> {
  const cached = clients.get(tutorId);
  if (cached) {
    // LRU touch — delete + re-set to mark most-recently-used.
    clients.delete(tutorId);
    clients.set(tutorId, cached);
    return cached;
  }

  // Evict the least-recently-used entry if at capacity.
  if (clients.size >= MAX_ACTIVE) {
    const oldestTutorId = clients.keys().next().value!;
    const oldest = clients.get(oldestTutorId)!;
    await oldest.$disconnect();
    clients.delete(oldestTutorId);
  }

  // Instantiate per-tutor client with the libSQL adapter (edge HTTP transport).
  const libsql = createClient({ url: dbUrl, authToken });
  const adapter = new PrismaLibSQL(libsql);
  const prisma = new PrismaClient({ adapter });
  clients.set(tutorId, prisma);
  return prisma;
}
```

### 5.4 The VACUUM exception (`lib/admin.ts`)

The **only** permitted raw-SQL exception per `10_Security.md` §18 is `VACUUM` — Prisma has no `db.vacuum()`. Confined to `workers/gateway/src/lib/admin.ts`:

```typescript
// workers/gateway/src/lib/admin.ts — the SOLE raw-SQL exception (10_Security.md §18).
// All other operations use Prisma ORM (research_R-GQL-EDGE-REDIS.md Q4.3).
import { createClient } from "@libsql/client/web";

export async function vacuumTutorDb(dbUrl: string, authToken: string): Promise<void> {
  const libsql = createClient({ url: dbUrl, authToken });
  // Raw prepared statement — parameterized (no interpolation, ever).
  await libsql.execute("VACUUM");
  await libsql.close();
}
```

Any other raw SQL in the codebase fails the Semgrep `no-raw-sql-except-vacuum` rule (`23_Security_Harness_Plan.md` §10 S10). The VACUUM call is admin-triggered (not on the request path), runs via a QStash schedule, and writes an `audit_log` row before + after.

---

## 6. db_provision (Supabase Edge Function)

`db_provision` stays a **Supabase Edge Function (Deno)** even though the rest of the gateway is on Cloudflare Workers. Three reasons:

1. **It needs the Supabase service_role key** to write `user_metadata` (the per-tutor `dbUrl` + `dbToken`) on the Supabase auth user. Putting the service_role key on the CF Worker would expand the blast radius; keeping it on Supabase's own Edge Function means the key never leaves Supabase's perimeter ([supabase.com/docs/guides/functions](https://supabase.com/docs/guides/functions)).
2. **It needs to call the Turso org API** (`POST /v1/organizations/{org}/databases`) to create the per-tutor DB. The Turso API token is also a high-privilege secret — same perimeter argument.
3. **It is the bootstrap path** — it runs once per new tutor (on signup) and is not on any hot path. Latency is irrelevant; isolation is critical.

The gateway's `auth-svc` calls `db_provision` via an internal `fetch()` over HTTPS. The Supabase Edge Function lives at `https://xxx.supabase.co/functions/v1/provision-db`. Auth is a Supabase JWT (`Authorization: Bearer <jwt>` — the same JWT the gateway already verified).

```typescript
// supabase/functions/provision-db/index.ts — Deno Edge Function.
// Cite: https://supabase.com/docs/guides/functions
//       https://upstash.com/examples/upstashredisinsupabaseedgefunctions (Upstash-from-Supabase example)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Redis } from "https://esm.sh/@upstash/redis@1.34";
import { PrismaClient } from "@prisma/client";              // generated, ESM
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient as createLibsql } from "@libsql/client/web";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURSO_ORG           = Deno.env.get("TURSO_ORG")!;
const TURSO_API_TOKEN     = Deno.env.get("TURSO_API_TOKEN")!;
const UPSTASH_REDIS_REST_URL   = Deno.env.get("UPSTASH_REDIS_REST_URL")!;
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const redis    = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  // 1. Verify the Supabase JWT (signed by Supabase, RS256, JWKS).
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return new Response("unauthenticated", { status: 401 });

  const tutorId = user.id;

  // 2. Idempotency — if the tutor already has a DB URL in user_metadata, return it.
  const existing = user.user_metadata?.tursoDbUrl;
  if (existing) {
    return Response.json({ dbUrl: existing, status: "already_provisioned" });
  }

  // 3. Create the per-tutor Turso DB via org API.
  const dbResp = await fetch(
    `https://api.turso.tech/v1/organizations/${TURSO_ORG}/databases`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TURSO_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `tutor-${tutorId}`, group: "default" }),
    },
  );
  if (!dbResp.ok) return new Response("turso_create_failed", { status: 502 });
  const { hostname } = await dbResp.json();

  // 4. Mint a per-tutor DB token (scoped — NOT the org token).
  const tokenResp = await fetch(
    `https://api.turso.tech/v1/organizations/${TURSO_ORG}/databases/tutor-${tutorId}/auth/tokens`,
    { method: "POST", headers: { Authorization: `Bearer ${TURSO_API_TOKEN}` } },
  );
  const { token: dbToken } = await tokenResp.json();
  const dbUrl = `libsql://${hostname}`;

  // 5. Run forward-only migrations via Prisma migrate (combined schema).
  const libsql = createLibsql({ url: dbUrl, authToken: dbToken });
  const adapter = new PrismaLibSQL(libsql);
  const prisma = new PrismaClient({ adapter });
  // (In production: import the migrations bundle + apply; here: sketch.)
  await prisma.$executeRawUnsafe(/* migration SQL from prisma/migrations/ */);
  await prisma.$disconnect();

  // 6. Write dbUrl + dbToken into user_metadata (Supabase auth.users).
  await supabase.auth.admin.updateUserById(tutorId, {
    user_metadata: { tursoDbUrl: dbUrl, tursoDbToken: dbToken, provisionedAt: new Date().toISOString() },
  });

  // 7. Invalidate the Upstash cache key — the gateway will re-resolve on next hit.
  await redis.del(`tutor:${tutorId}:dburl`);

  return Response.json({ dbUrl, status: "provisioned" });
});
```

**The gateway calls provision-db on first authenticated request from a freshly-signed-up tutor** (`auth-svc`): if the JWT's `user_metadata.tursoDbUrl` is absent, `auth-svc` POSTs to `provision-db` and waits (the function completes in 2-5 s — Turso DB create + migrate). The client sees a `503 retry_after=5` on the very first request, retries, and gets a `200` once `user_metadata` is populated. Subsequent requests resolve `dbUrl` from the JWT (no provision call).

**Why not CF Workers?** Putting the Supabase `service_role` key on a CF Worker would let any bug in the Worker's auth middleware mint admin tokens for any user. Keeping the key inside the Supabase Edge Function perimeter means the only way to invoke it is with a valid Supabase JWT — and the function itself verifies that JWT before doing anything. This is the blast-radius argument from `23_Security_Harness_Plan.md` §2 S2 applied to provisioning.

---

## 7. Upstash Redis + QStash Wiring

Upstash Redis is the **hot cache + Pub/Sub**. QStash is the **scheduled-job runner**. Both are HTTPS-only — no TCP, no connection pool, no long-lived `ioredis` socket ([upstash.com/docs/redis/features/restapi](https://upstash.com/docs/redis/features/restapi)). The `@upstash/redis` SDK is *"Designed for the edge. Tested and optimized for Vercel Edge, Cloudflare Workers and Fastly Edge"* ([upstash.com](https://upstash.com)). The QStash model: *"QStash is an HTTP based messaging and scheduling solution for the serverless and edge runtimes. In other words, it allows you to run CRON jobs by sending HTTP requests."* ([upstash.com/blog/qstash-announcement](https://upstash.com/blog/qstash-announcement)).

### 7.1 The 7 cache keys (research Q3.2 verbatim)

| Cache key | TTL | Invalidation | Used by |
|---|---|---|---|
| `tutor:{tutorId}:dburl` | 1h | `DEL` on db_provision mutation | Stage 7 (per-tutor DB resolution) — §5.3 |
| `jwks:supabase` | 10 min | none (Supabase rotates ≤1h) | Stage 2 (auth) — `middleware/auth.ts` |
| `rl:{tutorId}:{route}` | 60s sliding | none (TTL) | Stage 3 — also enforced authoritatively in `RateLimitDO`; Redis is the cross-region projection |
| `student:{tutorId}:{studentId}` | 60s | `DEL` on student mutation | `student-svc` reads |
| `students:{tutorId}:list` | 30s | `DEL` on any student mutation for that tutor | `student-svc` list reads |
| `ledger:{tutorId}:balance` | 24h | `DEL` on new `ledger_entries` row for that tutor (append-only → safe per `10_Security.md` LEDGER-4) | `ledger-svc` balance reads |
| `report:{tutorId}:{reportId}:url` | 24h | none (regenerated on demand) | `report-svc` PDF URL cache |

The ledger balance cache is safe for 24h because the ledger is **append-only** — a new row is the only invalidation event, and a new row always fires the `DEL`. This is the LEDGER-4 invariant from `10_Security.md` §9 doing real work: the immutability rule is what makes the long TTL safe.

### 7.2 The 3 QStash schedules (research Q3.2 verbatim)

| QStash schedule | Endpoint | CRON | Why QStash |
|---|---|---|---|
| `notification-svc` reminder tick | `POST https://api.buddysaradhi.app/internal/notif-tick` | every 1 min | Push-based HTTP — survives Worker termination; CF Cron Triggers would also work but QStash gives at-least-once + retry/backoff out of the box |
| `sync-svc` outbox drain | `POST https://api.buddysaradhi.app/internal/outbox-drain` | every 30 s | Drains `sync_outbox` per-tutor; QStash retries on 5xx so a transient Turso blip doesn't lose the tick |
| `report-svc` stale-URL cleanup | `POST https://api.buddysaradhi.app/internal/report-cleanup` | every 24 h | Cleans expired `report:{...}:url` keys + their backing Blob objects |

QStash free tier is 500 req/day — the 1-min notification tick alone is 1440/day, so QStash moves to paid ($1/100K) at launch ([upstash.com/pricing](https://upstash.com/pricing)). The `/internal/*` routes are authenticated with a QStash signature header (`verifySignature`) — they reject anything else with `401`.

### 7.3 The `@upstash/redis` client (REST, no pool)

```typescript
// workers/gateway/src/lib/upstash.ts — REST-only, edge-native.
// Cite: https://upstash.com/docs/redis/features/restapi
//       https://upstash.com/blog/redis-cloudflare-workers
import { Redis } from "@upstash/redis/cloudflare";
import { verifySignature } from "@upstash/qstash/nextjs";  // works on Workers too

export function makeRedis(env: Env): Redis {
  return new Redis({
    url:   env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    // Global DB — every command is one HTTPS round-trip.
    // /pipeline batches commands; /transaction is atomic MULTI/EXEC.
  });
}
```

### 7.4 The cache-aside helper

```typescript
// workers/gateway/src/lib/cache.ts — cache-aside with Upstash + Turso fallback.
import { Redis } from "@upstash/redis/cloudflare";

export async function cacheAside<T>(
  redis: Redis,
  key: string,
  ttlSec: number,
  load: () => Promise<T>,
): Promise<T> {
  // 1. Try cache.
  const cached = await redis.get<T>(key);
  if (cached !== null) return cached;

  // 2. Cache miss — load from source (Turso, in practice).
  const fresh = await load();

  // 3. Write back. Use NX to avoid stampede on a hot key.
  await redis.set(key, fresh, { ex: ttlSec, nx: true });
  return fresh;
}

// Invalidation — called by the mutation handlers.
export async function invalidate(redis: Redis, ...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.del(...keys);
}
```

### 7.5 The QStash `verifySignature` middleware (on every `/internal/*` route)

```typescript
// workers/gateway/src/internal/notif-tick.ts — QStash-signed only.
// Cite: https://upstash.com/blog/qstash-announcement
//       https://upstash.com/blog/syncing-state-with-qstash
import { verifySignature } from "@upstash/qstash";

export const onRequest = verifySignature(
  async (req: Request, env: Env) => {
    // Inside this handler, we KNOW it was QStash that called us.
    // 1. Find tutors with a due notification in the next 60 s.
    // 2. For each: write to sync_outbox (Turso), publish to Upstash Pub/Sub
    //    channel `tutor:{id}:notif`, the SyncDO for that tutor broadcasts
    //    to its connected devices via WebSocket Hibernation.
    // 3. Return 200 — QStash marks the message delivered.
    return new Response("ok", { status: 200 });
  },
  {
    currentSigningKey: env.UPSTASH_QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey:    env.UPSTASH_QSTASH_NEXT_SIGNING_KEY,    // rotation grace
  },
);
```

### 7.6 Scheduling the 3 QStash CRONs (idempotent)

```bash
# Idempotent — run from CI on every deploy, or from the Upstash dashboard once.
# Cite: https://upstash.com/docs/qstash
curl -X POST https://qstash.upstash.io/v2/schedules \
  -H "Authorization: Bearer $UPSTASH_QSTASH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "https://api.buddysaradhi.app/internal/notif-tick",
    "cron": "* * * * *"
  }'

curl -X POST https://qstash.upstash.io/v2/schedules \
  -H "Authorization: Bearer $UPSTASH_QSTASH_TOKEN" \
  -d '{
    "destination": "https://api.buddysaradhi.app/internal/outbox-drain",
    "cron": "*/30 * * * * *"
  }'

curl -X POST https://qstash.upstash.io/v2/schedules \
  -H "Authorization: Bearer $UPSTASH_QSTASH_TOKEN" \
  -d '{
    "destination": "https://api.buddysaradhi.app/internal/report-cleanup",
    "cron": "0 3 * * *"
  }'
```

Re-running these is safe — QStash deduplicates by `(destination, cron)` tuple. The CI pipeline (§10) calls this block on every deploy to drift back to canonical.

---

## 8. The Three Clients (how each calls the gateway)

All three clients consume the same SDK from `packages/shared/`, generated from `contracts/openapi.json`. The SDK reads a platform-specific env var once at module init — **no hostnames are hardcoded anywhere in `apps/*` source**. The no-hardcode lint (`17_API_Gateway_System.md` §2.2) runs in CI and fails the build if any `apps/*` file contains `http://`, `https://`, `localhost`, `:3031`-style ports, or the literal `api.buddysaradhi.app`.

| Client | Hosting | Env var (base URL) | SDK | JWT storage | HTTP transport | Cross-ref |
|---|---|---|---|---|---|---|
| **Web** | Vercel (Next.js 16, App Router) | `NEXT_PUBLIC_API_BASE=https://api.buddysaradhi.app` | `packages/shared` (ESM, tree-shaken) | httpOnly + Secure + SameSite=Strict cookie (Server Component mints; client SDK reads via `cookies()`) | native `fetch` (Node.js runtime — Vercel's recommendation per research Q2.1) | `web/05_Deployment_Vercel.md`, `17_API_Gateway_System.md` §2.2 |
| **Mobile** | Expo / EAS (Android + iOS) | `EXPO_PUBLIC_API_BASE=https://api.buddysaradhi.app` (EAS Build env var) | `packages/shared` (same ESM, Metro-friendly) | `expo-secure-store` with `requireAuthentication=true` (biometric/PIN gate) | `fetch` polyfill (RN ships it) | `03_EAS_Build_and_Update_Channels.md`, `mobile/03_*` |
| **Desktop** | Tauri v2 (WebView + Rust shell) | `TAURI_API_BASE` — compiled into the binary at build time from a CI env var (NOT a source literal; the no-hardcode lint still applies) | `packages/shared` (same ESM) | OS keychain (macOS Keychain / Windows DPAPI / Linux Secret Service) via Tauri's `keyring` crate | `fetch` in the WebView (Chromium/WebKit on Win/macOS, WebKitGTK on Linux) — same as web | `desktop/05_Updater.md`, `desktop/06_*` |

All three clients use **relative paths under the base** (`/api/v1/ledger/...`, `/api/v1/students/...`, `/sync`, `/graphql`, `/health`). The SDK exposes typed functions like `sdk.ledger.createEntry({...})` which under the hood `fetch(\`${base}/api/v1/ledger/entries\`, {...})`. The SDK is the contract spine — `17_API_Gateway_System.md` §2.

**No-hardcode lint (the mechanical enforcement).** `workers/gateway/test/no-hardcoded-ingress.test.ts` scans `apps/web/src/**`, `apps/mobile/src/**`, `apps/desktop/src/**` for forbidden patterns: `http://`, `https://` (except in `package.json`), `localhost`, `:3031`-`:3037` port literals, the literal `api.buddysaradhi.app`, `127.0.0.1`, `0.0.0.0`. The lint passes only if every base URL comes from the env var. A developer who pastes `http://localhost:3031` into client code to "just make it work locally" fails the commit — the local dev story (§9) uses `wrangler dev` + an env var, not direct ports.

**Cross-platform consistency.** Because all three clients use the same SDK over the same HTTPS edge domain, a contract change (`contracts/openapi.json` bump + SDK regeneration) propagates to all three on the next build. There is no per-platform API drift. This is the mechanical answer to user requirement #3 ("must be such that all the platforms desktop mobile, website and other must be able to use same cloud function").

---

## 9. Local Dev (`wrangler dev` + Miniflare)

A developer running the gateway locally does **not** re-introduce Caddy, per-service ports, or the `XTransformPort` convention from the prior plan. The local stack mirrors production:

| Concern | Local | Production | Drift risk |
|---|---|---|---|
| Gateway runtime | `wrangler dev` (local V8 isolate via Miniflare, default port `:8787`) | CF Workers | none — same runtime, same code, same `wrangler.toml` |
| Durable Objects | `wrangler dev --local` (local SQLite-backed DO via Miniflare) | CF DO (SQLite-backed) | none — same API, same Hibernation |
| Hot cache | local Miniflare in-memory KV (the `@upstash/redis` SDK's local mock) OR a free-tier Upstash DB tagged `local-<dev>` | Upstash Global Redis | low — same SDK, only the URL differs |
| Per-tutor DB | local Turso (`turso dev` → local libSQL file) OR a free-tier Turso DB tagged `local-<dev>` | Turso cloud | none — `@prisma/adapter-libsql` accepts both `libsql://...` and `file:...` URLs |
| Auth | local Supabase (`supabase start` via the CLI — runs Postgres + GoTrue + Edge Functions locally) | Supabase cloud | none — same JWT RS256 + JWKS |
| Files | local filesystem via a Vercel Blob dev shim | Vercel Blob | low — signed-URL contract is identical |
| Scheduled jobs | `wrangler dev --test-scheduled` triggers the `/internal/*` routes manually OR a local QStash mock | QStash CRON | none — same endpoints |
| provision-db | the same Supabase Edge Function, run locally via `supabase functions serve provision-db` | Supabase cloud | none — same Deno code |

### 9.1 The local-dev workflow

```bash
# Terminal 1 — Supabase (auth + provision-db Edge Function):
cd supabase/ && supabase start && supabase functions serve provision-db

# Terminal 2 — Turso local (per-tutor DBs as local files):
turso dev --port 8080

# Terminal 3 — the gateway (CF Worker via Miniflare):
cd workers/gateway/ && wrangler dev --local --env development

# Terminal 4 — the Next.js web app (proxies /api/* to the gateway):
cd apps/web/ && bun run dev
# (NEXT_PUBLIC_API_BASE=http://localhost:8787 in .env.local — NOT localhost:3031)
```

The Next.js dev server is configured (in `next.config.ts`) to proxy `/api/*` to `http://localhost:8787` in dev. The SDK reads `NEXT_PUBLIC_API_BASE` from `.env.local`. A developer never types `:3031` anywhere. The no-hardcode lint runs identically in local and CI.

### 9.2 The `mini-services/` folder is DEPRECATED for production — legacy dev fallback only

The old `mini-services/` folder (one Bun project per service on ports `:3031`-`:3037` with Caddy + `XTransformPort`) is **deprecated for production** ([18_Microservice_Architecture.md](../18_Microservice_Architecture.md) §7.1). It is kept only as a legacy dev fallback for the narrow case where a developer wants to debug a single service's handler in isolation without booting the full `wrangler dev` stack. The `mini-services/README.md` says: **"DO NOT USE IN PROD. See `18_Microservice_Architecture.md` §7.1 + `deployment/06_Edge_Function_Hosting.md` §9.2. The Caddy + per-port model does not translate to a deployable system and is the root cause of the prior 'POST/fetch is not working' report."** The `:3031`-style port conventions and the `XTransformPort` query trick from the prior plan are deleted from every other file.

**Recommendation: prefer `wrangler dev`.** A developer who wants to debug a single service sets a breakpoint in `wrangler dev` and hits only that route. The `mini-services/` fallback exists for one reason — Gradual strangler-fig migration of legacy code that hasn't been ported to the Worker router yet (per [18_Microservice_Architecture.md](../18_Microservice_Architecture.md) §2). Once all services are ported (target: end of P1 Web phase), `mini-services/` is deleted from the repo.

---

## 10. CI/CD (deploy pipeline)

The CI/CD pipeline lives in `.github/workflows/edge-deploy.yml`. It is the edge-deploy stage of the cross-platform harness in `05_CI_CD_GitHub_Actions.md` — that file owns the shared lint/test/build matrix; this section adds the edge-specific stages. Cross-ref `23_Security_Harness_Plan.md` §11 for the security gate that runs before any deploy.

```yaml
# .github/workflows/edge-deploy.yml — edge deploy stage.
# Cite: https://developers.cloudflare.com/workers/wrangler/deploy-to-cloudflare
name: edge-deploy

on:
  push:
    branches: [main]
    paths:
      - "workers/gateway/**"
      - "packages/shared/**"
      - "contracts/openapi.json"
      - "supabase/functions/provision-db/**"
      - ".github/workflows/edge-deploy.yml"
  workflow_dispatch:    # manual trigger for hotfix

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      UPSTASH_QSTASH_TOKEN: ${{ secrets.UPSTASH_QSTASH_TOKEN }}
    steps:
      # ── 1. Setup ────────────────────────────────────────────────────────
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3 }
      - run: bun install --frozen-lockfile

      # ── 2. Lint (includes no-hardcode) ──────────────────────────────────
      - name: lint
        run: bun run lint
        # Fails on localhost/:3031/literal hostnames in apps/*, raw SQL outside lib/admin.ts.

      # ── 3. Type-check + unit tests ──────────────────────────────────────
      - name: typecheck
        run: bun run typecheck
      - name: test
        run: bun run test

      # ── 4. Prisma migrate diff (check — provision-db applies, never CI)
      - name: prisma migrate diff
        run: |
          bunx prisma migrate diff \
            --from-schema-datasource workers/gateway/prisma/schema.combined.prisma \
            --to-schema-datamodel workers/gateway/prisma/schema.combined.prisma \
            --shadow-database-url ${{ secrets.TURSO_SHADOW_DB_URL }} \
            --exit-code   # non-zero exit = drift; fails build before deploy

      # ── 5. Build the gateway bundle ─────────────────────────────────────
      - name: build gateway
        run: bun run build:gateway   # generates per-service Prisma clients, bundles Worker

      # ── 6. wrangler deploy --dry-run (bundle-size ≤ 9 MB safety margin) ─
      - name: wrangler dry-run
        run: bunx wrangler deploy --dry-run --outdir=/tmp/wrangler-out

      # ── 7. wrangler deploy (the edge gate) ──────────────────────────────
      - name: wrangler deploy
        run: bunx wrangler deploy   # atomic, versioned, instantly rollbackable

      # ── 8. secret rotation check (parity) ───────────────────────────────
      - name: secret rotation check
        run: |
          for SECRET in UPSTASH_REDIS_REST_TOKEN UPSTASH_QSTASH_TOKEN \
                        UPSTASH_QSTASH_CURRENT_SIGNING_KEY UPSTASH_QSTASH_NEXT_SIGNING_KEY \
                        TURSO_API_TOKEN BLOB_WRITE_TOKEN; do
            VALUE=$(bunx wrangler secret list | jq -r --arg s "$SECRET" '.[]|select(.name==$s)|.name')
            [ -z "$VALUE" ] && { echo "MISSING SECRET: $SECRET"; exit 1; } || echo "OK: $SECRET"
          done

      # ── 9. QStash schedules (idempotent — see §7.6) ─────────────────────
      - name: qstash schedules (idempotent)
        run: bun run workers/gateway/scripts/upsert-qstash-schedules.ts

      # ── 10. Smoke test (curl /health on the live edge) ──────────────────
      - name: smoke test
        run: |
          sleep 5  # let CF propagate
          STATUS=$(curl -s -o /dev/null -w '%{http_code}' https://api.buddysaradhi.app/health)
          [ "$STATUS" = "200" ] || { echo "smoke failed: /health=$STATUS"; exit 1; }
          for SVC in ledger students attendance sync reports notifications auth; do
            STATUS=$(curl -s -o /dev/null -w '%{http_code}' https://api.buddysaradhi.app/api/v1/$SVC/health)
            [ "$STATUS" = "200" ] || { echo "smoke failed: /$SVC/health=$STATUS"; exit 1; }
          done

      # ── 11. Supabase Edge Function deploy (provision-db) ────────────────
      - name: supabase functions deploy provision-db
        run: |
          cd supabase/
          supabase functions deploy provision-db --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}

      # ── 12. Tag (only on green) ─────────────────────────────────────────
      - name: tag
        if: success()
        run: |
          SHA=$(git rev-parse --short HEAD)
          git tag edge-deploy-${SHA} $(git rev-parse HEAD) && git push origin edge-deploy-${SHA}
```

**The 12 stages run sequentially; any failure halts the pipeline and the production deployment is unchanged** (CF Workers atomic deployment means a failed `wrangler deploy` is a no-op — the previous version keeps serving). The smoke test is the gate: if any `/health` endpoint returns non-200, the deploy is rolled back automatically (§11).

**Cross-refs:** `05_CI_CD_GitHub_Actions.md` (shared pipeline); `23_Security_Harness_Plan.md` §11 (the security gate that runs *before* this pipeline — Semgrep, OSV-Scanner, gitleaks, SBOM); `17_API_Gateway_System.md` §10 step 5 (the no-hardcode lint as a gate).

---

## 11. Rollback + Observability

### 11.1 Rollback

Cloudflare Workers deployments are **atomic + versioned + instantly rollbackable** ([developers.cloudflare.com/workers/configuration/versions](https://developers.cloudflare.com/workers/configuration/versions)):

```bash
# List recent deployments:
bunx wrangler deployments list
#   ─ Version ID    ─ Author     ─ Timestamp          ─ Active
#   v1 abc123...    @release-eng 2025-10-15T10:30Z    yes
#   v2 def456...    @release-eng 2025-10-15T14:22Z    no (current)

# Instant rollback to the previous version (zero downtime, <5s):
bunx wrangler rollback
# (or: bunx wrangler deployments deploy --version v1)
```

The rollback is **point-in-time**: the Worker code reverts, but the D1 audit_log + Upstash Redis state + Turso per-tutor DBs are NOT reverted (they are append-only / external). This is by design — a code regression should not lose user data. If a migration was applied that needs reverting, that is a forward-fix migration (`prisma migrate resolve` + a new migration), never a `wrangler rollback` of the DB.

**Automatic rollback trigger.** The smoke-test stage (§10 step 10) calls `wrangler rollback` on failure. The `audit_log` records each rollback as `action="rollback"` + `from_version` + `to_version` + `reason="smoke_failed"`.

**Supabase Edge Function rollback.** `supabase functions deploy` is also versioned — `supabase functions rollback provision-db --version <id>` reverts. Same semantics: code reverts, user_metadata persists.

**QStash schedule rollback.** QStash schedules are idempotent — re-running the upsert (§7.6) drifts back to canonical. There is no "rollback" — only "re-upsert".

### 11.2 Observability

| Signal | Source | What it tells you | Retention |
|---|---|---|---|
| Request volume + error rate + p50/p95/p99 latency | CF Workers Analytics | Per-route (e.g. `/api/v1/ledger/*`), per-colo, per-deploy | 30 days (Paid) |
| Per-request logs | `wrangler tail` (live) + CF Workers Logs (persisted) | Every console.log + thrown error, sampled at `head_sampling_rate` | 7 days (default) |
| Durable Object metrics | CF Workers Analytics → Durable Objects | Per-class request count, storage size, WebSocket connection count, hibernation rate | 30 days |
| Upstash Redis metrics | Upstash dashboard | Command count, hit/miss ratio, data size, bandwidth | 30 days |
| QStash metrics | Upstash dashboard | Schedule success/fail count, retry count, average latency | 30 days |
| Turso metrics | Turso dashboard | Per-DB query count, latency, storage size | 30 days |
| Audit log | Cloudflare D1 (`audit_log` table) | Every gateway-mediated mutation, with tamper hash chain (`10_Security.md` §8) | Forever (append-only) |
| Client-side errors | Sentry (across all three apps) | SDK errors, network failures, contract violations | 90 days |

**The audit_log is the source of truth for "what happened".** It is gateway-owned (D1, not per-tutor Turso) — a tutor cannot alter it. Every mutation handler calls `lib/audit.ts` which writes a row with: `tutorId`, `action`, `entity_type`, `entity_id`, `request_hash`, `prev_hash`, `this_hash` (the tamper-evidence chain — `10_Security.md` §8). The `audit_log` is the artefact produced when DPDP Rule 7 breach intimation is required (`23_Security_Harness_Plan.md` §9 S9).

### 11.3 Incident response

Cross-ref `23_Security_Harness_Plan.md` §10.9 for the full incident-response playbook. The edge-specific actions:

1. **Detect.** CF Workers Analytics alert on error rate > 1% for 5 min, or p95 > 500 ms for 5 min, or `/health` non-200 for 2 min.
2. **Triage.** `wrangler tail` for live logs; filter by `deploy_id` to scope to the suspect deploy.
3. **Mitigate.** If the issue is the latest deploy → `wrangler rollback` (instant). If the issue is a downstream dependency (Turso / Upstash / Supabase) → the gateway's circuit-breaker (per `17_API_Gateway_System.md` §4.4) degrades to cached responses from Upstash.
4. **Resolve.** Forward-fix → PR → CI → deploy (§10).
5. **Postmortem.** Append to `audit_log` (`action="incident_postmortem"`) + file in `buddysaradhi_Planning/incidents/` (created on first incident).

---

## 12. Cross-References

- `17_API_Gateway_System.md` §6 (gateway in production — this file is the HOW-TO), §10 (implementation order — step 3 names this file), §2.2 (the no-hardcode rule this file's §8 enforces), §6.3 (the 7 cache keys + 3 QStash schedules this file's §7 implements), §6.4 (local dev — this file's §9 expands).
- `18_Microservice_Architecture.md` §7 (deployment — the wrangler.toml skeleton this file's §4 expands into a full recipe), §7.1 (the mini-services/ folder this file's §9.2 deprecates), §7.2 (per-route health endpoints this file's §10 smoke-tests), §12.5 (the abridged wrangler.toml this file's §4 supersedes).
- `23_Security_Harness_Plan.md` §11 (the security gate that runs before the §10 pipeline), §10.9 (incident response — this file's §11.3 cross-refs), §2 S2 (the 1-user-1-Turso-DB isolation provision-db implements), §8.5 (secrets via `wrangler secret put` — this file's §4 codifies).
- `10_Security.md` §6 (auth model — provision-db Supabase Edge Function), §8 (audit-log chain + tamper hashes — this file's §11.2 codifies), §9 (LEDGER-4 — the append-only invariant that makes the 24h balance cache safe), §18 (the single raw-SQL exception: VACUUM, confined to `lib/admin.ts`).
- `19_Concurrency_and_Testing.md` §3 (the load + concurrency harness — 500 RPS target; the §10 smoke test runs a subset).
- `deployment/01_Vercel_Hosting.md` (web hosting — companion file; this file is the edge backend to 01's web frontend).
- `deployment/02_Vercel_Blob_Build_Storage.md` (Vercel Blob — the file store the gateway mints signed URLs for).
- `deployment/03_EAS_Build_and_Update_Channels.md` (mobile build — sets `EXPO_PUBLIC_API_BASE` per this file's §8).
- `deployment/05_CI_CD_GitHub_Actions.md` (shared CI/CD — this file's §10 is the edge stage).
- `web/03_Auth_and_Provisioning.md` (the JWT + provisioning flow the gateway + provision-db consume — this file's §6 implements).
- `web/05_Deployment_Vercel.md` (Next.js deploy — sets `NEXT_PUBLIC_API_BASE` per this file's §8).
- `research_R-GQL-EDGE-REDIS.md` (source of truth for every edge/Redis/Prisma/GraphQL claim in this file — Q2.3 the primary-vs-fallback decision, Q3.2 the 7 cache keys + 3 QStash schedules, Q4.3 the Prisma decision rule, Q4.4 the LRU cache + WASM caveats).

---

**End of `06_Edge_Function_Hosting.md`.** One edge domain. One `wrangler deploy`. One bundle. Three platforms. The contract, the audit row, the rate-limit semantics, and the SDK are identical between CF Workers primary and Supabase Edge fallback — only the runtime changes.
