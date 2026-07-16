// Implements: 22_Vector_Search_System.md §4-§5 — per-tutor search service.
//
// The `SearchService` ties together the HNSW index, the embedder, the
// post-filter, and the Redis query-result cache. It is the surface the
// gateway calls (`POST /api/v1/search`) — the web agent ports this class
// into `mini-services/search-svc/index.ts` (a Hono server).
//
// Per spec 22 §4, each tutor gets their OWN HNSW index, held in a
// `Map<tutorId, HNSWIndex>`. This is non-negotiable for tenant isolation
// (a tutor's search must never surface another tutor's students — physically
// separate objects, not a query-time filter) and for search quality (a tutor
// searches against *their* corpus, not the global one).
//
// Per spec 22 §5, the query flow is:
//   1. (cache) GET v1:t:{tid}:search:q:{hash} — O(1) on hit.
//   2. (rewrite) optional z-ai LLM call to rewrite natural-language queries.
//   3. (embed) embed the (rewritten) query → 384-dim.
//   4. (HNSW) index.search(queryVec, ef, topK * 3) — over-fetch 3× for filter headroom.
//   5. (post-filter) apply structured filter to the top-3K, return top-K.
//   6. (write-back) SET v1:t:{tid}:search:q:{hash} <results> EX 300.
//
// Per spec 22 §8, the cache makes the hot path O(1) and the cold path O(log N).

import type { HNSWIndex, SearchHit } from './hnsw.ts';
import { HNSWIndex as HNSWIndexClass } from './hnsw.ts';
import type { Embedder } from './embedder.ts';
import type { CacheAside } from '../redis-cache/cache-aside.ts';
import { buildKey } from '../redis-cache/key-builder.ts';

/**
 * A structured post-filter applied to the over-fetched top-3K HNSW results
 * (spec 22 §5.2). All fields optional; an absent field is a no-op.
 */
export interface SearchFilter {
  /** Restrict to one entity type ("student", "ledger", "lesson", "note"). */
  entityType?: string;
  /** Restrict to one batch (e.g. "b_math10a"). */
  batchId?: string;
  /** Restrict to students with arrears > 0. */
  hasArrears?: boolean;
  /** Restrict to entries on or after this date (ISO). */
  sinceDate?: string;
}

/**
 * One search result, returned to the caller. `score` is the cosine similarity
 * in [-1, 1] (higher is closer).
 */
export interface SearchResult extends SearchHit {
  type: string;
}

/**
 * A query-rewriter function. The reference impl is a no-op (returns the
 * query unchanged). The web agent replaces this with a call to the z-ai LLM
 * that turns natural-language intents ("the kid behind on fees") into
 * keyword phrases ("student arrears outstanding fees due") before embedding.
 *
 * Per spec 22 §5.1, the rewrite is *optional* and *cached* (1 hour per query
 * text). If the LLM is unavailable, search falls back to embedding the raw
 * query.
 */
export type QueryRewriter = (query: string) => Promise<string>;

/**
 * The default rewriter: no-op. Documented so the web agent knows where to
 * plug in the z-ai LLM.
 *
 * @complexity O(1).
 */
const noopRewriter: QueryRewriter = async (q) => q;

/**
 * A stable string hash (FNV-1a, 32-bit) for cache keys. We use a numeric
 * hash (not crypto-grade) because the cache key only needs to be stable
 * within one tutor's namespace, not collision-resistant across tutors.
 *
 * @complexity O(L) = O(1).
 */
function fnv1aHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * The search service. Holds one HNSW index per tutor; caches query results
 * in Redis; applies post-filters after over-fetching.
 *
 * Usage:
 *   const svc = new SearchService({ embedder, cache });
 *   svc.createIndex('t_7');
 *   await svc.upsert('t_7', 's_a3b1', studentBlob, { type: 'student', batchId: 'b_math10a', arrears: 1200 });
 *   const results = await svc.search('t_7', 'aarav morning', 10);
 */
export class SearchService {
  private readonly indexes = new Map<string, HNSWIndex>();
  private readonly embedder: Embedder;
  private readonly cache: CacheAside | null;
  private readonly queryRewriter: QueryRewriter;
  /** Per-tutor SET of cached query keys, for invalidation (spec 22 §6.2). */
  private readonly queryTags = new Map<string, Set<string>>();
  private readonly efSearch: number;

  constructor(opts: {
    embedder: Embedder;
    cache?: CacheAside | null;
    queryRewriter?: QueryRewriter;
    efSearch?: number;
  }) {
    this.embedder = opts.embedder;
    this.cache = opts.cache ?? null;
    this.queryRewriter = opts.queryRewriter ?? noopRewriter;
    this.efSearch = opts.efSearch ?? 64;
  }

  /**
   * Allocate an empty HNSW index for a tutor. Idempotent.
   *
   * @complexity O(1).
   */
  createIndex(tutorId: string): void {
    if (this.indexes.has(tutorId)) return;
    this.indexes.set(tutorId, new HNSWIndexClass({ ef_search: this.efSearch }));
    this.queryTags.set(tutorId, new Set());
  }

  /**
   * Drop a tutor's index (used by secure-erase, spec 22 §4.1). Frees memory
   * and deletes any cached query results.
   *
   * @complexity O(N) for the index drop (memory free), plus O(K) for cache
   *   invalidation. Both off the request path.
   */
  async dropIndex(tutorId: string): Promise<void> {
    this.indexes.delete(tutorId);
    if (this.cache) {
      const tag = buildKey({
        tutorId,
        domain: 'search',
        entity: 'q',
        subview: '__keys__',
      });
      await this.cache.invalidatePattern(tag);
    }
    this.queryTags.delete(tutorId);
  }

  /**
   * Insert (or update) an entity in a tutor's index. The `text` is the
   * composite document blob (from `document-builder.ts`); the `payload` is
   * stored alongside the vector and used by the post-filter.
   *
   * On update, the old vector is soft-deleted and a new one inserted (spec
   * 22 §6: delete + re-insert). Cached query results for this tutor are
   * invalidated (spec 22 §6.2).
   *
   * @complexity O(log N) for the HNSW insert + O(K) for the cache
   *   invalidation. Both bounded.
   */
  async upsert(
    tutorId: string,
    entityId: string,
    text: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: any,
  ): Promise<void> {
    let index = this.indexes.get(tutorId);
    if (index === undefined) {
      this.createIndex(tutorId);
      index = this.indexes.get(tutorId)!;
    }
    const vec = await this.embedder.embed(text);
    index.insert(entityId, vec, payload);
    // Invalidate cached query results for this tutor — any ranking may have
    // shifted (spec 22 §6.2).
    await this.invalidateQueryCache(tutorId);
  }

  /**
   * Soft-delete an entity from a tutor's index.
   *
   * @complexity O(log N).
   */
  async remove(tutorId: string, entityId: string): Promise<void> {
    const index = this.indexes.get(tutorId);
    if (index === undefined) return;
    index.softDelete(entityId);
    await this.invalidateQueryCache(tutorId);
  }

  /**
   * Search a tutor's index for the top-K entities matching `query`.
   *
   * Flow (spec 22 §5):
   *   1. Check the query-result cache (O(1) on hit).
   *   2. Rewrite the query (optional, via z-ai LLM in production).
   *   3. Embed the (rewritten) query (O(1), fixed D).
   *   4. HNSW search with over-fetch = 3×K (O(log N)).
   *   5. Post-filter the 3K results (O(K) = O(1) for bounded K).
   *   6. Write-back to cache (O(1)).
   *
   * @complexity O(1) on cache hit, O(log N) on cache miss.
   */
  async search(
    tutorId: string,
    query: string,
    topK: number,
    filter?: SearchFilter,
  ): Promise<SearchResult[]> {
    // Build the cache key: v1:t:{tid}:search:q:{hash}:{topK}:{filterHash}.
    const filterHash = filter ? fnv1aHash(JSON.stringify(filter)) : 'nofilter';
    const queryHash = fnv1aHash(query);
    const cacheKey = buildKey({
      tutorId,
      domain: 'search',
      entity: 'q',
      entityId: queryHash,
      params: [
        ['topK', topK],
        ['f', filterHash],
      ],
    });

    // 1. Cache check (O(1) on hit).
    if (this.cache !== null) {
      const cached = await this.cache.get<SearchResult[]>(
        cacheKey,
        async () => this.computeSearch(tutorId, query, topK, filter),
        300, // 5 min TTL per spec 22 §8.
      );
      // Tag the cache key for later invalidation.
      this.tagQueryKey(tutorId, cacheKey);
      return cached;
    }
    // No cache configured — compute directly.
    return this.computeSearch(tutorId, query, topK, filter);
  }

  /**
   * The uncached search computation. Public for testing; not part of the
   * gateway-facing API.
   *
   * @complexity O(log N).
   */
  async computeSearch(
    tutorId: string,
    query: string,
    topK: number,
    filter?: SearchFilter,
  ): Promise<SearchResult[]> {
    const index = this.indexes.get(tutorId);
    if (index === undefined) return [];

    // 2. Query rewrite (no-op in the reference impl).
    const rewritten = await this.queryRewriter(query);

    // 3. Embed (O(1)).
    const qv = await this.embedder.embed(rewritten);

    // 4. HNSW search with 3× over-fetch (spec 22 §5.2).
    const overFetch = Math.max(topK * 3, this.efSearch);
    const hits = index.search(qv, topK, overFetch);

    // 5. Post-filter (O(3K) = O(1) for bounded K).
    let results: SearchResult[] = hits.map((h) => ({
      ...h,
      type: (h.payload as { type?: string } | undefined)?.type ?? 'unknown',
    }));
    if (filter) {
      results = results.filter((r) => matchesFilter(r, filter));
    }
    return results.slice(0, topK);
  }

  /**
   * Invalidate all cached query results for a tutor (spec 22 §6.2).
   *
   * @complexity O(K) where K = cached queries for this tutor (~20-50).
   */
  private async invalidateQueryCache(tutorId: string): Promise<void> {
    if (this.cache === null) return;
    const tag = buildKey({
      tutorId,
      domain: 'search',
      entity: 'q',
      subview: '__keys__',
    });
    await this.cache.invalidatePattern(tag);
    this.queryTags.get(tutorId)?.clear();
  }

  /**
   * Track a cache key under the per-tutor query tag set, so a later
   * `invalidateQueryCache` can find and DEL it.
   *
   * @complexity O(1).
   */
  private tagQueryKey(tutorId: string, cacheKey: string): void {
    if (this.cache === null) return;
    const tag = buildKey({
      tutorId,
      domain: 'search',
      entity: 'q',
      subview: '__keys__',
    });
    void this.cache.tagKey(tag, cacheKey);
    this.queryTags.get(tutorId)?.add(cacheKey);
  }
}

/**
 * Apply a `SearchFilter` to a search result. Used by the post-filter step.
 *
 * @complexity O(1) (a fixed number of field checks).
 */
function matchesFilter(r: SearchResult, f: SearchFilter): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (r.payload ?? {}) as any;
  if (f.entityType !== undefined && r.type !== f.entityType) return false;
  if (f.batchId !== undefined && p.batchId !== f.batchId) return false;
  if (f.hasArrears === true && !(p.arrears > 0)) return false;
  if (f.hasArrears === false && p.arrears > 0) return false;
  if (f.sinceDate !== undefined && p.date !== undefined && p.date < f.sinceDate) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { Embedder } = await import('./embedder.ts');
  const { CacheAside } = await import('../redis-cache/cache-aside.ts');

  const embedder = new Embedder({ poolSize: 2 });
  const cache = new CacheAside({ forceInMemory: true });
  const svc = new SearchService({ embedder, cache });

  console.log('=== SearchService self-test ===');
  svc.createIndex('t_7');

  // Insert some documents.
  await svc.upsert('t_7', 's_a3b1', '[STUDENT] Name: Aarav Sharma. Batch: Morning Maths 10A. Notes: struggles with fractions.', { type: 'student', batchId: 'b_math10a', arrears: 1200 });
  await svc.upsert('t_7', 's_a3b2', '[STUDENT] Name: Aarav Patel. Batch: Morning Physics 11B. Notes: strong in algebra.', { type: 'student', batchId: 'b_phy11b', arrears: 0 });
  await svc.upsert('t_7', 's_a3b3', '[STUDENT] Name: Priya Gupta. Batch: Morning Maths 10A. Notes: struggles with fractions.', { type: 'student', batchId: 'b_math10a', arrears: 800 });
  await svc.upsert('t_7', 'l_1', '[LEDGER] Date: 2026-07-11. Student: Aarav Sharma. Type: fee_payment. Amount: ₹2500.', { type: 'ledger', date: '2026-07-11' });
  await svc.upsert('t_7', 'n_1', '[NOTE] 2026-07-09. Aarav fee extension granted.', { type: 'note', date: '2026-07-09' });

  // Search for "aarav" — should find both Aaravs + the lesson + note mentioning Aarav.
  console.log('\n--- search "aarav" ---');
  const r1 = await svc.search('t_7', 'aarav', 5);
  for (const r of r1) {
    console.log(`  ${r.id}  type=${r.type}  score=${r.score.toFixed(3)}`);
  }

  // Cached search — second call should hit the cache.
  console.log('\n--- second search "aarav" (cache hit) ---');
  const t0 = performance.now();
  const r2 = await svc.search('t_7', 'aarav', 5);
  const cachedMs = performance.now() - t0;
  console.log(`  ${r2.length} results in ${cachedMs.toFixed(3)} ms`);

  // Filtered search — only students in batch b_math10a.
  console.log('\n--- search "fractions" filtered to b_math10a ---');
  const r3 = await svc.search('t_7', 'fractions struggles', 5, { batchId: 'b_math10a' });
  for (const r of r3) {
    console.log(`  ${r.id}  type=${r.type}  score=${r.score.toFixed(3)}`);
  }

  // Filtered search — only students with arrears.
  console.log('\n--- search "aarav" filtered to hasArrears=true ---');
  const r4 = await svc.search('t_7', 'aarav', 5, { hasArrears: true, entityType: 'student' });
  for (const r of r4) {
    console.log(`  ${r.id}  type=${r.type}  score=${r.score.toFixed(3)}  arrears=${(r.payload as { arrears: number }).arrears}`);
  }

  // Update an entity — cache should be invalidated.
  console.log('\n--- update s_a3b1 (cache invalidates) ---');
  await svc.upsert('t_7', 's_a3b1', '[STUDENT] Name: Aarav Sharma. Batch: Morning Maths 10A. Notes: mastered fractions.', { type: 'student', batchId: 'b_math10a', arrears: 0 });
  const r5 = await svc.search('t_7', 'aarav', 5);
  console.log(`  ${r5.length} results after update`);

  // Cross-tutor isolation: t_8 has no index, search returns empty.
  console.log('\n--- cross-tutor isolation ---');
  const r6 = await svc.search('t_8', 'aarav', 5);
  console.log(`  t_8 search returned ${r6.length} results (expected 0)`);

  await embedder.dispose();
}
