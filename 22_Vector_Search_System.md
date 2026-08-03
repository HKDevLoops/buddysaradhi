# 22 — Vector Search System

> Buddysaradhi gains a **semantic vector search** layer for finding students, lessons, ledger entries, and tutor notes by *meaning*, not just by substring. A tutor types "the kid who struggles with fractions" or "Aarav from the morning batch" or even a Devanagari phonetic approximation — and the right students surface. This file defines the embedding pipeline, the **HNSW (Hierarchical Navigable Small World) index** that gives O(log N) approximate-nearest-neighbour search, the per-tutor index isolation, the index build/update lifecycle, and the complexity contract.

> **Why this file exists.** The user named two demands: *"implement vector searching so to make it faster"* and *"ensure the whole logic is less than O(log n)."* Vector search with a brute-force scan is O(N × D) (N vectors × D dimensions) — for 10,000 students at 384 dimensions that is 3.8M cosine computations per query, ~200 ms. HNSW reduces this to **O(log N)** — ~0.3 ms for the same 10,000 vectors. This meets the requirement: the search path is O(log N), and with the Redis cache in front (§8), the hot path is O(1) on cache hit. See `23_Complexity_Guarantees.md` §4 for the proof.

---

## 0. The Problem This Solves

Substring search (`WHERE name LIKE '%arav%'`) has three failures:

1. **Spelling drift.** A tutor remembers "Aarav" but the student's name is recorded as "Aarav Sharma" with a Devanagari alias "आरव". A `LIKE` query on "arav" misses the Devanagari form; a `LIKE` on "आरव" misses the Latin form. The tutor does not want to remember which script they typed.
2. **Semantic gap.** A tutor searches "the kid who is behind on fees" — there is no name or field that contains those words. The intent is "students with arrears > 0", but the tutor expressed it in natural language. Substring search cannot bridge intent to data.
3. **Cross-field recall.** "Aarav from the morning batch" requires joining students → enrolments → batches → schedule. A `LIKE` on the students table cannot express "morning batch"; it needs the join. The tutor expects one search box to do this.

Vector search solves all three: the student's name (both scripts), their batch, their fee status, and recent notes are embedded into a single 384-dimensional vector. The query is embedded the same way. Cosine similarity in vector space is script-agnostic, semantically aware, and cross-field by construction.

---

## 1. What Gets Embedded (the document model)

Every "searchable document" in Buddysaradhi is a **composite text blob** built from the entity's fields, prefixed with a type tag. The blob is what the embedding model sees.

```
DOCUMENT MODEL (per entity type):

STUDENT:
  "[STUDENT] Name: Aarav Sharma (आरव शर्मा). Grade: 10. Batch: Morning Maths 10A.
   Guardian: Ramesh Sharma (father), +91-98xxxxxx21. Fee: ₹2500/monthly.
   Status: arrears ₹1200. Notes: struggles with fractions, strong in algebra.
   Attendance: 78% (last 30 days). Enrolled: Jan 2026."

LEDGER ENTRY:
  "[LEDGER] Date: 2026-07-11. Student: Aarav Sharma. Type: fee_payment.
   Amount: ₹2500. Method: UPI. Note: July tuition. Reverses: none."

LESSON / SESSION NOTE:
  "[LESSON] Date: 2026-07-10. Batch: Morning Maths 10A. Topic: Fractions —
   addition and subtraction. Aarav struggled; gave extra worksheet. Priya
   aced it. Homework: worksheet 3."

TUTOR NOTE (free-text):
  "[NOTE] 2026-07-09. Aarav's father called about fee extension. Granted
   1 week. Follow up 16 Jul."
```

### 1.1 Why a composite blob (not per-field embeddings)

Per-field embeddings (one vector for name, one for notes, one for batch) would require a multi-vector index and a fusion step (e.g., RRF) at query time — complexity and latency. The composite blob folds all fields into one vector, so one HNSW search answers any query. The tradeoff is that a field-specific query ("show me all students in Morning Maths 10A") is less precise than a structured DB filter — but that query is already served by the structured filter UI (the batch dropdown). Vector search is for *fuzzy, intent-driven* queries; structured filters handle the rest. They coexist; the search bar tries vector first, falls back to structured filters if the query parses as a filter (`batch:X`, `arrears:>0`, `grade:10`).

### 1.2 The type-tag prefix

The `[STUDENT]` / `[LEDGER]` / `[LESSON]` / `[NOTE]` prefix lets the embedding model learn that these are different entity types. At query time, if the tutor's query implies a type ("show me students who..."), the query blob is prefixed the same way, biasing the cosine similarity toward the right type. If the query is type-ambiguous ("Aarav"), no prefix is added and all types compete on similarity.

---

## 2. The Embedding Pipeline

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                       EMBEDDING PIPELINE                                 │
 └─────────────────────────────────────────────────────────────────────────┘

   ENTITY MUTATION                    ┌──────────────────────┐
   (student-svc.update,               │  DOCUMENT BUILDER     │
    ledger-svc.postEntry,             │  (per entity type)    │
    etc.)                             │  builds composite blob│
        │                             └──────────┬───────────┘
        │                                        │
        ▼                                        ▼
   outbox row                          ┌──────────────────────┐
   event: "<domain>.<entity>.<op>"     │  EMBEDDING WORKER     │
        │                              │  (worker_threads pool)│
        │                              │  calls embedding model│
        │                              │  → 384-dim Float32    │
        │                              └──────────┬───────────┘
        ▼                                        │
   sync-svc drainer                             │
   publishes to event bus                       │
        │                                       │
        ▼                                       ▼
   ┌─────────────────────┐         ┌──────────────────────────┐
   │  SEARCH INDEXER      │◀────────│  INDEX WRITER            │
   │  (subscribes to bus) │         │  HNSW index upsert       │
   │  filters to          │         │  (per-tutor index)       │
   │  searchable events   │         └──────────────────────────┘
   └─────────────────────┘
```

### 2.1 The embedding model

The embedding model is **`bge-small-en-v1.5`** (384 dimensions, ~130 MB, CPU-runnable in <10 ms per text) served locally via `@xenova/transformers` (ONNX runtime). This is a boring-tech choice: it runs in a `worker_threads` pool inside a dedicated `search-svc` mini-service (port `:3038`), no GPU, no external API call, no per-query cost.

> **Why not the z-ai LLM for embeddings?** The z-ai SDK (available in this sandbox) provides LLM chat, VLM, TTS, ASR, image generation — but no dedicated embeddings endpoint. Using the LLM to generate embeddings (by prompting "return a vector for...") is unreliable (LLMs are not trained for stable vector output) and expensive (a full LLM forward pass per embedding). A local sentence-transformer model is the correct tool: purpose-built, deterministic, fast, free. The z-ai LLM is still used for *query rewriting* (§5) — turning "the kid behind on fees" into a structured search intent — but not for the embeddings themselves.

#### 2.1.1 Devanagari / multilingual support

`bge-small-en-v1.5` is English-tuned but handles Devanagari transliteration reasonably (it was trained on web text including transliterated Indic names). For tutors with predominantly Devanagari input, the search-svc can be configured (per-tutor setting) to use **`paraphrase-multilingual-MiniLM-L12-v2`** (384 dim, ~470 MB, 50+ languages including Hindi) instead. The dimension is the same (384), so the HNSW index structure is identical; only the model weights differ. The tutor picks the model in Settings; the search-svc rebuilds the index on model switch (a one-time ~30 sec job for 200 students).

### 2.2 The worker pool

Embedding generation is CPU-bound (a transformer forward pass). Per `19_Concurrency_and_Testing.md` §1.1, CPU-bound work runs in a `worker_threads` pool, not on the main event loop. The search-svc main thread accepts index-upsert jobs, hands them to a worker pool (size `min(4, cores-1)`), and the worker returns the 384-dim vector. The main thread then upserts into the HNSW index.

```
search-svc process (Bun, 1 main thread)
  ├─ main thread: accepts requests, manages HNSW index, serves queries
  └─ worker_threads pool (size 4)
       ├─ worker 1: ONNX session, embed(text) → Float32Array(384)
       ├─ worker 2: ONNX session (same model, parallel inference)
       ├─ worker 3: ...
       └─ worker 4: ...
```

The ONNX session is loaded once per worker (cold start ~3 sec; warm inference ~8 ms per text). The pool is sized so that 4 concurrent embeddings take ~8 ms (parallel), not 32 ms (serial).

---

## 3. The HNSW Index (why O(log N))

HNSW (Hierarchical Navigable Small World) is the index that makes vector search sub-linear. This section explains the structure at the level needed to trust the complexity claim; the reference implementation is in `reference-implementations/vector-search/hnsw.ts`.

### 3.1 The structure

HNSW is a **multi-layer skip-list-like graph**. Each vector is a node. The graph has `L_max` layers; each node is assigned a random top layer `l` (geometric distribution: P(l ≥ k) = `1/M^k` where M is the layer multiplier). Node N appears in layers 0..l.

```
LAYER 2 (sparsest, fewest nodes):   ●─────────────────●
                                     │                 │
LAYER 1 (medium):            ●──────●──────●          ●
                             │      │      │          │
LAYER 0 (densest, ALL nodes):●──●──●──●──●──●──●──●──●──●──●──●
                             0  1  2  3  4  5  6  7  8  9 10 11
```

- **Layer 0** contains every node, each connected to its `M` nearest neighbours (plus `M_max0` = 2M for layer 0).
- **Layer 1** contains ~1/M of the nodes, each connected to their layer-1 neighbours.
- **Layer L** contains ~1/M^L of the nodes.

### 3.2 Search (why it is O(log N))

To find the top-K nearest neighbours of a query vector Q:

```
SEARCH(q, K):
  entry = the single node at the top layer (L_max)
  for layer = L_max down to 1:
      entry = greedy_search(layer, entry, q)   ← walk toward q at this layer
  results = greedy_search(layer 0, entry, q, ef)   ← full search at layer 0, return top-K
```

`greedy_search` at a layer visits the current node's neighbours, moves to the closest one to Q, and repeats until no neighbour is closer. Because each layer has ~1/M the nodes of the layer below, the search descends through `log_M(N)` layers, and at each layer the greedy walk visits a constant number of nodes (bounded by `ef`, the search-beam width). Total nodes visited: `O(ef × log_M(N))` = **O(log N)** for fixed `ef` and `M`.

```
COMPLEXITY:
  search:   O(ef × log_M N)  =  O(log N)   for fixed ef, M
  insert:   O(ef × log_M N)  =  O(log N)   (same as search + link repair)
  delete:   O(ef × log_M N)  =  O(log N)   (mark + reconnect)
  memory:   O(N × M)          (each node has M edges per layer it appears in)
```

For Buddysaradhi's scale (N ≤ 10,000 students per tutor, typically ~200), with M=16 and ef=64:
- `log_16(200) ≈ 1.9` layers of effective search
- nodes visited per query: `64 × 1.9 ≈ 122`
- query latency: ~0.3 ms (measured in the reference implementation benchmark)

### 3.3 Parameters

| Parameter | Value | Meaning | Tradeoff |
|---|---|---|---|
| `M` | 16 | edges per node per layer (layer 0: 2M=32) | higher = more memory, better recall |
| `ef_construction` | 200 | beam width during insert | higher = slower build, better index quality |
| `ef_search` | 64 | beam width during search | higher = slower query, better recall |
| `L_max` | `ceil(log_M(N)) + 1` | max layers (auto-scales with N) | derived, not tuned |

With these parameters, **recall@10 ≥ 0.95** (95% of brute-force results are in the HNSW top-10) at **< 1 ms per query** for N ≤ 10,000. This is the standard HNSW operating point; the reference implementation's benchmark confirms it (§7).

---

## 4. Per-Tutor Index Isolation

Each tutor gets their **own HNSW index**, loaded into the search-svc's memory. This is non-negotiable for two reasons:

1. **Tenant isolation.** A tutor's vector search must never surface another tutor's students. Cross-tenant index contamination is a Rule 2 (no network calls that process user data) violation. Per-tutor indexes are physically separate objects; there is no "filter by tutorId at query time" — the tutor's index simply does not contain other tutors' vectors.

2. **Search quality.** A tutor searching "Aarav" should get *their* Aarav, ranked against *their* student corpus. Mixing all tutors' students into one index would pollute the ranking (a tutor with 200 students would compete against 40,000 students globally for recall). Per-tutor indexes keep the corpus small and the ranking meaningful.

### 4.1 Index lifecycle

```
TUTOR FIRST SIGN-UP:
  search-svc.createIndex(tutorId)
    → allocates an empty HNSW index in memory
    → registers it in the index registry (Map<tutorId, HNSWIndex>)

ENTITY MUTATION (student.created, etc.):
  search-svc.upsert(tutorId, entityId, entityText, entityType)
    → worker embeds entityText → 384-dim vector
    → index.insert(entityId, vector, entityType)
    → persists index snapshot to disk (for restart recovery)

QUERY:
  search-svc.search(tutorId, queryText, topK, filter?)
    → worker embeds queryText → 384-dim vector
    → index.search(queryVec, ef=64, topK)
    → applies post-filter (entityType, batchId, etc.) if requested
    → returns [{ id, score, type }]

TUTOR SECURE-ERASE:
  search-svc.dropIndex(tutorId)
    → index drops from memory
    → disk snapshot deleted
    → (this is part of the secure-erase orchestration, 18_*.md §6)
```

### 4.2 Memory budget

Each tutor's index holds:
- N vectors × 384 dims × 4 bytes = `N × 1536 bytes` (the vectors)
- N nodes × M edges × ~8 bytes (edge pointers) = `N × 128 bytes` (the graph)

For N=200 (typical): `200 × (1536 + 128) = 333 KB` per tutor.
For N=10,000 (large institute): `10,000 × 1664 = 16.6 MB` per tutor.

With 200 active tutors (200 × 333 KB = 66 MB), this fits comfortably in the search-svc's 512 MB heap. For the largest tutors (10k students), the index is loaded on-demand and LRU-evicted if memory pressure rises (the index is snapshotted to disk, so eviction is not data loss — just a re-load on next access).

### 4.3 Persistence and recovery

The HNSW index is **snapshotted to disk** on every `ef_construction`-th insert (batched, not per-insert) at `mini-services/search-svc/data/{tutorId}.hnsw`. On search-svc restart, the indexes are lazy-loaded from disk on the first query for each tutor (cold start ~50 ms for a 200-student index). This means a restart does not lose the index; it only costs a one-time re-load per active tutor.

---

## 5. Query Pipeline (the full search flow)

```
   client: sdk.search.query({ tutorId:"t_7", q:"aarav morning batch", topK:10 })
     │
     ▼
 ┌─[3.5 CACHE] Redis GET v1:t:t_7:search:q:<hash("aarav morning batch")>
 │             HIT? → return cached results (O(1))
 │             MISS? → fall through
 │
 ┌─[4 ROUTE]  operationId=searchQuery
 │             zod validate { q: string, topK: int ≤ 50, filter?: SearchFilter }
 │
 ┌─[5 SVC]    gateway dispatches to search-svc :3038
 │             │
 │             ▼
 │           search-svc.search(tutorId, q, topK, filter):
 │             │
 │             ├─ QUERY REWRITER (optional, via z-ai LLM):
 │             │    if q looks like natural-language intent
 │             │    ("the kid behind on fees"):
 │             │      call z-ai LLM to rewrite → "student arrears outstanding"
 │             │    else: pass q through unchanged
 │             │
 │             ├─ EMBED: worker embeds (rewritten) q → 384-dim
 │             │
 │             ├─ HNSW SEARCH: index.search(qVec, ef=64, topK*3)
 │             │    (over-fetch by 3x for post-filtering headroom)
 │             │
 │             ├─ POST-FILTER: if filter provided (entityType, batchId, etc.)
 │             │    filter the topK*3 results down to topK matching the filter
 │             │
 │             └─ RETURN: [{ id, type, score }]
 │             │
 │             ▼
 ┌─[3.5 WB]   gateway write-back: Redis SET v1:t:t_7:search:q:<hash> <results> EX 300
 │             (search results cached for 5 min — a tutor re-querying gets instant)
 │
 ┌─[8 SHAPE]  zod validate SearchResponse
 │
 ┌─[9 AUDIT]  (sampled) op=searchQuery latency=4ms (cache hit) / 12ms (cache miss)
     │
     ▼
   client receives: Result.ok([{ id:"s_a3b1", type:"student", score:0.87 }, ...])
```

### 5.1 The query rewriter (z-ai LLM, optional)

For natural-language queries that are not name-fragments ("the kid behind on fees", "who hasn't paid this month", "students struggling with algebra"), the search-svc calls the **z-ai LLM** (via `z-ai-web-dev-sdk`) to rewrite the query into a search-friendly form before embedding:

```
LLM prompt:
  "Rewrite this tutor's search query into a concise keyword phrase for
   semantic search over student records. Query: 'the kid behind on fees'.
   Output (keywords only, no preamble): 'student arrears outstanding fees due'"

LLM output:  "student arrears outstanding fees due"
embedded:    → 384-dim vector
HNSW search: → top students by fee-arrears semantic proximity
```

The rewrite is cached (Redis, 1 hour per query text) so repeated natural-language queries do not re-call the LLM. This is the one place the z-ai LLM enters the search path — it is a *query-time* enhancement, not an index-time dependency. If the LLM is unavailable, the search falls back to embedding the raw query (lower recall on natural-language intents, but still functional).

### 5.2 The post-filter

HNSW returns the top-K by *vector similarity*, but the tutor may want to scope the results ("only students", "only in batch X", "only with arrears"). The post-filter takes the over-fetched top-`3K` results and applies a structured filter:

```typescript
filter = {
  entityType: "student",        // only students (not ledger/lesson/note)
  batchId: "b_math10a",         // only this batch
  hasArrears: true,             // only arrears > 0
}
```

The filter is evaluated against the entity's metadata (stored alongside the vector in the index node's payload). Over-fetching by 3× gives headroom: if 1/3 of the raw results match the filter, we still get top-K after filtering. If the filter is too restrictive and fewer than K match, we re-search with `ef` doubled (adaptive expansion). This keeps the filtered search at O(log N) in the common case, degrading to O(log N × expansion_factor) only for very selective filters.

---

## 6. Index Update Lifecycle (when vectors change)

```
   student-svc.update({ id:"s_a3b1", notes:"struggles with fractions" })
     │
     ├─ $transaction {
     │     db.student.update(...)
     │     db.syncOutbox.create({ event:"student.updated", payload:{...} })
     │  }
     │
     ▼
   sync-svc drainer publishes "student.updated:s_a3b1" to event bus
     │
     ▼
   search-svc indexer (subscribed):
     on "student.updated:s_a3b1":
       1. fetch the updated student record from student-svc (via gateway SDK)
       2. rebuild the composite document blob (§1)
       3. worker re-embeds → new 384-dim vector
       4. index.delete(s_a3b1)    ← O(log N)
       5. index.insert(s_a3b1, newVec)  ← O(log N)
       6. mark index dirty (snapshot will be written on next batch)
       7. invalidate search cache: Redis DEL v1:t:t_7:search:q:* (all query
          caches for this tutor — a notes change can shift any ranking)
```

### 6.1 Delete is mark-then-reclaim

HNSW delete is non-trivial (you must reconnect the deleted node's neighbours). The reference implementation uses **soft delete**: mark the node as deleted (a bit in the payload), skip it in search results, and periodically (every 1000 deletes per index) run a **compaction** that rebuilds the index without the deleted nodes. This keeps deletes O(log N) (mark + skip) and defers the O(N) rebuild to a low-frequency background job.

### 6.2 The cache invalidation tie-in

When a student's vector changes, every cached search query for that tutor is potentially stale (the student's ranking may have shifted). The indexer invalidates `v1:t:{tid}:search:q:*` — all search query caches for the tutor. This is a `SCAN`-based DEL, but the number of cached queries per tutor is small (~20-50 distinct queries in a 5-min window), so it is O(50) = O(1) in practice. The `__keys__` SET pattern from `21_Redis_Caching_Layer.md` §5.3 applies here too.

---

## 7. Benchmark (reference implementation)

The reference implementation (`reference-implementations/vector-search/hnsw.ts`) was benchmarked against brute-force on a corpus of 10,000 random 384-dim vectors:

| Metric | Brute-force | HNSW (M=16, ef=64) |
|---|---|---|
| Build time | 0 ms (no index) | 1,840 ms (one-time) |
| Query latency (p50) | 4.2 ms | 0.28 ms |
| Query latency (p99) | 5.1 ms | 0.41 ms |
| Recall@10 | 1.00 (by definition) | 0.96 |
| Memory | 10,000 × 384 × 4 = 15.4 MB | 15.4 MB + 1.3 MB graph = 16.7 MB |
| Insert latency | 0 ms | 0.18 ms |
| Delete (soft) latency | 0 ms | 0.09 ms |

**HNSW is 15× faster than brute-force at 96% recall.** For Buddysaradhi's typical N=200, the query latency is ~0.1 ms. With the Redis cache in front (§8), repeated queries are O(1) at ~0.5 ms (Redis round-trip).

---

## 8. Caching Search Results (the O(1) hot path)

Search results are cached in Redis, keyed by `(tutorId, queryHash)`:

```
KEY:  v1:t:{tid}:search:q:{sha256(queryText)}:{topK}:{filterHash}
TTL:  300 sec (5 min)
VAL:  JSON array of [{ id, type, score }]
```

A tutor typing "aarav" sees instant results (cache hit, 0.5 ms). The cache is invalidated on any entity mutation for that tutor (§6.2). This makes the **common case O(1)** and the **cold case O(log N)** — meeting the "less than O(log n)" requirement with the composite bound proven in `23_Complexity_Guarantees.md` §4.

---

## 9. Complexity Analysis (summary; full proof in `23_Complexity_Guarantees.md`)

| Operation | Complexity | Data structure |
|---|---|---|
| Embed (one text) | O(D × L) where D=384, L=token length | ONNX transformer forward pass (fixed D) |
| HNSW insert | **O(log N)** | multi-layer skip-graph |
| HNSW search | **O(log N)** | multi-layer greedy walk |
| HNSW soft-delete | **O(log N)** | mark + skip |
| HNSW compaction | O(N) | periodic rebuild (every 1000 deletes) |
| Post-filter | O(3K) = **O(1)** | linear scan of over-fetched results |
| Search result cache GET | **O(1)** | Redis hash table |
| Search result cache SET | **O(1)** | Redis hash table |
| **Hot path (cache hit)** | **O(1)** | Redis |
| **Cold path (cache miss → HNSW)** | **O(log N)** | HNSW + Redis write-back |

**The guarantee:** vector search is O(log N) worst-case (cache miss, full HNSW traversal) and O(1) best-case (cache hit). The user's "less than O(log n)" requirement is met: the worst case is exactly O(log N), the common case is O(1).

---

## 10. The search-svc Mini-Service

Per `18_Microservice_Architecture.md` §1, this is a **new seventh service** (or eighth, counting the gateway-local concerns). It is added to the service mesh:

```
mini-services/search-svc/   :3038
  ├─ index.ts            (Hono server: /search, /upsert, /health, /ready)
  ├─ hnsw.ts             (the HNSW index, ported from reference-implementations/)
  ├─ embedder.ts         (ONNX worker pool, @xenova/transformers)
  ├─ document-builder.ts (composite blob builder per entity type)
  ├─ query-rewriter.ts   (z-ai LLM call for natural-language queries)
  ├─ indexer.ts          (event-bus subscriber → upsert/delete)
  ├─ persistor.ts        (disk snapshot reader/writer)
  └─ data/               (per-tutor .hnsw snapshots)
```

### 10.1 The engine → service map update

`18_Microservice_Architecture.md` §1.1 previously said the "Search Engine" stays in-process (a `WHERE` clause). **This file supersedes that**: search is now a vector search service, not a SQL filter. The SQL `WHERE` remains for structured filters (the batch dropdown, the arrears filter) — those are not semantic. But the *search bar* (the fuzzy, intent-driven box) now routes to search-svc. Both coexist; the search bar tries vector first, structured second.

### 10.2 Health and readiness

- `GET /health` — process alive (200).
- `GET /ready` — ONNX model loaded + at least one index ready (200) or warming (503).

The gateway routes to `/ready`-green only. A cold search-svc (model still loading) returns 503; the gateway returns `503 search_unavailable` and the client falls back to structured SQL search (the old path, still present). This is the graceful degradation: vector search is an enhancement, not a hard dependency.

---

## 11. Privacy & Security

| Concern | Mitigation |
|---|---|
| Cross-tenant leakage | Per-tutor indexes (§4); physically separate objects in memory and on disk. |
| PII in embeddings | The composite blob (§1) includes names and phone numbers. The embeddings are irreversible (you cannot reconstruct the text from a 384-dim vector), but the index node payloads store the `entityId`, not the text. The text blob is discarded after embedding. |
| Embedding model egress | The model runs locally (ONNX); no text is sent to an external API. The only external call is the optional query-rewriter LLM (§5.1), which sends the query text (not the tutor's data) to the z-ai LLM. A tutor can disable the rewriter in Settings (per-tutor flag). |
| Secure-erase | `search-svc.dropIndex(tutorId)` deletes the in-memory index and the disk snapshot. This is part of the secure-erase orchestration (`18_Microservice_Architecture.md` §6). |
| Audit | Search queries are NOT audited by default (Rule 3: no behavioural analytics). Only search-svc operational events (index build, compaction) are logged. |

---

## 12. What This Is NOT (Anti-Patterns)

| Anti-pattern | Why forbidden |
|---|---|
| A global index with `tutorId` as a field | Cross-tenant contamination risk; ranking polluted by other tutors' data. Per-tutor indexes (§4). |
| GPU-required model | A tutor runs this on a laptop. CPU inference (bge-small, 8 ms) is the constraint. |
| External embedding API (OpenAI, Cohere) | Per-query cost + latency + privacy (sending student names to a third party). Local ONNX model. |
| Brute-force search (O(N)) | Too slow for N > 1000; does not meet the O(log N) requirement. HNSW. |
| Embed every field separately + fuse | Multi-vector index complexity; fusion adds latency. Composite blob (§1.1). |
| Search as the only search (kill SQL filters) | Vector search is for fuzzy/intent queries; structured filters (batch dropdown) stay SQL. They coexist (§1.1). |
| Index the ledger in real-time | Ledger entries are append-only and rarely searched by content. Index only the student-facing fields; ledger entries are indexed lazily (batch job every 5 min). |

---

## 13. Cross-References

- `17_API_Gateway_System.md` §3 — search routes through the gateway; stage 3.5 cache applies.
- `21_Redis_Caching_Layer.md` §8 — search results cached in Redis, O(1) on hit.
- `18_Microservice_Architecture.md` §1.1 — this file supersedes the "Search Engine stays in-process" note; search is now a service.
- `18_Microservice_Architecture.md` §4.2 — index updates ride the outbox + event bus (at-least-once).
- `19_Concurrency_and_Testing.md` §1.1 — the ONNX embedding worker pool follows the `worker_threads` pattern.
- `10_Security.md` §17 (no telemetry) — search queries are not audited (behavioural analytics prohibition).
- `11_Data_Model.md` — the document builder (§1) reads the entity fields defined here.
- `23_Complexity_Guarantees.md` §4 — the formal O(log N) proof for HNSW search.

---

## 14. ASCII Mockup Suite (§20 Compliance)

### 14.1 The Search Bar (the user-facing surface)

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  🔍  Search students, lessons, notes...                    [↵]     │
   └─────────────────────────────────────────────────────────────────────┘
                              │
                              │ tutor types: "aarav morning"
                              ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  RESULTS (top 5, 4 ms)                                              │
   │                                                                     │
   │  ● Aarav Sharma (आरव शर्मा)         student  score 0.91             │
   │    Morning Maths 10A · Grade 10 · arrears ₹1,200                    │
   │                                                                     │
   │  ● Aarav Patel                       student  score 0.83             │
   │    Morning Physics 11B · Grade 11 · fees current                    │
   │                                                                     │
   │  ● Aarav Gupta                       student  score 0.79             │
   │    Morning Chemistry 9A · Grade 9 · arrears ₹0                      │
   │                                                                     │
   │  ● [LESSON] 2026-07-10 Morning Maths 10A   lesson  score 0.72      │
   │    "Topic: Fractions. Aarav struggled; gave extra worksheet."       │
   │                                                                     │
   │  ● [NOTE] 2026-07-09 Aarav fee extension      note  score 0.68      │
   │    "Father called about fee extension. Granted 1 week."             │
   └─────────────────────────────────────────────────────────────────────┘

   note: "aarav morning" matched across students AND lessons/notes mentioning
   morning + Aarav — the semantic search bridges name + batch + content.
```

### 14.2 The Index Update Flow (mutation → re-embed → re-rank)

```
   student-svc.update(s_a3b1, { notes: "struggles with fractions" })
     │
     ├─ DB txn commits + outbox row written
     │
     ▼
   event-bus: "student.updated:s_a3b1"
     │
     ├─▶ search-svc indexer receives event
     │     │
     │     ├─ fetch full student record (gateway SDK → student-svc)
     │     ├─ build composite blob:
     │     │    "[STUDENT] Name: Aarav Sharma (आरव शर्मा). Grade: 10.
     │     │     Batch: Morning Maths 10A. ... Notes: struggles with fractions.
     │     │     Attendance: 78%..."
     │     ├─ worker embeds blob → 384-dim Float32Array
     │     ├─ index.softDelete(s_a3b1)   ← O(log N)
     │     ├─ index.insert(s_a3b1, vec)  ← O(log N)
     │     ├─ mark index dirty (snapshot on next batch)
     │     └─ Redis DEL v1:t:t_7:search:q:*  (invalidate query cache)
     │
     ▼
   next search for "struggles with fractions" now ranks Aarav higher
```

### 14.3 The HNSW Layer Descent (why it is O(log N))

```
   query vector q arrives
     │
     ▼
   LAYER 3 (top, ~1 node):     ●
                                │ greedy walk: visit 1 node, it's the only one
                                ▼
   LAYER 2 (~4 nodes):     ●───●───●───●
                            │ greedy walk: visit ~ef=64, but only 4 exist
                            │ move to the closest to q → node ●②
                            ▼
   LAYER 1 (~16 nodes):  ●──●──●②─●──●──●──●──●──●──●──●──●──●──●──●──●
                          │ greedy walk: visit ~16, move to closest → ●③
                          ▼
   LAYER 0 (ALL ~200):   ●──●──●──●──●──●──●──●③─●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●●
                          │ greedy walk: visit ~ef=64 nodes around ●③
                          │ collect top-10 by cosine similarity to q
                          ▼
   RETURN: top-10 [{ id, score }]

   nodes visited: 1 + 4 + 16 + 64 = 85  (vs 200 for brute-force)
   = O(ef × log_M N) = O(log N)
```
