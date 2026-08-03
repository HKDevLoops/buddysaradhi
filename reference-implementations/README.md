# Buddysaradhi TutorOS — Reference Implementations

This directory holds **planning artefact code**: TypeScript files that demonstrate the
three systems described in `buddysaradhi_Planning/21_Redis_Caching_Layer.md`,
`22_Vector_Search_System.md`, and `23_Complexity_Guarantees.md`. They are runnable
with `bun run <file>` but are **not wired into the Next.js app** — they exist so the
web agent can port them into `mini-services/redis-cache/`, `mini-services/search-svc/`,
and the gateway cache middleware once the Web phase reaches the cache-build-out step
(see `21_*.md §12`).

Each file has a header comment naming the spec section it implements, JSDoc
`@complexity` annotations on every public method, and a `bun run` self-test in an
`if (import.meta.main)` block where applicable.

## Layout

```
reference-implementations/
├── README.md                       ← this file
├── redis-cache/                    ← spec 21
│   ├── key-builder.ts              §3   cache key grammar + key-tag SET names
│   ├── cache-aside.ts              §2   cache-aside pattern (Redis + in-memory fallback)
│   ├── invalidator.ts              §5   event-bus-driven cache invalidation
│   ├── circuit-breaker.ts          §8.1 Redis circuit breaker (CLOSED/OPEN/HALF-OPEN)
│   └── rate-limiter.ts             §7   Redis token-bucket rate limiter
├── vector-search/                  ← spec 22
│   ├── hnsw.ts                     §3   HNSW index — O(log N) ANN search (+ benchmark)
│   ├── document-builder.ts         §1   composite text blob builders per entity
│   ├── embedder.ts                 §2   ONNX worker pool (hash-based fallback for the demo)
│   └── search-service.ts           §5   per-tutor search wrapper + post-filter + cache
└── balanced-structures/            ← spec 23
    ├── skip-list.ts                §3   skip list (mirrors Redis sorted set) — O(log N)
    └── balanced-tree.ts            §1   Red-Black tree (mirrors SQLite B-tree) — O(log N)
```

## How to run

```bash
# from /home/z/my-project/
bun run buddysaradhi_Planning/reference-implementations/vector-search/hnsw.ts
bun run buddysaradhi_Planning/reference-implementations/balanced-structures/skip-list.ts
bun run buddysaradhi_Planning/reference-implementations/balanced-structures/balanced-tree.ts
```

Each self-test prints complexity verification numbers (latency p50/p99, recall vs
brute-force for HNSW, structural invariants for the trees). The redis-cache files
do not have self-tests (they need a live Redis); they are imported by
`vector-search/search-service.ts` for the query-result cache, where the in-memory
fallback is exercised.

## Dependencies

- **`ioredis`** — already in `package.json` (`bun add ioredis`). The cache-aside
  class tries to import it lazily and falls back to an in-memory `Map` if Redis is
  unreachable, so the demo runs without `redis-server` running.
- **No other deps.** HNSW, skip-list, and Red-Black tree are pure TypeScript.

## TypeScript

All files target the project `tsconfig.json` (strict, ES2017, ESNext modules). They
can be type-checked in isolation:

```bash
bunx tsc --noEmit --strict --target es2017 --module esnext \
  --moduleResolution bundler --skipLibCheck \
  buddysaradhi_Planning/reference-implementations/**/*.ts
```

## What the web agent should do with these

Per `21_*.md §12` and `22_*.md §10`, when the Web phase reaches the cache/search
build-out:

1. Copy `redis-cache/key-builder.ts` → `src/lib/cache/key-builder.ts` (verbatim,
   it has no deps).
2. Port `redis-cache/cache-aside.ts` → `src/lib/cache/cache-aside.ts`, removing the
   in-memory fallback (it's only for the demo) and wiring the real `ioredis` client
   from `src/lib/redis.ts`.
3. Port `redis-cache/invalidator.ts` → `src/lib/cache/invalidator.ts`, subscribing
   to the Redis Streams event bus instead of the demo's `EventEmitter`.
4. Port `redis-cache/circuit-breaker.ts` and `rate-limiter.ts` → gateway middleware.
5. Copy `vector-search/hnsw.ts` → `mini-services/search-svc/hnsw.ts` (verbatim —
   pure TypeScript, no deps).
6. Port `vector-search/embedder.ts` → `mini-services/search-svc/embedder.ts`,
   replacing the hash-based pseudo-embedding with the real
   `@xenova/transformers` `bge-small-en-v1.5` ONNX model.
7. Port `vector-search/search-service.ts` → `mini-services/search-svc/index.ts`,
   wiring the real Hono server, the real event-bus subscriber, and the real query
   rewriter (z-ai LLM call).
8. The balanced-structures files (`skip-list.ts`, `balanced-tree.ts`) are
   **demonstration-only** — they prove the O(log N) bound that Redis's sorted set
   and SQLite's B-tree also achieve. They are not ported into the app; the app uses
   Redis `ZADD`/`ZREVRANGE` for leaderboards and Turso's B-tree for indexed queries.
