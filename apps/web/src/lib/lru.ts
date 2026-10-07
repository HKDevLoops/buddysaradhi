// Implements: docs/plans/TABS-HARDEN-01.md Phase 2 (singleton safety — bound
// every module-level cache) + AGENTS.md §2 Rule 9 (bounded state must REPORT
// its own bound, never grow silently).
//
// WHY THIS FILE EXISTS (reuse over duplication — Ponytail rung 2). Two
// modules in `apps/web` need the identical primitive: `lib/db.ts` (two
// client/proxy caches) and `lib/offline-queue.ts` (the in-memory per-tenant
// fallback). Both need the same three properties and neither can afford its
// own copy:
//   1. a hard entry ceiling,
//   2. LRU (not FIFO) eviction, so the tenants serving live traffic are the
//      ones that survive, and
//   3. an eviction hook, so the owner can cascade (drop the ORM proxy that
//      wraps an evicted DB handle) or surface the loss (Rule 9).
//
// WHY A `Map` AND NOT THE GATEWAY'S LINKED LIST. `apps/gateway/lib/cache.ts`
// hand-rolls a doubly-linked list because its nodes carry mutable response
// fields that must survive a `moveToFront`. A `Map` already has the property
// that linked list exists to provide: iteration order IS insertion order, and
// `delete` + `set` moves a key to the newest position in O(1). Re-inserting on
// read is therefore a *simpler and exactly equivalent* LRU — the native
// primitive (Ponytail rung 4) instead of a hand-rolled structure (rung 5).
// The gateway keeps its list because its payload needs the indirection; this
// one does not, so copying it would be 40 lines of duplicated invariant for
// nothing.

/** Notified after an entry leaves the cache, with the key and the value. */
export type EvictListener<K, V> = (key: K, value: V) => void;

/**
 * A `Map` with a hard ceiling and true LRU eviction.
 *
 * Every method is synchronous and total: `get` on a miss returns `undefined`
 * and `set` on a full cache evicts exactly one entry before inserting. There is
 * no partially-applied state in which the cache can exceed `max`.
 */
export class BoundedCache<K, V> {
  /** Insertion-ordered: index 0 is the LEAST recently used entry. */
  private readonly entries = new Map<K, V>();

  private readonly onEvict: EvictListener<K, V> | undefined;

  /** Hard ceiling. A `max` below 1 is rejected rather than silently clamped. */
  readonly max: number;

  constructor(max: number, onEvict?: EvictListener<K, V>) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`BoundedCache: max must be an integer >= 1, received ${String(max)}`);
    }
    this.max = max;
    this.onEvict = onEvict;
  }

  /** Current entry count. Always `<= max` — this is the bound tests assert. */
  get size(): number {
    return this.entries.size;
  }

  /** Reads a key and promotes it to most-recently-used. */
  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    this.entries.delete(key);
    // SAFETY: `has(key)` returned true, so `get` returned the stored value
    // rather than a miss. Re-inserting after delete is what promotes the entry
    // to most-recently-used — `Map` iteration order IS insertion order.
    this.entries.set(key, value as V);
    return value;
  }

  /** Reads a key WITHOUT promoting it (for assertions and diagnostics). */
  peek(key: K): V | undefined {
    return this.entries.get(key);
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Keys ordered least- to most-recently used. */
  keys(): K[] {
    return [...this.entries.keys()];
  }

  /**
   * Inserts or refreshes a key, evicting the least-recently-used entry first
   * if the cache is at its ceiling. Eviction runs BEFORE insertion so the
   * cache is never transiently over `max`.
   */
  set(key: K, value: V): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
      this.entries.set(key, value);
      return;
    }
    while (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const evictedKey = oldest.value;
      const evictedValue = this.entries.get(evictedKey) as V;
      this.entries.delete(evictedKey);
      this.onEvict?.(evictedKey, evictedValue);
    }
    this.entries.set(key, value);
  }

  /** Removes one key and runs the eviction hook. Returns the removed value. */
  delete(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.onEvict?.(key, value);
    return value;
  }

  /** Empties the cache, running the hook per entry (sign-out hygiene). */
  clear(): void {
    for (const [key, value] of [...this.entries]) {
      this.entries.delete(key);
      this.onEvict?.(key, value);
    }
  }
}
