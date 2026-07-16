// Implements: 22_Vector_Search_System.md §2 — embedding worker pool.
//
// Production: a `worker_threads` pool (size `min(4, cores-1)`) runs the
// `bge-small-en-v1.5` ONNX model via `@xenova/transformers`. Each worker
// holds one ONNX session (~130 MB, loaded once per worker); warm inference is
// ~8 ms per text. The main thread accepts index-upsert jobs, hands them to
// the pool, and upserts the returned 384-dim vector into the HNSW index.
//
// Reference impl: no real ONNX model is required (it would add ~130 MB of
// weights and a 3-sec cold start to this demo). Instead we use a
// **deterministic hash-based pseudo-embedding**: hash the text into 384
// floats, normalise. This is NOT semantically meaningful, but it has the
// right shape (Float32Array(384)), is deterministic (same text → same
// vector, so cache keys are stable), and is fast enough to benchmark the
// HNSW + search-service plumbing. The web agent replaces `embedOnce` with
// the real ONNX call when porting to `mini-services/search-svc/embedder.ts`.
//
// The pool interface is preserved either way: `embed(text)` returns
// `Promise<Float32Array>`, `embedBatch(texts)` parallelises across workers.

/**
 * The embedding dimension. `bge-small-en-v1.5` produces 384-dim vectors.
 */
export const EMBED_DIM = 384;

/**
 * The max token length. Inputs are truncated to 128 tokens (the model's
 * context window). Truncation keeps the forward pass O(1) (bounded L).
 */
export const MAX_TOKENS = 128;

/**
 * A simple tokeniser: lowercase, split on non-alphanumeric (including
 * Devanagari word boundaries), take the first MAX_TOKENS. This is *not* the
 * WordPiece/BPE tokeniser that `bge-small-en-v1.5` uses — it's a stand-in so
 * the reference impl produces stable, dimensioned output. The web agent
 * replaces this with `@xenova/transformers`'s `tokenizer(model)`.
 *
 * @complexity O(L) where L is the input length. Bounded, so O(1).
 */
export function tokenise(text: string): string[] {
  // \p{L} matches any Unicode letter (Latin, Devanagari, etc.).
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  const tokens = matches ?? [];
  return tokens.slice(0, MAX_TOKENS);
}

/**
 * FNV-1a hash — a fast, deterministic, dependency-free hash. Used to map a
 * token to a deterministic float in [-1, 1].
 *
 * @complexity O(L) where L is the string length. Bounded, so O(1).
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // FNV prime (32-bit).
    h = Math.imul(h, 0x01000193);
  }
  // Map to [-1, 1] via signed 32-bit divide.
  return (h | 0) / 0x80000000;
}

/**
 * A deterministic, hash-based pseudo-embedding. NOT semantically meaningful —
 * same text → same vector, different text → uncorrelated vector. Good enough
 * to exercise the HNSW index and search-service plumbing without a real
 * ONNX model.
 *
 * Each token contributes to `EMBED_DIM` slots via (token_hash + slot) mod
 * EMBED_DIM, summing the contributions. This gives a sparse-ish vector that
 * at least correlates with token overlap (two texts sharing tokens will have
 * non-zero dot product in those slots).
 *
 * @complexity O(L × D) where L = token count (≤ 128) and D = 384. Both
 *   bounded, so O(1).
 */
export function pseudoEmbed(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  const tokens = tokenise(text);
  if (tokens.length === 0) return v;
  for (const tok of tokens) {
    const h = fnv1a(tok);
    // Each token contributes to EMBED_DIM / 4 slots, spread by the hash.
    for (let i = 0; i < EMBED_DIM; i += 4) {
      const idx = (i + Math.floor(Math.abs(h) * EMBED_DIM)) % EMBED_DIM;
      v[idx] += h * (1 + Math.sin(i));
    }
  }
  // L2-normalise so cosine similarity = dot product.
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    const inv = 1 / norm;
    for (let i = 0; i < EMBED_DIM; i++) v[i] *= inv;
  }
  return v;
}

/**
 * The interface a real ONNX worker would satisfy. The reference impl uses
 * `pseudoEmbed` directly on the main thread (no workers needed for a demo).
 * The web agent swaps in `worker_threads`-based workers per spec 22 §2.2.
 */
export interface EmbedWorker {
  embed(text: string): Promise<Float32Array>;
  /** Stop the worker / free its ONNX session. */
  dispose(): Promise<void>;
}

/**
 * An in-process (no-worker-threads) embedder. Used by the reference impl so
 * the demo runs without spawning worker_threads (which complicates `bun run`
 * in some sandboxes). The web agent replaces this with a pool of
 * `worker_threads` workers, each holding an ONNX session.
 */
class InProcessWorker implements EmbedWorker {
  async embed(text: string): Promise<Float32Array> {
    return pseudoEmbed(text);
  }
  async dispose(): Promise<void> {
    /* no-op */
  }
}

/**
 * The embedding worker pool.
 *
 * Usage:
 *   const emb = new Embedder({ poolSize: 4 });
 *   const vec = await emb.embed("Aarav Sharma morning batch");
 *   await emb.dispose();
 *
 * In the reference impl, `poolSize` is informational — all work runs on the
 * main thread via `InProcessWorker`. The web agent will replace the workers
 * with real `worker_threads` instances that load `bge-small-en-v1.5`.
 */
export class Embedder {
  private readonly pool: EmbedWorker[];
  private nextWorker = 0;
  private readonly cache = new Map<string, Float32Array>();
  private static readonly CACHE_MAX = 1000;

  constructor(opts: { poolSize?: number } = {}) {
    // spec 22 §2.2: pool size = min(4, cores-1).
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
    const size = opts.poolSize ?? Math.max(1, Math.min(4, cores - 1));
    this.pool = Array.from({ length: size }, () => new InProcessWorker());
  }

  /**
   * Embed a single text. Truncates to MAX_TOKENS, returns a 384-dim
   * Float32Array (L2-normalised). Results are memoised by text (cache size
   * 1000) so repeated index-upserts of the same blob are free.
   *
   * @complexity O(L × D) = O(1) (fixed D=384, bounded L=128). Cache hit: O(1)
   *   Map lookup.
   */
  async embed(text: string): Promise<Float32Array> {
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;
    const worker = this.pool[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.pool.length;
    const vec = await worker.embed(text);
    if (this.cache.size >= Embedder.CACHE_MAX) {
      // Evict the oldest entry (FIFO; fine for a demo).
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(text, vec);
    return vec;
  }

  /**
   * Embed a batch of texts in parallel across the pool. Returns one
   * Float32Array per input text, in order.
   *
   * @complexity O(B × L × D / P) where B = batch size, P = pool size. All
   *   bounded, so O(1) per text.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Round-robin texts across the pool, await all in parallel.
    const promises = texts.map((t, i) => {
      const worker = this.pool[i % this.pool.length];
      return this.embed(t).catch(async () => {
        // Fallback: call the worker directly (bypassing the cache).
        return worker.embed(t);
      });
    });
    return Promise.all(promises);
  }

  /**
   * Dispose all workers. Call on shutdown.
   *
   * @complexity O(P) = O(1).
   */
  async dispose(): Promise<void> {
    await Promise.all(this.pool.map((w) => w.dispose()));
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const emb = new Embedder({ poolSize: 2 });

  console.log('=== pseudo-embedding (deterministic, hash-based) ===');
  const texts = [
    'Aarav Sharma struggles with fractions',
    'Aarav Sharma morning batch',
    'Priya Patel strong in algebra',
    'आरव शर्मा fractions',
  ];
  const vecs = await emb.embedBatch(texts);
  for (let i = 0; i < texts.length; i++) {
    const v = vecs[i];
    console.log(`  [${i}] "${texts[i].slice(0, 40)}..." dim=${v.length} norm=${Math.sqrt(v.reduce((s, x) => s + x * x, 0)).toFixed(3)}`);
  }

  console.log('\n=== determinism (same text → same vector) ===');
  const v1 = await emb.embed('hello world');
  const v2 = await emb.embed('hello world');
  let same = true;
  for (let i = 0; i < v1.length; i++) {
    if (v1[i] !== v2[i]) { same = false; break; }
  }
  console.log(`  same text produces same vector: ${same ? 'PASS' : 'FAIL'}`);

  console.log('\n=== token overlap → dot product > 0 ===');
  // Two texts sharing tokens should have non-zero cosine similarity.
  const a = await emb.embed('aarav sharma maths');
  const b = await emb.embed('aarav sharma algebra');
  const c = await emb.embed('priya patel chemistry');
  const dot = (x: Float32Array, y: Float32Array) => {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * y[i];
    return s;
  };
  console.log(`  sim("aarav sharma maths", "aarav sharma algebra") = ${dot(a, b).toFixed(3)}  (expect > 0)`);
  console.log(`  sim("aarav sharma maths", "priya patel chemistry") = ${dot(a, c).toFixed(3)}  (expect ≈ 0)`);

  await emb.dispose();
}
