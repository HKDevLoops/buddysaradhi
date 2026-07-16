# 18 — Microservice Architecture

> How Buddysaradhi migrates from the current monolithic Next.js app (the `apps/web/src/app/api/*` route handlers at `/home/z/my-project/`) to a small, gateway-mediated set of **co-deployed Cloudflare Worker functions** — without a big-bang rewrite, without breaking the Web Production Gate (`16_Platform_Delivery_Sequence.md` §4), and without over-engineering (we extract a route handler only when the spec demands it). The seven hidden engines from `00_Vision.md` become seven bounded services, each a route prefix inside one CF Workers deployment (`workers/gateway/`), dispatched in-process by the gateway router. Stateful services (sync, rate-limit) live in Durable Objects; scheduled work (notification tick, outbox drain, report cleanup) lives in Upstash QStash. This file is read-only context until the Web phase begins the gateway build-out (`17_API_Gateway_System.md` §10); service extraction is a Web-phase activity, never a parallel refactor.
>
> **Last updated: Task 18-EDGE-MIGRATION** — migrated the 6+1 services from "separate Bun mini-service processes on ports 3031-3037" to **co-deployed Cloudflare Workers functions** (one `wrangler deploy`, route-keyed) with Durable Objects for the stateful ones and Upstash QStash for the scheduled ones. The seven-engine→six-service mapping, the outbox pattern, the secure-erase orchestration, and the anti-over-engineering table are preserved verbatim — those are the file's identity. Only the HOSTING migrated. Source of truth for every technical claim below: `research_R-GQL-EDGE-REDIS.md` (cited inline); anything beyond it is marked UNVERIFIED.

---

## 0. Why Microservices Here (and Why Not Sooner)

Buddysaradhi is not Netflix. A tutor's tuition business does not need 40 services. But it does need **three** things a monolith cannot give cleanly, and those three things justify a *small* set of service-bounded route handlers:

1. **Independent failure isolation.** The ledger must never go down because the PDF report renderer OOM'd. The report engine is CPU-heavy (PDF, charts); the ledger is I/O-light and sacred. They must not share a fault domain. On Cloudflare Workers, "separate process" becomes "separate Worker function / route prefix with its own Durable Object namespace where stateful" — failure isolation is achieved by CF's **per-isolate sandboxing + per-function CPU limits** (30 s default → 5 min max on Workers Paid, per [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)), not by OS processes. A report-fn that hits the 5-min CPU ceiling returns a typed `503` to that one request; ledger-fn in the next request over the same deployment is unaffected. The V8 isolate boundary is the failure boundary.
2. **Independent scaling.** Sync (mobile outbox drain) is bursty and stateful; student reads are flat and cacheable. One monolithic event loop cannot size both well. On CF Workers, the platform autoscales each route independently — sync-fn traffic spins up isolates dedicated to `/api/v1/sync/*`; student-fn traffic spins up isolates dedicated to `/api/v1/students/*`. The team provisions nothing.
3. **Contract enforcement.** Once `17_API_Gateway_System.md` defines one contract, the services *behind* it are where the contract is implemented. A monolith behind the gateway works too — but then the gateway is a thin proxy and the "service boundary" is just a folder, which drifts. Real per-service Prisma schema slices + real route-prefix dispatch enforce real boundaries (§5.2).

We therefore extract **seven services**, one per hidden engine. Not forty. Not one. Seven — because `00_Vision.md` named seven engines, and each engine is a natural bounded context. Each becomes a route prefix in the same CF Workers deployment; none becomes a separate `wrangler deploy`.

---

## 1. The Seven Services

| Service | Owns | DB tables | Route prefix + DO | Why a separate route handler |
|---|---|---|---|---|
| **ledger-svc** | The append-only ledger, balances, reconciliation, reversing entries, secure-erase | `ledger_entries`, `reversals`, `audit_log` (ledger-scoped) | `/api/v1/ledger/*` (stateless Worker fn) | The spine. Integer-paise invariants. Must never be co-located with CPU-heavy work in the same request path. |
| **student-svc** | Students, guardians, batches, enrolment | `students`, `guardians`, `batches`, `enrolments` | `/api/v1/students/*` (stateless + Upstash LRU cache) | Read-heavy, cacheable; different latency profile from ledger. |
| **attendance-svc** | Attendance marks, batch rosters for a date | `attendance_marks` | `/api/v1/attendance/*` (stateless) | Bursty (start of class); write-pattern distinct from ledger. |
| **sync-svc** | `sync_outbox` drain, conflict resolution, client push/pull | `sync_outbox`, `sync_state` | `/api/v1/sync/*` + Durable Object `SyncDO` (WebSocket Hibernation) | Stateful long-lived connections (WebSocket); must not block request handling. |
| **report-svc** | PDF/CSV generation, charts, statement rendering | (none — reads others via gateway) | `/api/v1/reports/*` (stateless, CPU-heavy, 5-min CPU limit) | CPU-heavy; runs against the CF Workers 5-min CPU ceiling, not an event loop. |
| **notification-svc** | Reminder scheduling, receipt delivery (email/local), the reminder engine | `reminders`, `notification_log` | `/api/v1/notifications/*` + QStash-scheduled tick | Scheduled work + fan-out; isolated so a delivery outage doesn't block the app. |
| **auth-svc** | Supabase JWT issuance helpers, OTP, provisioning orchestration | (Supabase owns identity) | `/api/v1/auth/*` (stateless; wraps Supabase) | Wraps Supabase; isolates the one place that touches identity provider quirks. |

> **Note on the gateway-local concerns.** Storage signing (Blob signed URLs) and the backup envelope store (`17_API_Gateway_System.md` §4.2/§4.3) live **in the gateway router itself**, not as a separate service — they are stateless minting operations, too cheap and too latency-sensitive to dispatch even within the same Worker bundle. Rate-limit (`RateLimitDO`) is also gateway-owned, not a service — see `17_API_Gateway_System.md` §3 stage 3.

### 1.1 The Engine → Service Map

```
   00_Vision.md "seven hidden engines"          this file "seven services"
   ───────────────────────────────────          ──────────────────────────
   Search Engine        ────────────────▶  (in-process in each svc; no separate svc —
                                            search is a read filter, not a mutation owner)
   Reminder Engine      ────────────────▶  notification-svc
   Ledger Engine        ────────────────▶  ledger-svc
   Report Engine        ────────────────▶  report-svc
   Notification Engine  ────────────────▶  notification-svc  (reminder + notification = one svc)
   Sync Engine          ────────────────▶  sync-svc
   Security Engine      ────────────────▶  cross-cutting: audit lives in the gateway;
                                            secure-erase is an orchestration across
                                            ledger-svc + student-svc + gateway
```

So seven engines → six services + one cross-cutting concern. The "Search Engine" stays in-process because search is a `WHERE` clause, not a domain — splitting it would be the textbook over-engineering this file warns against (§9).

---

## 2. Current State → Target State (Strangler-Fig, Not Big-Bang)

```
   CURRENT (monolith)                              TARGET (one CF Workers deployment)

   ┌─────────────────────────────────┐             ┌──────────────────────────────────┐
   │   apps/web/  (Next.js 16 on     │             │   apps/web/  (Next.js 16)        │
   │     Vercel)                     │             │   thin: UI + sdk calls only      │
   │                                 │             └──────────────────┬───────────────┘
   │   src/app/api/ledger/   route   │                                │ sdk (contracts/vX)
   │   src/app/api/students/ handlers│                                ▼
   │   src/app/api/attend/   ─┐      │             ╔════════════════════════════════════════╗
   │   src/app/api/sync/     ─┤      │             ║  workers/gateway/  (one wrangler.toml) ║
   │   src/app/api/reports/  ─┤ Prisma             ║  api.buddysaradhi.app  (CF edge)        ║
   │   src/app/api/notify/   ─┤  client            ║                                         ║
   │   src/app/api/auth/     ─┘ (one DB)           ║   router dispatches by route prefix:    ║
   │                                 │             ║   ┌────────┐ ┌────────┐ ┌──────────┐   ║
   │   (everything in one Next.js    │             ║   │ledger  │ │student │ │attendance│   ║
   │    Vercel Function event loop;  │             ║   │  -fn   │ │  -fn   │ │   -fn    │   ║
   │    one OOM kills everything;    │             ║   └────────┘ └────────┘ └──────────┘   ║
   │    no edge WebSocket; no        │             ║   ┌────────┐ ┌────────┐ ┌──────────┐   ║
   │    per-route CPU ceiling)       │             ║   │ sync   │ │ report │ │   auth   │   ║
   └─────────────────────────────────┘             ║   │  -fn   │ │  -fn   │ │   -fn    │   ║
                                                   ║   │+SyncDO │ │ (5min) │ │          │   ║
                                                   ║   └────────┘ └────────┘ └──────────┘   ║
                                                   ║   ┌──────────┐                          ║
                                                   ║   │ notif-fn │ + QStash tick             ║
                                                   ║   └──────────┘                          ║
                                                   ╚════════════════════════════════════════╝
                                                         │  all 7 fns share: 1 deploy · 1 domain
                                                         │  · 1 contract tag · 1 audit pipeline
                                                         ▼
                                                   Upstash Redis (cache + Pub/Sub)
                                                   + Upstash QStash (3 CRON schedules)
                                                   + Durable Objects (SyncDO + RateLimitDO)
                                                   + per-tutor Turso DBs (Prisma v6.16)
```

### 2.1 The Strangler-Fig Sequence

We do **not** extract all seven route handlers at once. We extract them in dependency order, behind the gateway, one at a time, each extraction leaving the monolith greener. The rule: **the Web Production Gate (`16_Platform_Delivery_Sequence.md` §4) must stay green at every step.** If an extraction drops W4 (tests) or W5 (Lighthouse), it is not merged.

```
   STEP 0  gateway Worker live at api.buddysaradhi.app — router forwards /api/v1/*
            unmatched paths back to apps/web/src/app/api/* (the monolith).
            └─ nothing extracted yet; gateway just adds TLS + auth + audit + contract
               + the RateLimitDO + Upstash Redis hot cache (17_API_Gateway_System.md §3)

   STEP 1  extract ledger-svc  ──▶  add a route handler at /api/v1/ledger/* in the Worker
            └─ move the ledger Prisma schema slice into workers/gateway/src/services/ledger/
               (§5.2); the monolith's src/app/api/ledger/ route is deleted

   STEP 2  extract student-svc ──▶  add /api/v1/students/* + the Upstash LRU read cache
            └─ move the student Prisma schema slice; delete the monolith's students route

   STEP 3  extract attendance-svc ──▶  add /api/v1/attendance/*

   STEP 4  extract sync-svc ──▶  add /api/v1/sync/* + the SyncDO Durable Object binding
            └─ the WebSocket Hibernation API lives here (§3.4); the monolith's sync route
               is deleted. QStash outbox-drain schedule (every 30 s) is wired to
               /internal/outbox-drain.

   STEP 5  extract report-svc ──▶  add /api/v1/reports/*
            └─ CPU-heavy; runs against the CF Workers 5-min CPU limit; chunk via QStash
               if a render exceeds 5 min (§3.5)

   STEP 6  extract notification-svc ──▶  add /api/v1/notifications/*
            └─ QStash CRON tick (every 1 min) wired to /internal/notif-tick

   STEP 7  extract auth-svc ──▶  add /api/v1/auth/*
            └─ last; it wraps Supabase, and the gateway keeps a local JWT
               validator even after this (defense in depth)

   STEP 8  the monolith's src/app/api/* folder is empty; apps/web/ is pure UI.
            └─ Web Production Gate re-cleared; mobile may now begin.
```

Between each step: full test suite green, Agent Browser golden-path green, no contract change without a version bump. Each step is a PR; each PR cites this file's step number. Each extraction = (a) add a route handler in the Worker, (b) move the Prisma schema slice, (c) run the no-hardcode lint, (d) run the load harness.

---

## 3. Service Boundaries — What Each Service Owns

### 3.1 ledger-svc

- **Tables:** `ledger_entries`, `reversals`, `audit_log` (rows where `domain = 'ledger'`).
- **Operations:** `postEntry`, `voidEntry` (reversing entry), `computeBalance`, `reconcile`, `secureErase` (orchestrated — see §6).
- **Invariants:** append-only (BR-LEDG-01), integer paise (BR-LEDG-02), every mutation writes a reversal never an update (AP-11), secure-erase uses `db.ledgerEntry.deleteMany({})` inside `$transaction` then `VACUUM` (sole raw-SQL exception, `10_Security.md` §18).
- **Cannot call:** any other service. The ledger is a sink; it does not depend on students/attendance. It receives a `studentId` as an opaque string.
- **ORM:** Prisma v6.16.0+ with the ESM-first `prisma-client` generator (`engineType = "client"`, `runtime = "cloudflare"`) paired with `@prisma/adapter-libsql` pointed at the per-tutor Turso DB — the WASM Query Compiler loads via static `import` and runs on CF Workers without issue ([prisma.io/blog/rust-free-prisma-orm-is-ready-for-production](https://www.prisma.io/blog/rust-free-prisma-orm-is-ready-for-production); [prisma.io/changelog](https://www.prisma.io/changelog); [docs.turso.tech/sdk/ts/orm/prisma](https://docs.turso.tech/sdk/ts/orm/prisma)). The v6.16.0 `/edge` regression on CF ([github.com/prisma/prisma/issues/28074](https://github.com/prisma/prisma/issues/28074)) was fixed in 6.16.x.
- **The VACUUM exception:** Prisma has no `db.vacuum()`. Secure-erase runs the `VACUUM` admin command via a `@libsql/client` raw prepared statement — the **only** raw-SQL call in the codebase, confined to `lib/db/admin.ts` per `10_Security.md` §18. Every other operation goes through Prisma.

### 3.2 student-svc

- **Tables:** `students`, `guardians`, `batches`, `enrolments`.
- **Operations:** CRUD + `search(query)` + `listByBatch`.
- **Calls ledger-svc?** No — reads balances via the gateway (typed SDK) for the student detail screen, never directly. The student detail screen composes: `sdk.students.get(id)` + `sdk.ledger.balance({studentId:id})` client-side, or the gateway offers a composed endpoint `GET /api/v1/students/:id?include=balance` that fans out internally. The fan-out is gateway-owned so the composition contract is centralised.
- **Cache:** read LRU in Upstash Redis — `student:{tutorId}:{studentId}` (TTL 60 s) and `students:{tutorId}:list` (TTL 30 s), `DEL`'d on any student mutation for that tutor. Cuts the Turso read load by ~90% in the steady-state dashboard.

### 3.3 attendance-svc

- **Tables:** `attendance_marks`.
- **Operations:** `markBatch({batchId, date, present[]})`, `rosterForDate`, `stats`.
- **Lock-after-48h rule** (`14_Edge_Cases.md`) is enforced here, not in the client.

### 3.4 sync-svc

- **Tables:** `sync_outbox`, `sync_state`.
- **Operations:** `push(entries[])` (client → server outbox reconciliation), `pull(cursor)` (server → client deltas), WebSocket channel for live push.
- **Conflict resolution:** last-write-wins with an `updatedAt` vector, except ledger entries which are append-only and never conflict (you cannot "edit" a ledger row, only reverse it). This is why the ledger is conflict-immune — the design pays off here.
- **Stateful — lives in a Durable Object (`SyncDO`), not a long-running process.** The WebSocket lives in a `SyncDO` Durable Object (one per `tutor:<tutorId>`, sharded by tutorId) running Cloudflare's **WebSocket Hibernation API** ([developers.cloudflare.com/durable-objects/best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets)). The DO holds the connection map per tutorId; the Hibernation API means **the DO only bills compute on message** — millions of idle WebSocket connections sit in CF's global WS fabric at $0. This is the deciding factor for CF Workers over Vercel Edge (no Edge WebSocket) or Supabase Edge (fragile on free tier — `research_R-GQL-EDGE-REDIS.md` Q2.1). The DO is single-threaded per tutor → no race on the connection map, no lock; broadcasting to t_7's other devices is a method call, not a pub/sub hop.
- **Outbox drainer:** the QStash-scheduled `/internal/outbox-drain` tick (every 30 s) reads `sync_outbox` rows for recently-active tutors and replays them — a safety net for clients that went offline mid-push. The DO itself drains on every message it processes; QStash is the backstop.

> **Naming note.** The gateway file (`17_API_Gateway_System.md` §6.2) refers to this Durable Object as `SyncConnectionObject` and to the rate-limit authority as `RateLimitObject`. This file uses the shorter names `SyncDO` and `RateLimitDO` — same object, same binding, same code; only the alias differs.

### 3.5 report-svc

- **Tables:** none (stateless; reads via gateway).
- **Operations:** `renderStatement({studentId, range})`, `renderMonthlyReport({tutorId, month})`, `exportCsv`.
- **CPU pool — gone; replaced by the CF Workers 5-min CPU ceiling.** PDF generation runs against the **CF Workers 5-min CPU/req limit** (Workers Paid; default 30 s, configurable to 300,000 ms — [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)). A heavy render no longer stalls "the event loop" because there is no shared event loop — each request runs in its own V8 isolate. report-fn accepts the request, renders synchronously if it fits the limit, or returns `202` with a job URL and chains the work via QStash chunks if a single render would exceed 5 min (a multi-month statement for a 250-student tutor is the only known case; benchmark before splitting). The client polls or gets a WebSocket push from the SyncDO. This is the service that most justifies its own route prefix: its 5-min CPU budget is independent of the ledger-fn's 30-ms request budget.

### 3.6 notification-svc

- **Tables:** `reminders`, `notification_log`.
- **Operations:** `scheduleReminder`, `listPending`, `deliver` (email via Supabase/Resend; local notification via push token), `cancelReminder`.
- **The 60 s tick is a QStash CRON that POSTs to `/internal/notif-tick`** — push-based HTTP messaging, at-least-once with retry+backoff, CRON expressions ([upstash.com/blog/qstash-announcement](https://upstash.com/blog/qstash-announcement)). The gateway verifies the QStash signature (`verifySignature`) on every `/internal/*` request and rejects anything else with `401`. The tick scans `reminders WHERE due_at <= now() AND status='pending'`; fans out delivery; writes `notification_log`. Isolated so a delivery provider outage (Resend down) doesn't stall the app — reminders re-queue, the rest of the system is unaffected. The tick is **not** a long-running process; it is a stateless Worker fn that QStash invokes every 60 s.

### 3.7 auth-svc

- **Tables:** none (Supabase owns identity).
- **Operations:** `requestOtp`, `verifyOtp`, `provisionDb` (calls the Supabase Edge Function), `refresh`.
- **Provision-db stays a Supabase Edge Function (Deno)** per `17_API_Gateway_System.md` §5.1 — it needs the Supabase `service_role` key to write `user_metadata` for the freshly-created user, and that key must never cross a vendor boundary (would violate `10_Security.md` §1 trust model). auth-svc (the CF Worker fn at `/api/v1/auth/*`) calls provision-db via internal `fetch` to the Supabase Edge Function URL; the gateway caches the resulting `dbUrl` mapping in Upstash Redis on first request and never calls provision-db again for that tutor.
- **Defense in depth:** even after extraction, the gateway keeps a local JWT validator (JWKS cached). auth-svc is the *issuer helper*; the gateway is the *enforcer*. Splitting these is intentional — a compromised auth-svc cannot mint tokens the gateway will accept, because the gateway validates against Supabase's JWKS directly.

---

## 4. Inter-Service Communication

Services do **not** call each other directly. Two channels, by need:

```
   ┌─ SYNCHRONOUS (reads, gateway-composed) ──────────────────────────┐
   │                                                                  │
   │  client ──▶ gateway ──┬─▶ student-svc.get(id)                    │
   │                       └─▶ ledger-svc.balance({studentId:id})     │
   │  gateway fans out (in-process dispatch — no network hop),        │
   │  composes, returns one response. services never see each other;  │
   │  they only see the gateway router.                               │
   └──────────────────────────────────────────────────────────────────┘

   ┌─ ASYNCHRONOUS (cross-service mutations, outbox + event bus) ─────┐
   │                                                                  │
   │  ledger-svc posts an entry                                       │
   │     └─ writes sync_outbox row (BR-SYN-01, same $transaction)     │
   │     └─ publishes event "ledger.entry.posted" to Upstash Pub/Sub  │
   │  notification-svc subscribes → may schedule a receipt reminder   │
   │  sync-svc subscribes → pushes the new entry to connected clients │
   │  report-svc does NOT subscribe (it renders on demand)            │
   │                                                                  │
   │  the bus is Upstash Redis Pub/Sub (REST API) — NOT NATS, NOT a   │
   │  cloud managed MQ (Rule 13: boring tech). No thread, no process. │
   └──────────────────────────────────────────────────────────────────┘
```

### 4.1 The Event Bus = Upstash Redis Pub/Sub

A single Upstash Redis Global database serves as both the hot cache (`17_API_Gateway_System.md` §6.3) **and** the event bus. The `@upstash/redis` SDK supports `PUBLISH`/`SUBSCRIBE` over the REST API ([upstash.com/docs/redis](https://upstash.com/docs/redis); [upstash.com/docs/redis/features/restapi](https://upstash.com/docs/redis/features/restapi)) — every command is an HTTPS request, no TCP socket, no connection pool, no NATS to run. For the edge this is the right primitive: the Worker fn that subscribes uses `redis.subscribe(channel, handler)` which long-polls on a 30 s interval; the publisher uses `redis.publish(channel, payload)`. The seven cache keys from `17_API_Gateway_System.md` §6.3 and the Pub/Sub channels share one database — same SDK, same secrets, same free-tier budget (256 MB / 500K commands/month, per [upstash.com/pricing/redis](https://upstash.com/pricing/redis)).

Channels:

| Channel | Publisher | Subscriber(s) | Purpose |
|---|---|---|---|
| `ledger.entry.posted` | ledger-svc | notification-svc, sync-svc | New ledger row → maybe schedule receipt reminder + push to connected devices |
| `student.mutated` | student-svc | sync-svc | Student CRUD → push deltas to other devices |
| `attendance.marked` | attendance-svc | sync-svc, notification-svc | Batch marked → push + maybe send parent digest |
| `reminder.due` | notification-svc | (none — fire-and-forget delivery) | Reminder fired → email/local push |

This is the **only** inter-service runtime dependency. It is optional in v1 (services can run without it; the gateway composes synchronously); it becomes load-bearing when notification-svc and sync-svc ship (steps 4 and 6).

### 4.2 The Outbox Pattern (no dual-write bug)

Every service that mutates state writes its `sync_outbox` row **in the same Prisma `$transaction`** as the mutation (BR-SYN-01, `AGENTS.md` Rule 7). A separate outbox-drainer reads the outbox and publishes to the bus. This means: if the bus is down, the mutation still committed; the drainer retries. No dual-write, no lost event.

**The drainer is a QStash-scheduled Worker tick (every 30 s) at `/internal/outbox-drain`, not a long-running process.** The tick:

1. Queries `sync_outbox WHERE published = false LIMIT 100` on the per-tutor DB (or scans recently-active tutors via the Upstash cache).
2. For each row: `redis.publish(channel, payload)` over HTTPS.
3. Marks `published = true` in a separate `$transaction` — at-least-once semantics; a duplicate publish is idempotent on the subscriber side (subscribers dedupe on the outbox row's ULID).

The QStash schedule retries on 5xx — a transient Turso or Upstash blip doesn't lose the tick. The drainer does not hold state in memory; if the Worker isolate is evicted mid-drain, the next tick picks up where the last committed `published = true` left off. This is the canonical serverless adaptation of the outbox pattern: no long-running process, no thread, no `setInterval`, no `bun --hot` to babysit.

---

## 5. Data Ownership (One Table, One Owner)

| Table | Owner | Others may… |
|---|---|---|
| `ledger_entries` | ledger-svc | read via gateway only; never write |
| `students` | student-svc | read via gateway; never write |
| `attendance_marks` | attendance-svc | read via gateway; never write |
| `sync_outbox` | sync-svc | each service *writes its own* outbox rows in its own transaction; sync-svc *drains* them |
| `reminders` | notification-svc | read via gateway |
| `audit_log` | gateway (operational, CF D1) + per-domain shards | append-only; the gateway's shard is gateway-owned (`17_API_Gateway_System.md` §3.1) |

**No service holds a Prisma client for another service's tables.** Enforced by repository structure: each service's Prisma schema slice declares only its own tables; a service literally cannot compile a query against a table it doesn't declare. This is the mechanical enforcement of the boundary — stronger than a convention.

### 5.1 One Physical DB or Many?

In v1 (Web phase): **one Turso/libSQL DB per tutor, with all tables co-located**, but each service's Prisma schema declares only its tables. This keeps per-tutor provisioning cheap (one DB) while keeping service boundaries clean in code. A future v2 may shard by service (one DB per service per tutor) if a table grows hot — but that is a `15_Future_Roadmap.md` decision, not a v1 one. Do not pre-shard.

### 5.2 Per-Service Prisma Schema Slices

Each service's Prisma schema is a `prisma/schema.<service>.prisma` file in `workers/gateway/src/services/<svc>/`:

```
   workers/gateway/
   ├── wrangler.toml                       (§7 — one deployment, 7 route prefixes)
   ├── src/
   │   ├── router.ts                       (in-process dispatch by route prefix)
   │   ├── services/
   │   │   ├── ledger/
   │   │   │   ├── schema.ledger.prisma    (ledger_entries, reversals, audit_log@ledger)
   │   │   │   ├── client.ts               (PrismaClient with only Ledger models)
   │   │   │   └── handlers.ts             (POST/GET /api/v1/ledger/*)
   │   │   ├── student/
   │   │   │   ├── schema.student.prisma   (students, guardians, batches, enrolments)
   │   │   │   ├── client.ts
   │   │   │   └── handlers.ts
   │   │   ├── attendance/ …
   │   │   ├── sync/  (+ SyncDO class + schema.sync.prisma)
   │   │   ├── report/ (no schema; reads via gateway)
   │   │   ├── notification/
   │   │   └── auth/   (no schema; wraps Supabase)
   │   ├── do/
   │   │   ├── SyncDO.ts                   (WebSocket Hibernation, sharded tutor:<tutorId>)
   │   │   └── RateLimitDO.ts              (token bucket per tutorId, gateway-owned)
   │   └── internal/
   │       ├── notif-tick.ts               (QStash-scheduled)
   │       ├── outbox-drain.ts             (QStash-scheduled)
   │       └── report-cleanup.ts           (QStash-scheduled)
   └── prisma/
       └── schema.combined.prisma          (composed at build time — for migrations only)
```

The gateway composes the seven per-service schemas into one `schema.combined.prisma` at build time **for migrations only** (one `prisma migrate` runs all seven slices against the per-tutor Turso DB on provisioning). Each service's `PrismaClient` is generated from **only its own slice** and only declares its own models — ledger-svc's client has no `Student` model, so a developer who types `db.student.` gets a TypeScript compile error. This is the **mechanical boundary enforcement**: the contract lives in the schema, not in code review.

The combined schema is generated by a build script (`tools/combine-prisma-schemas.ts`) that concatenates the seven slices, dedupes the `generator` + `datasource` blocks, and writes `schema.combined.prisma`. The combined file is **git-ignored** — it is a build artefact, not source. Per-service slices are source; the combined file is a migration convenience.

---

## 6. Secure-Erase — The Cross-Service Orchestration Example

Secure-erase (`10_Security.md` §18) is the canonical cross-service flow. It shows how the services cooperate without direct calls. Rehosted on CF Workers:

```
   client: sdk.security.secureErase({ confirm: "DELETE MY DATA" })
     │
     ▼
   GATEWAY WORKER ── validates the typed confirm string ──▶ opens a Prisma $transaction
     │                  (resolved via Upstash tutor:{tutorId}:dburl)
     │
     ├─▶ ledger-svc.erase()        → db.ledgerEntry.deleteMany({})  (Prisma ORM)
     ├─▶ student-svc.erase()       → db.student.deleteMany({})      (Prisma ORM)
     ├─▶ attendance-svc.erase()    → db.attendanceMark.deleteMany({}) (Prisma ORM)
     ├─▶ sync-svc.erase()          → db.syncOutbox.deleteMany({})   (Prisma ORM)
     ├─▶ notification-svc.erase()  → db.reminder.deleteMany({})     (Prisma ORM)
     ├─▶ gateway: delete Blob objects (signed-admin), delete backup envelopes
     └─▶ gateway: VACUUM via @libsql/client raw prepared statement
                   (the SOLE raw-SQL call in the codebase — no Prisma equivalent,
                    confined to lib/db/admin.ts per 10_Security.md §18)
     │
     ▼
   audit_log (CF D1, gateway-owned): "SECURE_ERASE completed"  (the one row that survives, by design)
     │
     ▼
   gateway returns Result.ok; client is logged out; tutor's Turso DB is empty.
```

Each service exposes an `erase()` method that the gateway Worker calls **in-process** in a coordinated `$transaction` (the gateway holds the per-tutor Turso DB connection via the cached `PrismaClient` and orchestrates). The VACUUM runs **after** the transaction commits — it cannot be inside a `$transaction` because Prisma has no `db.vacuum()` and VACUUM cannot run inside a SQLite transaction anyway. The raw `@libsql/client` connection comes from the same Turso URL the Prisma adapter uses; the gateway resolves it once, runs the VACUUM, and closes. No service knows about the others. The gateway is the orchestrator because it is the only component that spans all services for a tutor. This is the pattern for every future cross-service flow: **gateway orchestrates, services execute, outbox/audit capture the trail.**

---

## 7. Deployment (One CF Workers Deployment, Route-Keyed)

The 7 services are **7 route-handler modules in ONE Cloudflare Workers deployment** (`workers/gateway/`), deployed via a single `wrangler deploy`. ONE `wrangler.toml`. ONE edge domain (`api.buddysaradhi.app`). ONE bundle (≤ 10 MB compressed — [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)). The router in `workers/gateway/src/router.ts` dispatches by route prefix: `/api/v1/ledger/*` → `ledger/handlers.ts`, `/api/v1/sync/*` → `sync/handlers.ts` (and upgrades WebSocket to the `SyncDO`), and so on. The dispatch is a typed TS function call — no network hop, no `:3031`-style port surface, no `XTransformPort` convention. The router is the gateway from `17_API_Gateway_System.md` §1.

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  workers/gateway/  →  wrangler deploy  →  api.buddysaradhi.app   │
   │                                                                  │
   │  ONE wrangler.toml:                                              │
   │    • route = api.buddysaradhi.app/*                              │
   │    • main = "src/router.ts"                                      │
   │    • compatibility_date = "2025-10-01"                           │
   │    • DO bindings:  SyncDO, RateLimitDO                           │
   │    • vars:   UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN,             │
   │              SUPABASE_URL, SUPABASE_ANON_KEY                     │
   │    • secrets: QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY,          │
   │              SUPABASE_SERVICE_ROLE_KEY (provision-db only —      │
   │              lives on Supabase Edge, NOT here)                   │
   │                                                                  │
   │  Prisma (per-service slice, generated at build):                 │
   │    generator client {                                            │
   │      provider        = "prisma-client"                           │
   │      engineType      = "client"                                  │
   │      runtime         = "cloudflare"                              │
   │      output          = "../generated/<svc>"                      │
   │    }                                                             │
   │    datasource db {                                               │
   │      provider = "sqlite"                                         │
   │      url      = env("TURSO_DB_URL")  // per-tutor, resolved at runtime │
   │    }                                                             │
   │    // + only this service's models, per §5.2                     │
   │                                                                  │
   │  @prisma/adapter-libsql wired in each service's client.ts        │
   │  module-level Map<tutorId, PrismaClient> LRU ~50 per isolate     │
   └──────────────────────────────────────────────────────────────────┘
```

**wrangler.toml skeleton:**

```
name = "buddysaradhi-gateway"
main = "src/router.ts"
compatibility_date = "2025-10-01"
compatibility_flags = ["nodejs_compat"]

# One route, one domain — every platform calls this.
routes = [
  { pattern = "api.buddysaradhi.app/*", zone_name = "buddysaradhi.app" }
]

# Durable Object bindings — the only stateful services.
[[durable_objects.bindings]]
name = "SYNC_DO"
class_name = "SyncDO"

[[durable_objects.bindings]]
name = "RATE_LIMIT_DO"
class_name = "RateLimitDO"

[[migrations]]
tag = "v1"
new_classes = ["SyncDO", "RateLimitDO"]

# Upstash Redis + QStash + Supabase — all via env vars / secrets.
[vars]
UPSTASH_REDIS_URL      = "https://xxx.upstash.io"
SUPABASE_URL           = "https://xxx.supabase.co"
SUPABASE_ANON_KEY      = "eyJ..."           # public, fine in vars

# Secrets (set via `wrangler secret put`, never in this file):
#   UPSTASH_REDIS_TOKEN
#   QSTASH_TOKEN
#   QSTASH_CURRENT_SIGNING_KEY
#   QSTASH_NEXT_SIGNING_KEY       (for rotation)

# Observability + limits.
[observability]
enabled = true

[limits]
cpu_ms = 300000   # 5 min max — only report-svc needs this; default 30s elsewhere
```

### 7.1 The mini-services/ folder is DEPRECATED for production

The old `mini-services/` folder (one Bun project per service on ports `:3031`-`:3037`) is **deprecated for production**. It is kept only for local dev convenience: a developer who wants to debug a single service in isolation can `wrangler dev` the full gateway (preferred — same runtime as prod) or fall back to running a single service's handler with `wrangler dev --local` against a Miniflare-backed DO + a local Turso file. The `:3031`-style port conventions and the `XTransformPort` query trick from the prior plan are **deleted** — they do not exist in this file's deployment model. The no-hardcode lint (`17_API_Gateway_System.md` §2.2) forbids `:3031`-style port literals and `localhost:` references in `apps/*/` source.

### 7.2 Health + Readiness (per route prefix)

Each route prefix has `/api/v1/<svc>/health`:

| Endpoint | Returns | Used by |
|---|---|---|
| `GET /api/v1/ledger/health` | `200 { svc:"ledger", ok:true }` | gateway `/health` aggregator |
| `GET /api/v1/students/health` | `200 { svc:"student", ok:true }` | gateway `/health` aggregator |
| `GET /api/v1/attendance/health` | `200 { svc:"attendance", ok:true }` | gateway `/health` aggregator |
| `GET /api/v1/sync/health` | `200 { svc:"sync", ok:true, do:"SyncDO" }` | gateway `/health` aggregator + DO liveness |
| `GET /api/v1/reports/health` | `200 { svc:"report", ok:true, cpuMs:300000 }` | gateway `/health` aggregator |
| `GET /api/v1/notifications/health` | `200 { svc:"notification", ok:true, qstash:"ok" }` | gateway `/health` aggregator + QStash reachability |
| `GET /api/v1/auth/health` | `200 { svc:"auth", ok:true, supabase:"ok" }` | gateway `/health` aggregator + Supabase reachability |
| `GET /health` | `200 { gateway:"ok", services:{...} }` | uptime monitor (CF Workers analytics + external probe) |

There is no `/ready` endpoint — on CF Workers, an isolate is either warm (ready) or being evicted (next request spins up a new one); there is no "warming" state to skip. A service that fails its `/health` check (e.g. Supabase unreachable) reports `ok:false` but the gateway still routes to it — CF Workers has no circuit-breaker primitive, and the gateway prefers returning a typed `503` from the failing service over hiding it. The `503` flows back to the client SDK, which retries with jitter.

The deployment recipe (secrets rotation, DO migration scripts, primary-vs-Supabase-fallback cutover) lives in `deployment/06_Edge_Function_Hosting.md` (NEW — to be written). The Cloudflare Workers + Durable Objects platform references are at [developers.cloudflare.com/workers](https://developers.cloudflare.com/workers) and [developers.cloudflare.com/durable-objects/platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits).

---

## 8. Concurrency Model (summary; full spec in `19_Concurrency_and_Testing.md`)

| Component | Threading model | Why |
|---|---|---|
| **gateway router** | CF V8 isolates (multitenant, auto-scaled by CF) | I/O multiplexed by the runtime; the team provisions nothing. Isolate reuse across requests within a colo; cold start <1 s ([developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)). |
| **ledger-fn** | stateless Worker fn (isolate reuse, no per-service process) | I/O-light; invariants need no parallelism; one Prisma call per request. |
| **student-fn** | stateless Worker fn + Upstash LRU cache | read-heavy; the cache (§3.2) absorbs spikes; cache hits never touch Turso. |
| **attendance-fn** | stateless Worker fn | bursty but small writes; no state to hold between requests. |
| **sync-fn** | `SyncDO` Durable Object (single-threaded per object, hibernated WebSocket) | stateful; the DO is the single authority for one tutor's connection map — no race, no lock, no per-connection compute billed (Hibernation API — [developers.cloudflare.com/durable-objects/best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets)). |
| **report-fn** | stateless Worker fn with 5-min CPU ceiling | CPU-bound work; each render gets its own isolate; the 5-min ceiling is the budget ([developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)). Exceed → QStash-chained chunks. |
| **notification-fn** | stateless Worker fn + QStash tick (every 60 s) | fan-out; isolates a delivery provider outage; the tick is a stateless fn, not a long-running process. |
| **auth-fn** | stateless Worker fn | thin Supabase wrapper; no state. |
| **event bus** | Upstash Redis Pub/Sub (REST API, no thread) | the one "shared" component; HTTPS publish + HTTPS long-poll subscribe, both stateless from the Worker's perspective. |

The concurrency test harness (`19_Concurrency_and_Testing.md` §3) loads each route prefix to its expected peak (ledger 200 RPS, sync 500 concurrent sockets, report 20 concurrent PDFs) and asserts no error-rate > 0.1%. There is no event-loop-stall metric any more — there is no shared event loop; each request is its own isolate. The replacement metric is **CPU-wall-time per request** (must stay <30 s for stateless fns, <5 min for report-fn).

---

## 9. What This Is NOT (Anti-Over-Engineering)

| Temptation | Why we resist | Do this instead |
|---|---|---|
| Split each table into its own micro-service | "N tables = N services" is the textbook over-engineering failure | One service per *engine* (7 engines → 6 services); tables follow the engine |
| A separate "search-svc" with Elasticsearch | Search is a `WHERE` clause on a per-tutor DB of <10k rows | In-process Prisma `findMany` with a full-text index |
| Service mesh with sidecars (Istio/Linkerd) | We have 6 route handlers in one Worker; sidecars add 6× the operational cost | The gateway router + per-route prefix dispatch; health checks via `/api/v1/<svc>/health` |
| Per-service DBs in v1 (one DB per service per tutor) | 200 tutors × 6 services = 1200 DBs to provision/back up | One DB per tutor, co-located tables, per-service Prisma schema slices (§5.2) |
| gRPC between services | We have 6 in-process route handlers in one Worker | Typed TS function calls inside the router; the contract is OpenAPI, not proto |
| Event sourcing the whole system | The ledger is already append-only; that's enough event sourcing for a tuition app | Append-only ledger + outbox for async; nothing else is event-sourced |
| **Per-service separate CF Workers deployments** (NEW) | 7 deployments = 7× the cold-start surface + 7× the wrangler config + 7× the secret rotation + 7× the deploy pipeline. Co-deployment in one Worker bundle means one cold start, one secret store, one `wrangler deploy` | ONE `wrangler.toml`, ONE `wrangler deploy`, route-keyed dispatch. The route-prefix boundary is the service boundary (§7). |
| **Tauri desktop runs its own local service mesh** (NEW) | Desktop calls the same edge gateway as web + mobile — that is the whole point of the cross-platform gateway (`17_API_Gateway_System.md` §0). Running a local Bun mesh in the Tauri binary re-introduces the sandbox Caddy problem on every user's laptop, defeats the no-hardcode rule, and adds an attack surface (a local server bound to `localhost:`). | Desktop calls `api.buddysaradhi.app` over HTTPS. Offline-first is via the local SQLite outbox + the SyncDO push/pull, **not** a local server. The Tauri binary contains the SDK + the local outbox; it contains no server. |
| **Mobile runs a local sync server** (NEW) | Same reason — the Expo app already has the local outbox per `mobile/04_Offline_Sync_and_Conflict_Resolution.md`. A local server on the phone is impossible (iOS background restrictions) and pointless (the SyncDO is the server). | Mobile calls `api.buddysaradhi.app`; the local outbox drains via the SyncDO WebSocket when the app is foregrounded. |

---

## 10. Implementation Order (within Web phase, `16_Platform_Delivery_Sequence.md` §10.1)

```
   MICROSERVICE EXTRACTION (part of P1: WEB IN-FLIGHT, after gateway stand-up):

   0. gateway Worker live at api.buddysaradhi.app (router forwards /api/v1/* unmatched
      back to apps/web/src/app/api/*)                                  — §2.1 step 0
        • wrangler deploy + DO bindings (SyncDO, RateLimitDO) + Upstash Redis + QStash
        • tools/no-hardcoded-ingress.test.ts green (no fetch/http:///:3031 in apps/*)

   1. extract ledger-svc                                               — §2.1 step 1
        • add workers/gateway/src/services/ledger/{schema.ledger.prisma, client.ts, handlers.ts}
        • compose into schema.combined.prisma for migration
        • delete apps/web/src/app/api/ledger/
        • run no-hardcode lint + load harness (200 RPS ledger)

   2. extract student-svc (+ Upstash LRU read cache)                  — §2.1 step 2
        • add services/student/ + wire student:{tutorId}:{id} + students:{tutorId}:list keys
        • delete apps/web/src/app/api/students/

   3. extract attendance-svc                                          — §2.1 step 3

   4. extract sync-svc (+ SyncDO Durable Object + QStash outbox-drain)— §2.1 step 4
        • add services/sync/ + do/SyncDO.ts + internal/outbox-drain.ts
        • QStash schedule: POST /internal/outbox-drain every 30 s (signed)
        • delete apps/web/src/app/api/sync/

   5. extract report-svc (+ 5-min CPU limit + QStash chunking)        — §2.1 step 5
        • add services/report/ + internal/report-cleanup.ts
        • QStash schedule: POST /internal/report-cleanup every 24 h (signed)
        • cpu_ms = 300000 for report-fn route (others stay at default 30000)

   6. extract notification-svc (+ QStash CRON tick)                   — §2.1 step 6
        • add services/notification/ + internal/notif-tick.ts
        • QStash schedule: POST /internal/notif-tick every 60 s (signed)

   7. extract auth-svc (gateway keeps local JWT validator)            — §2.1 step 7

   8. apps/web/src/app/api/* is empty; apps/web/ is pure UI           — §2.1 step 8

   9. re-clear Web Production Gate (W1–W7)                            — 16_Platform_Delivery_Sequence.md §4
        • load harness green at 500 RPS (17 §10 step 6)
        • all 3 QStash schedules live + signing keys rotated
        • DO migrations applied + RateLimitDO + SyncDO reachable

   ─── mobile may now begin, inheriting contracts/v1.0.0 ───
```

Each step is gated by: lint clean, tests green, Agent Browser golden-path green, no contract change without a version bump. A step that fails any of these is reverted; the monolith keeps serving until the extraction is provably safe. Each "extract X-svc" step is mechanically: (a) add a route handler in `workers/gateway/src/services/<svc>/handlers.ts`, (b) move the Prisma schema slice into `workers/gateway/src/services/<svc>/schema.<svc>.prisma`, (c) update `tools/combine-prisma-schemas.ts`, (d) run the no-hardcode lint (`tools/no-hardcoded-ingress.test.ts`), (e) run the load harness (`19_Concurrency_and_Testing.md` §3).

---

## 11. Cross-References

- `16_Platform_Delivery_Sequence.md` §7 (Boundary Rule) + §10.1 (Web phase steps) — microservice extraction is a Web-phase activity; this file's §10 aligns 1:1 with §10.1.
- `17_API_Gateway_System.md` §1 (architecture, the router these services sit behind), §3 (request lifecycle stages 5 + 9 = service dispatch + audit), §6.2 (SyncDO — the WebSocket Hibernation DO this file calls `SyncDO`, gateway calls `SyncConnectionObject`), §6.3 (the 7 Upstash cache keys + 3 QStash schedules this file relies on), §5.1 (provision-db Supabase Edge Function).
- `19_Concurrency_and_Testing.md` §3 — the per-route-prefix load + concurrency harness.
- `10_Security.md` §6 (auth), §8 (audit-log chain + tamper hashes), §9 (ledger immutability — LEDGER-4), §18 (the single raw-SQL exception: VACUUM, confined to `lib/db/admin.ts`, called by the gateway in §6 secure-erase).
- `11_Data_Model.md` §10 (ORM discipline) — services use Prisma ORM only; the gateway never runs SQL except VACUUM.
- `23_Security_Harness_Plan.md` (NEW — to be written from `research_R-GQL-EDGE-REDIS.md` + `research_R-SECURITY-HARNESS.md`) — per-service security: RateLimitDO as the rate-limit authority, Idempotency-Key on ledger mutations, QStash signature verification on `/internal/*`, Workers secrets via `wrangler secret put`.
- `deployment/06_Edge_Function_Hosting.md` (NEW — to be written) — the wrangler/CF Workers deployment recipe: `wrangler.toml`, bindings, secrets, DO migration scripts, primary-vs-fallback (Supabase Edge) cutover runbook.
- `00_Vision.md` — the seven engines → six services + cross-cutting security.
- `12_Business_Rules.md` §3 — ledger invariants that justify ledger-svc isolation.
- `research_R-GQL-EDGE-REDIS.md` — source of truth for every edge/Redis/Prisma/GraphQL claim in this file.

---

## 12. ASCII Mockup Suite (§20 Compliance)

### 12.1 The Strangler-Fig (extraction over time, edge edition)

```
   monolith API surface (apps/web/src/app/api/*), shrinking as Worker route handlers appear:

   step 0   [ledger][student][attend][sync][report][notify][auth]   ← all in monolith; Worker is a passthrough
   step 1   .......[student][attend][sync][report][notify][auth]    ← ledger-fn live in Worker
   step 2   ................[attend][sync][report][notify][auth]    ← student-fn live
   step 3   .........................[sync][report][notify][auth]   ← attendance-fn live
   step 4   ................................[report][notify][auth]  ← sync-fn + SyncDO live
   step 5   ........................................[notify][auth]  ← report-fn live (5-min CPU)
   step 6   .................................................[auth] ← notif-fn + QStash tick live
   step 7   ....................................................... ← auth-fn live; apps/web/src/app/api/* empty
            ────────────── monolith shrinks ──────────────▶

   behind the gateway, Worker route handlers appear (all in ONE wrangler deploy):
   step 0   (router only — no service handlers wired)
   step 1   /api/v1/ledger/*
   step 2   /api/v1/ledger/*  /api/v1/students/*
   ...
   step 7   /api/v1/{ledger,students,attendance,sync,reports,notifications,auth}/*
            + /internal/{notif-tick,outbox-drain,report-cleanup}  (QStash-signed)
            + DOs:  SyncDO  ·  RateLimitDO  (gateway-owned)
            + Upstash Redis:  7 cache keys  +  4 Pub/Sub channels
            + QStash:  3 CRON schedules  (1m / 30s / 24h)

   the gateway deployment never splits — it's one bundle from step 0 to step 7.
   each step adds a route handler + a Prisma schema slice; nothing is re-deployed separately.
```

### 12.2 Service Boundary — What a Service May Touch (edge edition)

```
   ledger-fn  (route handler in workers/gateway/src/services/ledger/)
   ┌────────────────────────────────────────────────────────────────┐
   │  MAY:   Prisma ORM (own schema slice: ledger_entries, ...)     │
   │  MAY:   publish "ledger.entry.posted" to Upstash Redis Pub/Sub │
   │  MAY:   write its own sync_outbox rows (same $transaction)     │
   │  MAY:   read Upstash cache keys it owns (ledger:{tutor}:balance│
   │         — DEL on new ledger_entries row, append-only → safe)   │
   │                                                                │
   │  MAY NOT: hold a Prisma client for students/attendance/...     │  ✗ (not in its schema slice; TS compile error)
   │  MAY NOT: fetch() another service's route prefix               │  ✗ (no SDK import between services)
   │  MAY NOT: read the request JWT                                 │  ✗ (gateway already did, in ctx.tutorId)
   │  MAY NOT: open a Blob connection                               │  ✗ (gateway mints signed URLs)
   │  MAY NOT: spawn a worker_thread                                │  ✗ (no threads on CF Workers; use QStash chunks)
   │  MAY NOT: call VACUUM                                          │  ✗ (only the gateway, in secure-erase, §6)
   │  MAY NOT: bind to a port                                       │  ✗ (no ports on CF Workers; route prefix only)
   └────────────────────────────────────────────────────────────────┘

   mechanical enforcement: per-service Prisma schema slice (§5.2) + TypeScript
   compile errors + the no-hardcode lint (17_API_Gateway_System.md §2.2) + the
   absence of any import path from one service to another. The boundary lives
   in the schema and the import graph, not in code review.
```

### 12.3 The Outbox + Bus Flow (no dual-write, edge edition)

```
   ledger-fn.postEntry()  (in a CF Worker isolate, request-scoped)
     │
     ├─ $transaction {
     │     db.ledgerEntry.create({ ... })          ← the mutation (Prisma ORM)
     │     db.syncOutbox.create({ event, payload }) ← the outbox row (same txn)
     │  }
     │
     │  (transaction commits — mutation is durable in the per-tutor Turso DB)
     │
     ▼
   QStash-scheduled outbox-drainer (POST /internal/outbox-drain every 30 s, signed)
     │  (stateless Worker fn — no long-running process, no setInterval, no thread)
     │
     ├─ read sync_outbox rows WHERE published = false LIMIT 100
     ├─ for each row:
     │     redis.publish("ledger.entry.posted", payload)   ← HTTPS to Upstash
     │     mark published = true  (separate $txn — at-least-once)
     │
     ▼
   Upstash Redis Pub/Sub fans out (HTTPS long-poll to subscribers):
     ├─▶ notification-fn  (subscribed on "ledger.entry.posted")
     │     └─ may schedule a receipt reminder (writes `reminders` row)
     └─▶ sync-fn (SyncDO) (subscribed on "ledger.entry.posted")
           └─ pushes the new entry to connected mobile/web/desktop clients
              via the SyncDO's WebSocket fan-out (Hibernation API — §12.4)

   guarantees:
     • if Upstash is down, the mutation still committed; the drainer retries
       on the next 30 s tick (QStash at-least-once with retry/backoff).
     • no dual-write — the outbox row is in the same $txn as the mutation.
     • subscribers dedupe on the outbox row's ULID (idempotent on replay).
     • no thread, no process, no NATS — the bus is HTTPS publish + HTTPS
       long-poll subscribe, both stateless from the Worker's perspective.
```

### 12.4 SyncDO WebSocket Hibernation Lifecycle

```
╔═══════════════════════════════════════════════════════════════════════════╗
║  SyncDO  (Durable Object, sharded by tutor:<tutorId>)                     ║
║  state: SQLite-backed (10 GB/object — developers.cloudflare.com/durable-  ║
║         objects/platform/limits); billed only on message (Hibernation API) ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                         ║
║   t=0s   client connects (mobile, desktop, or web):                     ║
║          wss://api.buddysaradhi.app/api/v1/sync?token=<jwt>             ║
║          └─▶ CF edge routes to SyncDO(tutor:t_7)  (gateway extracts     ║
║              tutorId from JWT, picks the DO shard)                      ║
║                └─▶ SyncDO verifies JWT (JWKS from Upstash, 10 min cache)║
║                └─▶ SyncDO calls state.acceptWebSocket(ws)               ║
║                └─▶ connection HIBERNATES — zero compute billed          ║
║                                                                         ║
║   t=0s..4h   idle. NO compute. NO per-connection charge.                ║
║              Connection lives in CF's global WebSocket fabric.           ║
║              (32 MiB messages — developers.cloudflare.com/durable-      ║
║               objects/platform/limits)                                  ║
║                                                                         ║
║   t=4h12m   mobile client sends sync_push with outbox batch:            ║
║             └─▶ CF wakes the SyncDO (compute starts — billing begins)   ║
║             └─▶ SyncDO webSocketMessage(ws, msg):                       ║
║                   • for each outbox row: write to Turso (Prisma)        ║
║                   • ack row in sync_outbox                              ║
║                   • broadcast to other WS connections of tutor t_7      ║
║                     (e.g. desktop client online — receives push)        ║
║             └─▶ SyncDO returns to hibernation                           ║
║                                                                         ║
║   t=4h13m   desktop client disconnects (user closed app):               ║
║             └─▶ SyncDO webSocketClose(ws) — remove from connection set  ║
║                                                                         ║
║   t=4h30m   QStash fires outbox-drain (every 30 s):                     ║
║             └─▶ POST /internal/outbox-drain  (signed)                   ║
║             └─▶ drainer reads stale outbox rows for recently-active     ║
║                tutors, publishes to Upstash Pub/Sub, the SyncDO's       ║
║                subscriber wakes + pushes to remaining connections       ║
║             └─▶ (safety net for clients that went offline mid-push)     ║
║                                                                         ║
║   billing: only t=4h12m, t=4h13m, and t=4h30m bill compute.             ║
║            4h12m of idle hibernation = $0.                              ║
║                                                                         ║
║   the SyncDO is single-threaded per tutorId — no race on the connection ║
║   map, no lock, no CAS retry. Broadcasting to t_7's other devices is a  ║
║   method call, not a pub/sub hop.                                       ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### 12.5 One wrangler.toml Skeleton (7 route prefixes + DO bindings + Upstash vars)

```
╔══════════════════════════════════════════════════════════════════════════╗
║  workers/gateway/wrangler.toml  — ONE deployment, 7 route prefixes       ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  name = "buddysaradhi-gateway"                                           ║
║  main = "src/router.ts"                                                  ║
║  compatibility_date = "2025-10-01"                                       ║
║  compatibility_flags = ["nodejs_compat"]                                 ║
║                                                                          ║
║  # One route, one domain — every platform calls this.                    ║
║  routes = [                                                              ║
║    { pattern = "api.buddysaradhi.app/*", zone_name = "buddysaradhi.app" }║
║  ]                                                                       ║
║                                                                          ║
║  # The router dispatches by prefix — all 7 services in one bundle:       ║
║  #   /api/v1/ledger/*        → services/ledger/handlers.ts               ║
║  #   /api/v1/students/*      → services/student/handlers.ts              ║
║  #   /api/v1/attendance/*    → services/attendance/handlers.ts           ║
║  #   /api/v1/sync/*          → services/sync/handlers.ts (+ SyncDO)      ║
║  #   /api/v1/reports/*       → services/report/handlers.ts (5min CPU)    ║
║  #   /api/v1/notifications/* → services/notification/handlers.ts         ║
║  #   /api/v1/auth/*          → services/auth/handlers.ts                 ║
║  #   /internal/*             → QStash-signed internal routes only        ║
║  #   /health                 → gateway /health aggregator                ║
║                                                                          ║
║  # Durable Object bindings — the only stateful services.                 ║
║  [[durable_objects.bindings]]                                            ║
║  name = "SYNC_DO"                                                        ║
║  class_name = "SyncDO"                                                   ║
║                                                                          ║
║  [[durable_objects.bindings]]                                            ║
║  name = "RATE_LIMIT_DO"                                                  ║
║  class_name = "RateLimitDO"                                              ║
║                                                                          ║
║  [[migrations]]                                                          ║
║  tag = "v1"                                                              ║
║  new_classes = ["SyncDO", "RateLimitDO"]                                 ║
║                                                                          ║
║  # Upstash Redis (cache + Pub/Sub) + Supabase — via vars.                ║
║  [vars]                                                                  ║
║  UPSTASH_REDIS_URL = "https://xxx.upstash.io"                            ║
║  SUPABASE_URL      = "https://xxx.supabase.co"                           ║
║  SUPABASE_ANON_KEY = "eyJ..."                                            ║
║                                                                          ║
║  # Secrets (set via `wrangler secret put`, never in this file):          ║
║  #   UPSTASH_REDIS_TOKEN                                                 ║
║  #   QSTASH_TOKEN                                                        ║
║  #   QSTASH_CURRENT_SIGNING_KEY                                          ║
║  #   QSTASH_NEXT_SIGNING_KEY        (for rotation)                       ║
║  #   SUPABASE_SERVICE_ROLE_KEY      (provision-db Supabase Edge Fn only) ║
║                                                                          ║
║  [observability]                                                         ║
║  enabled = true                                                          ║
║                                                                          ║
║  [limits]                                                                ║
║  cpu_ms = 300000   # 5 min max — report-fn; others override per-route   ║
║                                                                          ║
║  # Prisma: generated per-service with runtime = "cloudflare" +           ║
║  # engineType = "client" + @prisma/adapter-libsql; one PrismaClient      ║
║  # per tutor cached in module-level Map<tutorId, PrismaClient> LRU ~50   ║
║  # per isolate (research_R-GQL-EDGE-REDIS.md Q4.4).                      ║
║                                                                          ║
║  # QStash schedules (configured in Upstash console, not here):           ║
║  #   POST  https://api.buddysaradhi.app/internal/notif-tick       1m    ║
║  #   POST  https://api.buddysaradhi.app/internal/outbox-drain     30s   ║
║  #   POST  https://api.buddysaradhi.app/internal/report-cleanup   24h   ║
║  #   (all signed with QStash verifySignature — reject anything else)     ║
║                                                                          ║
║  # Deploy:                                                               ║
║  #   wrangler deploy                                                     ║
║  # One bundle. One domain. One contract tag. Three platforms.            ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 13. Summary (the whole file in five lines)

1. **Seven route handlers, one `wrangler deploy`.** ledger / student / attendance / sync / report / notification / auth are seven route prefixes in `workers/gateway/`; the gateway router dispatches in-process. No `:3031`-style ports, no `XTransformPort`, no per-service process.
2. **Stateful services in Durable Objects.** `SyncDO` (per-`tutor:<tutorId>`) holds WebSocket connections via the Hibernation API — only message processing bills. `RateLimitDO` (gateway-owned) is the per-tutor token-bucket authority. Single-threaded per object, no race, no lock.
3. **Scheduled work in Upstash QStash.** Three signed CRON POSTs — `/internal/notif-tick` (1 m), `/internal/outbox-drain` (30 s), `/internal/report-cleanup` (24 h). No `setInterval`, no long-running process, no thread.
4. **The event bus is Upstash Redis Pub/Sub over HTTPS.** No NATS, no thread, no socket pool. The seven cache keys + four Pub/Sub channels share one database. The outbox pattern is preserved verbatim — the drainer just moved from a process to a QStash tick.
5. **The seven-engine→six-service map, the outbox pattern, the secure-erase orchestration, and the anti-over-engineering table — unchanged.** Only the HOSTING migrated: Bun mini-services on ports → CF Workers route handlers in one bundle. The contract, the boundary, and the no-hardcode rule are what they always were.
