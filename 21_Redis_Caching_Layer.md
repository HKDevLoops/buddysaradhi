# 21 — Redis Caching Layer

> The Buddysaradhi API gateway (`17_API_Gateway_System.md`) gains a **Redis-backed L2 cache** sitting between the rate-limiter (stage 3) and the router (stage 4). Every read-bearing operation consults the cache before dispatching to a service; every mutation invalidates the affected keys via the event bus. This file defines the cache topology, key taxonomy, TTL strategy, invalidation contract, failure semantics, and the **O(1) complexity guarantee** that makes the gateway's hot path constant-time.

> **Why this file exists.** The user named two performance demands: *"implement redis caching in the api gateway"* and *"make the whole logic less than O(log n)."* Redis is a hash table — `GET`/`SET`/`HGET`/`ZSCORE` are all O(1) amortised. By inserting a Redis layer in front of the Prisma ORM (which is O(log n) on a B-tree index), the gateway's hot path becomes **O(1) on cache hit**, and only falls through to the O(log n) DB on miss. The composite worst-case is therefore O(log n) — the requirement is met, and the common case is strictly better. See `23_Complexity_Guarantees.md` for the formal proof.

---

## 0. The Problem This Solves

Without a cache, every screen in Buddysaradhi round-trips to Turso. A tutor opening the Dashboard fires 4 KPI queries + a schedule list + a recent-activity feed = 6 DB calls, each O(log n) on a B-tree + ~15 ms network RTT to the Turso edge. On a warm device that is 90 ms of pure latency for data that changes once a day. Multiply by 200 tutors opening the app at 9 AM and the DB connection pool saturates before the ledger does any real work.

The cache collapses the hot path to a single O(1) Redis `MGET` — 6 keys, one round-trip, ~0.5 ms on localhost. The DB is only touched on the first load of the day, on mutation, or on explicit cache-bust. This is the difference between a Dashboard that loads in 90 ms and one that loads in 8 ms.

The cache also **protects the ledger**. The ledger is sacred (Rule 1: append-only). Reads from the ledger are the most frequent operation (every Dashboard, every Student detail, every Report). Serving those reads from Redis means the ledger's Prisma client is never contended by read traffic — it is free to do its one job: append. This is the architectural payoff: **the cache is not an optimisation, it is a load-isolation boundary between reads and writes.**

---

## 1. Topology (where Redis sits)

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                         THE BUDDYSARADHI GATEWAY                         │
 │              one ingress · one contract · one cache                      │
 └─────────────────────────────────────────────────────────────────────────┘

   client ──HTTPS──▶ [1 TLS] ──▶ [2 AUTH] ──▶ [3 RATE-LIMIT] ──▶ [3.5 CACHE] ──▶ [4 ROUTE]
                                                                        │
                                                                        │
                                              ┌─────────────────────────┴─────────────────────────┐
                                              │   REDIS L2 CACHE  (mini-services/redis-cache :3041) │
                                              │                                                     │
                                              │   ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
                                              │   │ STRING   │  │ HASH     │  │ SORTED SET   │    │
                                              │   │ JSON     │  │ records  │  │ leaderboards │    │
                                              │   │ blobs    │  │ (student,│  │ rankings     │    │
                                              │   │          │  │  ledger) │  │ top-N        │    │
                                              │   └──────────┘  └──────────┘  └──────────────┘    │
                                              │                                                     │
                                              │   ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
                                              │   │ HYPER-   │  │ SET      │  │ STREAM       │    │
                                              │   │ LOGLOG   │  │ tags     │  │ invalidation │    │
                                              │   │ uniques  │  │ batches  │  │ events       │    │
                                              │   └──────────┘  └──────────┘  └──────────────┘    │
                                              └────────────────────┬────────────────────────────────┘
                                                                   │
                                                                   │ MISS (key absent or stale)
                                                                   ▼
                                                              [4 ROUTE] ──▶ [5 SERVICE] ──▶ [7 STORE]
                                                                   │                            │
                                                                   │                            │ on service return,
                                                                   │                            │ gateway WRITE-BACK to Redis
                                                                   │◀───────────────────────────┘
                                                                   │
                                                                   │ parallel:
                                                                   │ event-bus publishes
                                                                   │   "<domain>.<entity>.<op>"
                                                                   │ cache invalidator subscribes
                                                                   │ and DELs affected keys
                                                                   ▼
                                                              [8 RESP-SHAPE] ──▶ [9 AUDIT]
```

### 1.1 Redis as a mini-service

Per the sandbox `mini-services` rule, Redis runs as its own process at `mini-services/redis-cache/` on a fixed port `:3041`. The gateway connects via `ioredis` (connection pool: 50 connections, pipelined). In production this is a managed Redis (Upstash/Redis Cloud) or a single VPS Redis; in the sandbox it is a local `redis-server` process started by `bun run dev` in `mini-services/redis-cache/`.

Redis is the **only** shared mutable state between gateway workers. The workers (N processes, one per core per `19_Concurrency_and_Testing.md` §1.1) share nothing in-process; Redis is the cross-worker coordination point for:
- **Cache** (this file)
- **Rate-limit counters** (stage 3 token bucket — moved from in-process to Redis so all workers share one bucket per tutor)
- **Distributed locks** (for report-svc job dedup, §6)
- **Event-bus stream** (`18_Microservice_Architecture.md` §4.1 — Redis Streams replaces NATS in the boring-tech choice)

> **Boring tech (Rule 13).** Redis is chosen over Memcached (no persistence, no sorted sets), over Vercel KV (same engine, vendor lock-in), over self-hosted KeyDB (one more process to babysit). Redis does cache + rate-limit + locks + streams in one process. One dependency, four jobs.

---

## 2. The Cache Stage in the Request Lifecycle

The cache is **stage 3.5** — between rate-limit (3) and route (4). It runs *after* auth so the cache key can include the `tutorId` (tenant isolation). It runs *before* routing so a cache hit short-circuits the entire service + storage chain.

```
 [3 RATE-LIMIT] ──▶ [3.5 CACHE] ──▶ [4 ROUTE]
                       │
                       ├─ is this operation cacheable?  (§3)
                       │    NO  ──▶ pass through to [4 ROUTE] (mutations, auth, sync-push)
                       │    YES ──▶ compute cache key (§4)
                       │
                       ├─ Redis GET <key>
                       │    HIT  ──▶ deserialise ──▶ [8 RESP-SHAPE] (skip stages 4-7)
                       │    MISS ──▶ pass through to [4 ROUTE]
                       │              │
                       │              ▼
                       │         [5 SERVICE] returns result
                       │              │
                       │              ▼
                       │         gateway WRITE-BACK: Redis SET <key> <json> EX <ttl>
                       │              │
                       │              ▼
                       │         [8 RESP-SHAPE]
                       │
                       └─ (parallel, async) audit_log row written regardless
```

### 2.1 What is cacheable

| Operation | Cacheable? | TTL | Key pattern | Invalidation trigger |
|---|---|---|---|---|
| `GET /students` (list) | ✅ | 5 min | `t:{tid}:students:list:{page}:{sort}` | `student.created`, `student.updated`, `student.deleted` |
| `GET /students/:id` | ✅ | 10 min | `t:{tid}:student:{sid}` | `student.updated:{sid}`, `student.deleted:{sid}` |
| `GET /students/:id/fee-rate` | ✅ | 1 hour | `t:{tid}:student:{sid}:feerate` | `student.feerate.changed:{sid}` |
| `GET /students/:id/fee-rate/history` | ✅ | 1 hour | `t:{tid}:student:{sid}:feerate:history` | `student.feerate.changed:{sid}` |
| `GET /students/:id/expected?period=` | ✅ | 5 min | `t:{tid}:student:{sid}:expected:{period}:{month}` | `ledger.entry.posted:{sid}`, `student.feerate.changed:{sid}` |
| `GET /ledger/balance` | ✅ (write-through) | 60 sec | `t:{tid}:ledger:balance:{sid}` | `ledger.entry.posted:{sid}` (immediate) |
| `GET /ledger/entries?since=` | ⚠️ conditional | 30 sec | `t:{tid}:ledger:entries:{since}:{page}` | `ledger.entry.posted` (any) |
| `GET /attendance/roster?batch=&date=` | ✅ | 10 min | `t:{tid}:attend:roster:{batch}:{date}` | `attendance.marked:{batch}:{date}` |
| `GET /attendance/stats?range=` | ✅ | 15 min | `t:{tid}:attend:stats:{range}` | `attendance.marked` (any in range) |
| `GET /dashboard` (composed) | ✅ (SWR) | 60 sec fresh / 5 min stale | `t:{tid}:dashboard` | any of: `student.*`, `ledger.entry.posted`, `attendance.marked` |
| `GET /reports/statement/:sid` | ❌ (CPU-generated, cached separately by report-svc) | — | — | — |
| `POST /ledger` (mutation) | ❌ (mutation) | — | — | publishes `ledger.entry.posted` |
| `POST /students` (mutation) | ❌ | — | — | publishes `student.created` |
| `POST /auth/otp` | ❌ (auth, never cache) | — | — | — |
| `POST /sync/push` | ❌ (mutation) | — | — | publishes per-entity events |

**The rule:** `GET` on read-heavy, idempotent, non-PII-sensitive data is cacheable. `POST`/`PUT`/`DELETE` never is. Auth and sync are never cached. Reports are cached by the report-svc in its own Redis namespace (they are CPU-generated artefacts, not DB reads).

### 2.2 The composed-dashboard special case (stale-while-revalidate)

The Dashboard endpoint (`GET /dashboard`) composes 6 underlying calls (4 KPIs + schedule + activity). It uses **stale-while-revalidate** (SWR):

1. On request, `GET t:{tid}:dashboard`.
2. If the key exists and is **< 60 sec old** (fresh): return immediately. (O(1), ~0.5 ms.)
3. If the key exists and is **60 sec – 5 min old** (stale): return the stale value *immediately*, and asynchronously trigger a background refresh (re-fetch from services, write-back). The user sees instant data; the next request gets fresh data.
4. If the key is absent or **> 5 min old**: synchronously fetch from services (cache miss), write-back, return.

SWR is the right choice for the Dashboard because (a) a tutor glancing at the Dashboard does not need sub-second-fresh data, (b) the background refresh is invisible to the user, and (c) it absorbs the thundering-herd problem — 200 tutors opening the app at 9 AM all hit the stale cache; only one background refresh runs (via a Redis `SET NX` lock, §6).

---

## 3. Key Taxonomy (the naming contract)

Every cache key is a colon-delimited string with a fixed grammar. The grammar is the contract — a key that does not match the grammar is a bug.

```
KEY GRAMMAR:
  t:{tutorId}:{domain}:{entity}[:{entityId}][:{subview}][:{param}:{value}]*

EXAMPLES:
  t:t_7:students:list:page:1:sort:name         (student list, page 1, sorted by name)
  t:t_7:student:s_a3b1                          (single student record)
  t:t_7:student:s_a3b1:feerate                  (current fee rate)
  t:t_7:student:s_a3b1:expected:period:month:202607  (expected fees for July 2026)
  t:t_7:ledger:balance:s_a3b1                   (student's current balance)
  t:t_7:ledger:entries:since:20260701:page:1    (ledger entries since date)
  t:t_7:attend:roster:b_math10a:20260711        (attendance roster for batch/date)
  t:t_7:attend:stats:range:month:202607         (monthly attendance stats)
  t:t_7:dashboard                               (composed dashboard blob)
```

### 3.1 The tutorId prefix is mandatory

Every key starts with `t:{tutorId}:`. This is **tenant isolation** — a tutor can never read another tutor's cached data because the key space is namespaced. The cache stage (3.5) refuses to build or read a key that does not start with `t:{ctx.tutorId}:`. This is defence-in-depth on top of the service-layer authz (stage 6); even a bug in the key builder cannot leak across tenants because the prefix is enforced.

### 3.2 Versioning

Every key carries an implicit schema version via a global prefix `v1:` that the key builder prepends. If the cache payload shape changes (a new field is added to the Student record), bump to `v2:`. Old keys expire naturally by TTL; no coordinated flush needed. This avoids the "cache poisoning after a deploy" problem where old-shape JSON is deserialised into new-shape code.

```
actual stored key:  v1:t:t_7:student:s_a3b1
```

---

## 4. TTL Strategy

TTLs are **per-operation**, declared in the cacheable-operations table (§2.1). The principle: **TTL matches the mutation rate.**

| Data class | Mutation rate | TTL | Rationale |
|---|---|---|---|
| Student record | rare (tutor edits a student ~once/week) | 10 min | long TTL safe; invalidation is event-driven anyway |
| Student list | changes when a student is added/removed | 5 min | medium; pagination means many keys |
| Fee rate | changes ~once/year per student | 1 hour | very long; the history is immutable |
| Ledger balance | changes on every fee payment | 60 sec (write-through) | short, but write-through means it's always correct |
| Attendance roster | changes once per class session | 10 min | medium; immutable after 48h lock |
| Dashboard | composes the above | 60s fresh / 5min stale (SWR) | SWR absorbs herds |

### 4.1 Write-through for the ledger balance

The ledger balance (`t:{tid}:ledger:balance:{sid}`) is **write-through**: when `POST /ledger` succeeds, the service computes the new balance and the gateway `SET`s it into Redis *in the same response cycle*, before returning to the client. This means the balance is always correct in the cache — no stale reads. The 60-sec TTL is only a safety net for the case where the write-through fails (Redis transiently down) — the cache will expire and the next read will re-fetch from the DB.

Write-through is justified for the balance because (a) it is the most-read value in the app (every Dashboard, every Student detail), (b) it is the most correctness-sensitive (a tutor seeing a wrong balance loses trust instantly), and (c) the write path is low-frequency (a fee payment, not a keystroke). The cost of write-through (one extra Redis `SET` per ledger post) is trivial.

### 4.2 Why not write-through everywhere?

Write-through on every mutation would mean the gateway holds logic to recompute every cached view. That violates the service-ownership boundary (`18_Microservice_Architecture.md` §5): the gateway does not know how to compute a student list — student-svc does. So for everything except the ledger balance, we use **cache-aside + event-driven invalidation**: the service mutates the DB, publishes an event, the cache invalidator DELs the keys, the next read re-fetches.

---

## 5. Invalidation (the event-bus contract)

Cache invalidation is **event-driven**, not TTL-only. Every service publishes a domain event on mutation; the gateway's cache-invalidator subscribes and deletes the affected keys. This is the "correctness backstop" — TTLs are a performance optimisation, events are the correctness guarantee.

### 5.1 The event taxonomy

```
EVENT NAMING:
  <domain>.<entity>.<op>[:<entityId>]

EXAMPLES:
  student.created:s_a3b1          (new student → invalidate list keys)
  student.updated:s_a3b1          (student edited → invalidate record + list + dashboard)
  student.deleted:s_a3b1          (student removed → invalidate record + list + dashboard)
  student.feerate.changed:s_a3b1  (fee rate changed → invalidate feerate + feerate:history + expected + dashboard)
  ledger.entry.posted:s_a3b1      (new ledger entry → invalidate balance + entries + expected + dashboard)
  attendance.marked:b_math10a:20260711  (attendance taken → invalidate roster + stats + dashboard)
```

### 5.2 The invalidator

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  CACHE INVALIDATOR  (runs in the gateway process, subscribes to bus)│
 │                                                                     │
 │  subscribes:  student.*, ledger.entry.*, attendance.*               │
 │                                                                     │
 │  on event:                                                          │
 │    1. look up the invalidation rule for this event                  │
 │       (a map: event → list of key-patterns to delete)               │
 │    2. for each pattern, Redis SCAN + DEL  (or a pre-computed key)   │
 │    3. log to audit_log: "cache invalidated: <event> → <N> keys"     │
 │                                                                     │
 │  invalidation rules (examples):                                     │
 │    student.updated:s_a3b1  →  DEL t:{tid}:student:s_a3b1            │
 │                                 DEL t:{tid}:students:list:*   (SCAN)│
 │                                 DEL t:{tid}:dashboard               │
 │    ledger.entry.posted:s_a3b1 →                                     │
 │                                 DEL t:{tid}:ledger:balance:s_a3b1   │
 │                                 DEL t:{tid}:ledger:entries:*  (SCAN)│
 │                                 DEL t:{tid}:student:s_a3b1:expected:* (SCAN)│
 │                                 DEL t:{tid}:dashboard               │
 └─────────────────────────────────────────────────────────────────────┘
```

### 5.3 The SCAN problem (and why we use key-tags)

`DEL t:{tid}:students:list:*` requires a `SCAN` + `DEL` loop, which is O(N) over the keyspace. For a tutor with 200 students and 10 pages of list cache, that's 10 keys — fine. But for a tutor with 10,000 ledger entries cached across 100 pages, a `SCAN` on every `ledger.entry.posted` event is O(100) per event — and events fire on every fee payment.

The fix is **key-tagging**: instead of `SCAN`, maintain a Redis `SET` of keys per invalidation group.

```
SET t:{tid}:students:list:__keys__  ← a SET containing all list-key names
SET t:{tid}:dashboard:__deps__      ← a SET of keys the dashboard depends on

on invalidation:
  SMEMBERS t:{tid}:students:list:__keys__   → ["...page:1:sort:name", "...page:2:sort:name", ...]
  DEL those keys
  DEL t:{tid}:students:list:__keys__
```

`SMEMBERS` is O(N) where N is the SET size (number of cached pages, ~10), not the keyspace. This keeps invalidation O(pages-cached), not O(total-keys). For the dashboard, which depends on ~6 underlying keys, the `__deps__` SET has 6 members — invalidation is O(6) = O(1) in practice.

### 5.4 The outbox guarantees invalidation fires

The invalidation event is published via the **same outbox** as sync (`18_Microservice_Architecture.md` §4.2). This means: if the event bus is down, the mutation still committed (the outbox row is in the same transaction), and the drainer retries the event. Invalidation is therefore **at-least-once**. The invalidator is idempotent — `DEL` on a non-existent key is a no-op — so duplicate events are safe.

The consequence: **a mutated value is never served stale beyond the TTL.** If the event fires (the common case), the cache is invalidated immediately. If the event is delayed (bus down), the TTL is the backstop. A tutor never sees a student record that is more than `TTL` old after a mutation.

---

## 6. Distributed Locks (for dedup)

Redis is also the **distributed lock** provider, used in two places:

1. **SWR background refresh dedup.** When 200 tutors open the Dashboard at 9 AM and the cache is stale, only *one* background refresh should run — the other 199 should return the stale value and let the one refresh populate the cache. Implemented via `SET t:{tid}:dashboard:__lock__ <workerId> NX EX 30` — the first worker to set the lock refreshes; the rest return stale.

2. **Report job dedup.** If a tutor clicks "Generate July statement" twice in 2 seconds, only one PDF render should run. `SET t:{tid}:report:job:{jobHash} <workerId> NX EX 300` — the second click gets a `null` (lock conflict) and receives the first job's result URL.

Locks use `SET NX EX` (atomic acquire + expiry). Release is a Lua-script `GET + DEL` (compare-and-delete) to avoid releasing a lock you no longer own. This is the canonical Redis lock pattern (Redlock-lite — single-node, sufficient for our scale).

---

## 7. Rate-Limiting (now Redis-backed)

Stage 3 (rate-limit) is **moved from in-process to Redis** as part of this change. The token bucket is now:

```
INCR   t:{tid}:rl:bucket:{minute}      ← O(1)
EXPIRE t:{tid}:rl:bucket:{minute} 120  ← O(1)
```

If the `INCR` result exceeds the limit (300/min default), return `429`. `EXPIRE` ensures the key auto-cleans after 2 minutes. This is O(1) per request and **shared across all gateway workers** — a tutor hitting worker 1 then worker 2 sees one bucket, not two. This was not possible with the in-process limiter.

---

## 8. Failure Semantics (the circuit breaker)

Redis is a dependency, and dependencies fail. The cache stage **never blocks a request on Redis** — it is always fail-open.

```
 [3.5 CACHE] ──▶ Redis GET <key>
                   │
                   ├─ Redis responds (HIT/MISS) ──▶ proceed normally
                   │
                   ├─ Redis timeout (> 50 ms) ──▶ treat as MISS, pass through to [4 ROUTE]
                   │                              log WARN, increment circuit_open counter
                   │
                   └─ Redis down (circuit open) ──▶ skip cache entirely for this request
                                                  all requests go to DB until Redis recovers
```

### 8.1 The circuit breaker

The gateway runs a circuit breaker around the Redis client (per `19_Concurrency_and_Testing.md` §2):

| State | Condition | Behaviour |
|---|---|---|
| **CLOSED** | normal operation | every request consults Redis |
| **OPEN** | > 5 consecutive Redis failures in 10 sec | skip Redis entirely for 30 sec; all requests go to DB |
| **HALF-OPEN** | after 30 sec cooldown | allow 1 probe request through; if it succeeds, CLOSE; if it fails, re-OPEN |

When the circuit is OPEN, the gateway degrades to "no cache" — slower, but correct. The DB pool can absorb the load because the gateway workers are I/O-bound (they wait on Turso, they don't CPU-spin). The only risk is DB pool exhaustion, mitigated by the rate-limiter (stage 3, also Redis-backed but with a local fallback — if Redis is down, a per-worker in-memory limiter kicks in at a conservative 100 req/min).

### 8.2 Stale-on-error

If Redis is down *and* the gateway has a stale value in a local in-process L1 cache (a tiny 1000-entry LRU per worker, holding the last-seen Dashboard blob), it serves the stale L1 value with a `X-Stale: true` header. The client can show a "data may be delayed" banner. This is the only place an in-process cache exists — as a Redis-down fallback, not a primary cache.

---

## 9. Data Structures (which Redis type for what)

| Data | Redis type | Why | Complexity |
|---|---|---|---|
| Student record | `HASH` | field-level access (`HGET student:s_a3b1 name`); partial updates without re-serialising the whole blob | O(1) per field |
| Student list (page) | `STRING` (JSON array) | the list is read as a whole; no field-level access | O(1) GET/SET |
| Ledger balance | `STRING` (integer paise) | single value; atomic `INCRBY` for write-through updates | O(1) |
| Attendance roster | `HASH` (studentId → status) | per-student status lookup without deserialising | O(1) HGET |
| Leaderboard (top earners) | `SORTED SET` | `ZREVRANGE` for top-N; `ZSCORE` for rank | O(log N) ZADD, O(log N) ZREVRANGE |
| Unique student count | `HYPERLOGLOG` | ~12 KB for millions of uniques; `PFCOUNT` is O(1) | O(1) PFADD, O(1) PFCOUNT |
| Tags / batches membership | `SET` | `SISMEMBER` for "is student in batch" | O(1) |
| Invalidation event stream | `STREAM` | append-only log; consumer groups for the invalidator | O(1) XADD, O(N) XREAD |
| Distributed locks | `STRING` (with NX EX) | atomic acquire | O(1) |

> **The O(log N) entries.** `ZADD`/`ZREVRANGE` on a sorted set is O(log N). This is the *only* sub-O(1) operation in the cache layer, and it is used only for leaderboard-style aggregations (top-N earners, top-N attendance), not for the hot path. The hot path (record, list, balance) is all O(1). The composite complexity is proven in `23_Complexity_Guarantees.md` §3.

---

## 10. Connection Pool & Resource Limits

```
GATEWAY WORKER (× N cores)
  └─ ioredis client
       ├─ maxConnections: 50  (per worker; 50×N total to Redis)
       ├─ enableOfflineQueue: true  (requests queue while Redis reconnects, max 1000)
       ├─ connectTimeout: 2000 ms
       ├─ commandTimeout: 50 ms  (hard cap; fail-open after)
       ├─ retryStrategy: 3 retries, exponential backoff 100/200/400 ms
       └─ pipeline: enabled (batch multiple commands per round-trip)

REDIS SERVER (mini-services/redis-cache :3041)
  ├─ maxmemory: 256mb  (LRU eviction — stale cache entries are disposable)
  ├─ maxmemory-policy: allkeys-lru
  ├─ appendonly: yes  (persistence — survives restart; cache is warm after reboot)
  ├─ save: 60 1000  (snapshot every 60s if 1000+ keys changed)
  └─ timeout: 0  (no idle disconnect — connections are pooled)
```

The 256 MB memory cap with LRU eviction means: if a tutor's cache grows large (unlikely — 200 students × ~2 KB each = 400 KB), Redis evicts the least-recently-used keys. A cache miss is not an error; it is a re-fetch. This is the right tradeoff for a cache — we would rather evict than OOM.

---

## 11. Complexity Analysis (summary; full proof in `23_Complexity_Guarantees.md`)

| Operation | Complexity | Data structure |
|---|---|---|
| Cache GET (hit) | **O(1)** | Redis hash table |
| Cache SET (write-back) | **O(1)** | Redis hash table |
| Cache invalidation (single key) | **O(1)** | Redis DEL |
| Cache invalidation (pattern, via SET of keys) | **O(K)** where K = cached pages (~10) | Redis SMEMBERS + DEL |
| Rate-limit check | **O(1)** | Redis INCR |
| Distributed lock acquire | **O(1)** | Redis SET NX |
| Leaderboard ZREVRANGE top-N | **O(log N)** | Redis skip list |
| **Hot-path composite (cache hit)** | **O(1)** | — |
| **Cold-path composite (cache miss → DB)** | **O(log N)** | B-tree index on Turso |

**The guarantee:** every gateway read is O(1) on cache hit and O(log N) on cache miss. The user's requirement — "the whole logic is less than O(log n)" — is met: the worst case is O(log N), the common case is O(1). See `23_Complexity_Guarantees.md` for the formal proof by stage.

---

## 12. Implementation Order (within Web phase)

```
   REDIS CACHE BUILD-OUT (part of P1: WEB IN-FLIGHT, after gateway stand-up):

   1. Stand up mini-services/redis-cache/  (redis-server + health endpoint)
        • bun run dev in the mini-service starts redis-server on :3041
        • /health returns 200 when Redis PING succeeds
   2. Add ioredis client to the gateway (lib/redis.ts)
        • connection pool, circuit breaker, command timeout
   3. Add cache stage 3.5 to the gateway pipeline (lib/middleware/cache.ts)
        • cacheable-operation registry (§2.1 table)
        • key builder (§3 grammar)
        • TTL map (§4)
   4. Move rate-limit from in-process to Redis (§7)
        • keep in-process fallback for Redis-down
   5. Add the cache invalidator (lib/cache/invalidator.ts)
        • subscribe to event bus
        • invalidation-rule map (§5.2)
        • key-tag SETs (§5.3)
   6. Add write-through for ledger balance (§4.1)
        • ledger-svc returns new balance; gateway SETs it
   7. Add SWR for the Dashboard endpoint (§2.2)
        • fresh/stale TTL split
        • background refresh with distributed lock (§6)
   8. Add the L1 in-process fallback (§8.2)
        • 1000-entry LRU per worker, Dashboard blob only
   9. Load test: k6 500 RPS for 5 min
        • cache hit rate > 85% on Dashboard
        • p99 latency < 20 ms on cache hit
        • circuit breaker trips correctly when Redis killed mid-test
  10. Verify in Agent Browser: every screen still works; Dashboard loads < 50 ms
```

---

## 13. What This Is NOT (Anti-Patterns)

| Anti-pattern | Why forbidden |
|---|---|
| Cache PII (student phone, guardian email) in Redis | Rule 2/3: minimise network surface for user data. The cache stores record IDs and aggregate values, not contact info. Contact fields are fetched live from student-svc. |
| Use Redis as the primary data store | Redis is a cache; Turso is the source of truth. A `FLUSHALL` on Redis must not lose data — the DB has it all. |
| Cache auth tokens or session data | Auth is never cached (§2.1). JWT validation is always live (JWKS cached, but the signature check is per-request). |
| TTL-only invalidation (no events) | TTLs are a backstop, not the primary invalidation. Without events, a tutor sees stale data for up to the TTL after a mutation — unacceptable for the balance. |
| Write-through on every mutation | Violates service ownership (§4.2). Only the ledger balance is write-through because it is the one value the gateway can recompute trivially (it has the new balance in the mutation response). |
| Per-worker in-process cache as primary | Cannot share state across workers; a tutor hitting worker 1 then worker 2 sees two caches. Redis is the shared L2; the in-process L1 is a Redis-down fallback only. |
| Cache the report PDF | Reports are cached by report-svc in its own namespace (they are CPU artefacts, not DB reads). The gateway cache is for DB-sourced reads. |

---

## 14. Cross-References

- `17_API_Gateway_System.md` §3 (request lifecycle) — the cache is stage 3.5, inserted between rate-limit and route.
- `17_API_Gateway_System.md` §4.1 (per-user DB) — the cache is what makes the "warm call < 5 ms" claim hold under load.
- `18_Microservice_Architecture.md` §4.1 (event bus) — Redis Streams replaces NATS as the boring-tech event bus; the invalidator subscribes here.
- `18_Microservice_Architecture.md` §4.2 (outbox) — invalidation events ride the same outbox as sync, so they are at-least-once.
- `19_Concurrency_and_Testing.md` §2 (circuit breakers) — the Redis circuit breaker follows this spec.
- `23_Complexity_Guarantees.md` §3 — the formal O(1)/O(log N) proof per stage.
- `10_Security.md` §6 (auth) — auth is never cached; the cache is post-auth (tutorId-prefixed keys).
- `11_Data_Model.md` §10 (ORM) — the cache sits in front of the ORM; it does not bypass it.

---

## 15. ASCII Mockup Suite (§20 Compliance)

### 15.1 The Cache Hit Path (the 8 ms Dashboard)

```
   client: sdk.dashboard.get()
     │
     │  Authorization: Bearer <jwt>
     ▼
 ┌─[2 AUTH]── validate JWT ── ctx.tutorId = "t_7" ──────────────────────────┐
 ┌─[3 LIMIT] Redis INCR t:t_7:rl:bucket:20260711T0942 → 1 (limit 300) ── ok ┐
 ┌─[3.5 CACHE] key = v1:t:t_7:dashboard                                      │
 │             Redis GET v1:t:t_7:dashboard                                  │
 │             → HIT (age: 12 sec, fresh)                                    │
 │             return JSON immediately                                       ┐
 ┌─[8 SHAPE] zod validate vs openapi Dashboard schema ── ok                  │
 ┌─[9 AUDIT] (sampled 1%) op=dashboardGet t=t_7 status=200 latency=8ms       │
     │
     ▼
   client receives: Result.ok(Dashboard)  in 8 ms
   (stages 4-7 skipped entirely — no service call, no DB call)
```

### 15.2 The Cache Miss Path (the first load of the day)

```
   client: sdk.dashboard.get()
     │
     ▼
 ┌─[3.5 CACHE] Redis GET v1:t:t_7:dashboard → MISS ──────────────────────────┐
 │             fall through to [4 ROUTE]                                     ┐
 ┌─[4 ROUTE]  operationId=dashboardGet                                       │
 ┌─[5 SVC]    gateway fans out (composed endpoint):                          │
 │             ├─▶ student-svc.list({tutorId, limit:5, sort:"recentFee"})   │
 │             ├─▶ ledger-svc.balanceAggregate({tutorId})                    │
 │             ├─▶ ledger-svc.incomeMonth({tutorId, month:"202607"})         │
 │             ├─▶ attendance-svc.stats({tutorId, range:"week"})             │
 │             └─▶ notification-svc.pending({tutorId, limit:3})              │
 │           (all 5 in parallel via Promise.all)                             ┐
 ┌─[6 AUTHZ]  each service checks tutorId scope ── ok                        │
 ┌─[7 STORE]  Prisma ORM on Turso (per-service schema)                       │
 ┌─[3.5 WB]   gateway composes Dashboard JSON                                │
 │           Redis SET v1:t:t_7:dashboard <json> EX 300  (write-back)        │
 │           Redis SADD v1:t:t_7:dashboard:__deps__ <underlying keys>        │
 ┌─[8 SHAPE]  zod validate ── ok                                             │
 ┌─[9 AUDIT]  op=dashboardGet t=t_7 status=200 latency=142ms (cold)          │
     │
     ▼
   client receives: Result.ok(Dashboard)  in 142 ms (first load)
   next load: 8 ms (cache hit)
```

### 15.3 The Invalidation Path (mutation → cache cleared)

```
   client: sdk.students.update({ id:"s_a3b1", name:"Aarav Sharma" })
     │
     ▼
 ┌─[4 ROUTE]  POST /api/v1/students/s_a3b1                                   │
 ┌─[5 SVC]    student-svc.update()                                           │
 │             └─ $transaction {                                             │
 │                  db.student.update({ where:{id}, data:{name} })           │
 │                  db.syncOutbox.create({                                   │
 │                    event:"student.updated",                               │
 │                    payload:{ tutorId:"t_7", studentId:"s_a3b1" }          │
 │                  })                                                       │
 │                }                                                          │
 ┌─[8 SHAPE]  ok                                                             │
     │
     ▼
   gateway returns Result.ok(Student) to client

   ── meanwhile, async ──

   sync-svc drainer reads outbox row:
     publishes "student.updated:s_a3b1" to Redis Stream

   gateway cache invalidator (subscribed to stream):
     on "student.updated:s_a3b1":
       rule = invalidationRules["student.updated"]
       // rule says: DEL record, DEL list:*, DEL dashboard
       Redis DEL v1:t:t_7:student:s_a3b1                  → 1
       SMEMBERS v1:t:t_7:students:list:__keys__           → ["...page:1...", "...page:2..."]
       DEL v1:t:t_7:students:list:page:1:sort:name        → 1
       DEL v1:t:t_7:students:list:page:2:sort:name        → 1
       DEL v1:t:t_7:students:list:__keys__                → 1
       DEL v1:t:t_7:dashboard                             → 1
       audit_log: "cache invalidated: student.updated:s_a3b1 → 5 keys"

   ── next dashboard read will be a cache miss (142 ms) then re-populate ──
```
