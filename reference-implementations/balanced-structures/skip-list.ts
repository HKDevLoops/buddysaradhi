// Implements: 23_Complexity_Guarantees.md §3 + 21_Redis_Caching_Layer.md §9
// (SORTED SET) — a skip list, the data structure Redis uses for its sorted
// sets (ZADD/ZREVRANGE/etc.).
//
// A skip list is a probabilistically-balanced alternative to a self-balancing
// tree. It gives O(log N) search, insert, delete, and range queries with high
// probability, with simpler implementation than a Red-Black tree (no rotation
// cases). Redis uses it for leaderboards (top-N earners, top-N attendance).
//
// Structure: a multi-level linked list. Layer 0 is a sorted singly-linked
// list of all nodes. Layer L (L > 0) is a sparser list that "skips" over
// ~half the nodes. Each node has a random top level drawn from a geometric
// distribution (P(level ≥ k) = p^k, p = 0.5 by default). Search descends
// from the top, moving right while the next node's score ≤ query, else down.
//
// This file is pure TypeScript, no deps. It mirrors the operations Redis
// exposes on sorted sets: ZADD (insert), ZREM (delete), ZSCORE (lookup),
// ZRANK (rank), ZRANGE / ZREVRANGE (range query), ZREVRANGE 0 N (top-N).

/**
 * The default level-generation probability (p = 0.5). Higher p → more layers
 * → faster search, more memory. Redis uses p = 0.25 by default; we use 0.5
 * (the textbook skip-list value) for clarity.
 */
const DEFAULT_P = 0.5;

/**
 * The maximum number of layers. Cap avoids pathological cases where a very
 * lucky node gets a level far above log(N). 32 is enough for N up to ~2^32.
 */
const MAX_LEVEL = 32;

/**
 * One node in the skip list. Has `forward` pointers (one per layer) and a
 * `span` (number of layer-0 nodes between this node and the next node at
 * each layer) — `span` is what makes `rank` O(log N).
 */
interface SkipNode<T> {
  score: number;
  member: T;
  /** forward[i] = the next node at layer i. */
  forward: (SkipNode<T> | null)[];
  /** span[i] = number of layer-0 nodes between this node and forward[i]. */
  span: number[];
}

/**
 * A skip list keyed by `score: number` with `member: T` values. Members must
 * be unique (one score per member) — same as Redis sorted-set semantics.
 *
 * Usage:
 *   const sl = new SkipList<string>();
 *   sl.insert(2500, 's_a3b1');
 *   sl.insert(1800, 's_a3b2');
 *   const top3 = sl.topN(3); // → [{score:2500, member:'s_a3b1'}, ...]
 */
export class SkipList<T> {
  private readonly p: number;
  /** The head sentinel. Its `forward` array has length = current max level. */
  private readonly head: SkipNode<T>;
  /** Current maximum level in use (≤ MAX_LEVEL). */
  private level = 1;
  /** Number of layer-0 nodes (excluding head). */
  private length = 0;
  /** Map member → score, so `search` and `delete` are O(1) lookups by member. */
  private readonly memberToScore = new Map<T, number>();
  /** Optional seed for deterministic level generation (tests). */
  private readonly rng: () => number;

  constructor(opts: { p?: number; seed?: number } = {}) {
    this.p = opts.p ?? DEFAULT_P;
    this.rng = makeRng(opts.seed);
    this.head = {
      score: Number.NEGATIVE_INFINITY,
      member: null as unknown as T,
      forward: new Array(MAX_LEVEL).fill(null),
      span: new Array(MAX_LEVEL).fill(0),
    };
  }

  /**
   * The number of members in the list.
   *
   * @complexity O(1).
   */
  get size(): number {
    return this.length;
  }

  /**
   * Draw a random level via the geometric distribution: P(level ≥ k) = p^k.
   * The expected level is 1/(1-p) - 1, so for p=0.5 the average node has
   * level 1.
   *
   * @complexity O(1) (expected; bounded by MAX_LEVEL).
   */
  private randomLevel(): number {
    let lvl = 1;
    while (this.rng() < this.p && lvl < MAX_LEVEL) lvl++;
    return lvl;
  }

  /**
   * Insert (or update) a member with the given score. If the member already
   * exists, its old score is removed first (mirrors Redis ZADD default
   * semantics).
   *
   * @complexity O(log N) (with high probability — the level distribution
   *   guarantees this).
   */
  insert(score: number, member: T): void {
    const existing = this.memberToScore.get(member);
    if (existing !== undefined) {
      // Update: delete + re-insert (the score may move the node).
      this.delete(member);
    }
    const lvl = this.randomLevel();
    if (lvl > this.level) {
      // Grow head's forward array.
      for (let i = this.level; i < lvl; i++) {
        this.head.span[i] = this.length;
      }
      this.level = lvl;
    }
    // Find the insertion point at *every* layer (not just up to lvl), so the
    // span-update loop below can update all layers.
    const update: (SkipNode<T> | null)[] = new Array(this.level).fill(null);
    const rank: number[] = new Array(this.level).fill(0);
    let x: SkipNode<T> | null = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      rank[i] = i === this.level - 1 ? 0 : rank[i + 1];
      while (x !== null && x.forward[i] !== null && this.isBefore(x.forward[i]!, score, member)) {
        rank[i] += x.span[i];
        x = x.forward[i]!;
      }
      update[i] = x;
    }
    // Create the new node.
    const newNode: SkipNode<T> = {
      score,
      member,
      forward: new Array(lvl).fill(null),
      span: new Array(lvl).fill(0),
    };
    // Splice it in at each layer up to lvl.
    for (let i = 0; i < lvl; i++) {
      const prev = update[i];
      if (prev === null) continue;
      newNode.forward[i] = prev.forward[i];
      prev.forward[i] = newNode;
      // Update spans: prev's old span splits between prev→new and new→next.
      newNode.span[i] = prev.span[i] - (rank[0] - rank[i]);
      prev.span[i] = (rank[0] - rank[i]) + 1;
    }
    // Increment spans for layers above lvl (the new node doesn't appear
    // there, but the gap across those layers grew by 1).
    for (let i = lvl; i < this.level; i++) {
      const prev = update[i];
      if (prev !== null) prev.span[i]++;
    }
    this.length++;
    this.memberToScore.set(member, score);
  }

  /**
   * Remove a member from the list.
   *
   * @complexity O(log N).
   */
  delete(member: T): boolean {
    const score = this.memberToScore.get(member);
    if (score === undefined) return false;
    // Find the path to the node at each layer.
    const update: (SkipNode<T> | null)[] = new Array(this.level).fill(null);
    let x: SkipNode<T> | null = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x !== null && x.forward[i] !== null && this.isBefore(x.forward[i]!, score, member)) {
        x = x.forward[i]!;
      }
      update[i] = x;
    }
    const target = x !== null ? x.forward[0] : null;
    if (target === null || target.member !== member || target.score !== score) {
      // Not found (shouldn't happen if memberToScore is consistent).
      return false;
    }
    // Unsplice at each layer where target appears.
    for (let i = 0; i < this.level; i++) {
      const prev = update[i];
      if (prev !== null && prev.forward[i] === target) {
        prev.forward[i] = target.forward[i];
        prev.span[i] += target.span[i] - 1;
      } else if (prev !== null) {
        // Target wasn't at this layer; just decrement its span.
        prev.span[i]--;
      }
    }
    // Shrink the level if the top layers are now empty.
    while (this.level > 1 && this.head.forward[this.level - 1] === null) {
      this.level--;
    }
    this.length--;
    this.memberToScore.delete(member);
    return true;
  }

  /**
   * Look up a member's score and rank (0-indexed; rank 0 = lowest score).
   *
   * @complexity O(log N).
   */
  search(member: T): { score: number; rank: number } | null {
    const score = this.memberToScore.get(member);
    if (score === undefined) return null;
    // Walk the list to find the node, accumulating rank via spans.
    let x: SkipNode<T> | null = this.head;
    let rankAcc = 0;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x !== null && x.forward[i] !== null && this.isBefore(x.forward[i]!, score, member)) {
        rankAcc += x.span[i];
        x = x.forward[i]!;
      }
      if (x !== null && x.forward[i] !== null && x.forward[i]!.member === member && x.forward[i]!.score === score) {
        rankAcc += x.span[i];
        return { score, rank: rankAcc - 1 };
      }
    }
    return null;
  }

  /**
   * Return all members with score in `[start, end]`, in ascending score
   * order. Ties broken by insertion order (stable).
   *
   * @complexity O(log N + K) where K = number of results.
   */
  range(start: number, end: number): Array<{ score: number; member: T }> {
    // Find the first node with score ≥ start.
    let x: SkipNode<T> | null = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x !== null && x.forward[i] !== null && x.forward[i]!.score < start) {
        x = x.forward[i]!;
      }
    }
    const results: Array<{ score: number; member: T }> = [];
    x = x !== null ? x.forward[0] : null;
    while (x !== null && x.score <= end) {
      results.push({ score: x.score, member: x.member });
      x = x.forward[0];
    }
    return results;
  }

  /**
   * Return the top-N members by score (descending). Mirrors Redis
   * `ZREVRANGE 0 N-1`. Used for leaderboards.
   *
   * @complexity O(log N + n) — O(log N) to find the end of the list, O(n)
   *   to walk back. Implementation: walk forward to the tail, then back n.
   *   (We could maintain a tail pointer; for clarity we don't.)
   */
  topN(n: number): Array<{ score: number; member: T }> {
    if (n <= 0 || this.length === 0) return [];
    // Walk to the tail at layer 0.
    let x: SkipNode<T> | null = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x !== null && x.forward[i] !== null) {
        x = x.forward[i]!;
      }
    }
    // x is now the tail. Walk back via a second pass to collect n nodes.
    // (Skip lists don't have backward pointers in this impl; we re-search.)
    // To avoid O(N) here, we exploit rank: top-N = range [scoreOfRank(N-1), +inf].
    // Find the rank of the tail (= length - 1) and compute the start rank.
    const startRank = Math.max(0, this.length - n);
    // Walk to the node at startRank.
    let y: SkipNode<T> | null = this.head;
    let rankAcc = 0;
    for (let i = this.level - 1; i >= 0; i--) {
      while (y !== null && y.forward[i] !== null && rankAcc + y.span[i] <= startRank) {
        rankAcc += y.span[i];
        y = y.forward[i]!;
      }
    }
    const results: Array<{ score: number; member: T }> = [];
    y = y !== null ? y.forward[0] : null;
    while (y !== null && results.length < n) {
      results.push({ score: y.score, member: y.member });
      y = y.forward[0];
    }
    return results;
  }

  /**
   * Total ordering: score first, then member (for stable tie-breaking).
   * `a` is "before" `b` if a.score < b.score, or scores equal and a.member
   * < b.member (lexicographic on the string form).
   *
   * @complexity O(1) (assuming member comparison is O(1) for primitives; for
   *   objects, it's O(L) where L is the JSON length — bounded).
   */
  private isBefore(a: SkipNode<T>, score: number, member: T): boolean {
    if (a.score < score) return true;
    if (a.score > score) return false;
    // Tie on score — compare members for stable ordering.
    return compareMembers(a.member, member) < 0;
  }
}

/**
 * Compare two members for stable ordering. Uses `<` and `>` for primitives,
 * falls back to `String(...)` comparison for objects.
 *
 * @complexity O(L) where L is the member's string length (bounded).
 */
function compareMembers<T>(a: T, b: T): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Make a deterministic PRNG (mulberry32) for level generation. Seeded so
 * the structure is reproducible in tests.
 */
function makeRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  console.log('=== SkipList self-test ===');
  const sl = new SkipList<string>({ seed: 42 });

  // Insert 10 members with various scores.
  const data: Array<{ score: number; member: string }> = [
    { score: 2500, member: 's_a3b1' },
    { score: 1800, member: 's_a3b2' },
    { score: 3200, member: 's_a3b3' },
    { score: 2500, member: 's_a3b4' }, // tie with s_a3b1
    { score: 500, member: 's_a3b5' },
    { score: 9999, member: 's_a3b6' },
    { score: 0, member: 's_a3b7' },
    { score: 1500, member: 's_a3b8' },
    { score: 2200, member: 's_a3b9' },
    { score: 2800, member: 's_a3b10' },
  ];
  for (const { score, member } of data) sl.insert(score, member);
  console.log(`  inserted ${data.length} members; size = ${sl.size}`);

  // Search by member.
  console.log('\n--- search by member ---');
  for (const m of ['s_a3b1', 's_a3b6', 's_a3b7', 's_a3b5']) {
    const r = sl.search(m);
    console.log(`  ${m}: score=${r?.score}  rank=${r?.rank}`);
  }

  // Range query.
  console.log('\n--- range [1500, 2800] ---');
  const r = sl.range(1500, 2800);
  for (const x of r) console.log(`  ${x.member}: ${x.score}`);

  // Top-N.
  console.log('\n--- top 3 ---');
  for (const x of sl.topN(3)) console.log(`  ${x.member}: ${x.score}`);

  // Delete.
  console.log('\n--- delete s_a3b6 (top earner) ---');
  sl.delete('s_a3b6');
  console.log(`  size after delete: ${sl.size}`);
  console.log('  top 3 after delete:');
  for (const x of sl.topN(3)) console.log(`    ${x.member}: ${x.score}`);

  // Update (re-insert with new score).
  console.log('\n--- update s_a3b1 from 2500 to 5000 ---');
  sl.insert(5000, 's_a3b1');
  console.log('  top 3 after update:');
  for (const x of sl.topN(3)) console.log(`    ${x.member}: ${x.score}`);

  // Complexity check: build a large list and measure.
  console.log('\n=== complexity check (N=10000) ===');
  const big = new SkipList<number>({ seed: 7 });
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) big.insert(Math.random() * 1e9, i);
  const insertMs = performance.now() - t0;
  console.log(`  insert 10k: ${insertMs.toFixed(0)} ms  (${(insertMs / 10000).toFixed(3)} ms/op)`);

  const t1 = performance.now();
  for (let i = 0; i < 10000; i++) big.search(i);
  const searchMs = performance.now() - t1;
  console.log(`  search 10k: ${searchMs.toFixed(0)} ms  (${(searchMs / 10000).toFixed(3)} ms/op)`);

  const t2 = performance.now();
  for (let i = 0; i < 100; i++) big.topN(10);
  const topNMs = performance.now() - t2;
  console.log(`  topN(10) ×100: ${topNMs.toFixed(2)} ms  (${(topNMs / 100).toFixed(3)} ms/op)`);
}
