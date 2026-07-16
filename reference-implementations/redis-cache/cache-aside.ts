// Implements: 21_Redis_Caching_Layer.md §2 (cache-aside) + §5.3 (key-tag invalidation).
//
// The cache-aside pattern:
//   1. GET <key> from Redis.
//   2. On HIT: parse JSON, return.
//   3. On MISS: call the loader, SET the result with a TTL, return.
//
// On invalidation: a single key DEL is O(1). A pattern DEL uses the key-tag SET
// pattern (§5.3): SMEMBERS the SET, DEL each listed key, DEL the SET itself.
// This is O(K) where K is the SET cardinality (bounded ~10-50), NOT O(N) SCAN.
//
// This file uses `ioredis` when a Redis URL is configured. If Redis is
// unreachable (or no URL is set), it transparently falls back to an in-memory
// `Map` so the reference impl runs without `redis-server`. The web agent should
// delete the in-memory fallback when porting to `src/lib/cache/cache-aside.ts`.

import type Redis from 'ioredis';

/**
 * A minimal Redis-like interface. `ioredis` satisfies this; so does the in-memory
 * fallback. Keeping the surface narrow makes the cache-aside testable without a
 * real Redis and lets us mock it in unit tests.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: 'EX', ttl?: number): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  ping(): Promise<string>;
}

/**
 * In-memory Redis fallback. Implements exactly the subset of Redis commands that
 * `CacheAside` uses. Uses `Map` for O(1) GET/SET/DEL and `Set` for O(1) SADD/
 * SMEMBERS. TTLs are tracked with `setTimeout` — fine for a demo, not for prod
 * (the web agent replaces this with a real `ioredis` client).
 *
 * All operations are O(1) (or O(K) for SMEMBERS, K = set size).
 */
class InMemoryRedis implements RedisLike {
  private readonly store = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  async set(
    key: string,
    value: string,
    mode?: 'EX',
    ttl?: number,
  ): Promise<string | null> {
    this.store.set(key, value);
    if (mode === 'EX' && typeof ttl === 'number') {
      // Clear any prior TTL timer, set a fresh one.
      const prev = this.timers.get(key);
      if (prev !== undefined) clearTimeout(prev);
      const t = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl * 1000);
      // Allow the process to exit even if a timer is pending.
      if (typeof t === 'object' && 'unref' in t) t.unref();
      this.timers.set(key, t);
    }
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const k of keys) {
      if (this.store.delete(k)) deleted++;
      // DEL also clears SET keys (in Redis, `DEL` works on any type).
      if (this.sets.delete(k)) deleted++;
      const t = this.timers.get(k);
      if (t !== undefined) {
        clearTimeout(t);
        this.timers.delete(k);
      }
    }
    return deleted;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.sets.get(key);
    if (set === undefined) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async ping(): Promise<string> {
    return 'PONG';
  }
}

/**
 * Try to construct a real `ioredis` client. Returns `null` if the package is
 * missing or the connection fails — the caller falls back to in-memory.
 *
 * The import is `await import('ioredis')` (dynamic) so this file still parses
 * and runs in environments without `ioredis` installed.
 */
async function tryConnectRedis(url: string | undefined): Promise<RedisLike | null> {
  if (!url) return null;
  try {
    const mod = (await import('ioredis')) as unknown as {
      default: new (url: string, opts?: Record<string, unknown>) => Redis;
    };
    const client = new mod.default(url, {
      // spec 21 §10 — connection-pool and timeout knobs.
      connectTimeout: 2000,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      lazyConnect: false,
    });
    await client.ping();
    return client as unknown as RedisLike;
  } catch {
    return null;
  }
}

/**
 * Options for constructing a `CacheAside`.
 */
export interface CacheAsideOptions {
  /** Redis URL. If unset or unreachable, falls back to in-memory. */
  redisUrl?: string;
  /** Force the in-memory fallback (for tests / demos). */
  forceInMemory?: boolean;
  /** Optional logger; defaults to a no-op. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}

/**
 * The cache-aside pattern (spec 21 §2) with the key-tag invalidation pattern
 * (§5.3). All operations are O(1) or O(K) with K bounded.
 *
 * Usage:
 *   const cache = new CacheAside({ redisUrl: process.env.REDIS_URL });
 *   const student = await cache.get(key, () => fetchStudentFromDb(id), 600);
 */
export class CacheAside {
  /**
   * The active Redis-like backend. Swapped from in-memory → real `ioredis`
   * client after the async connection attempt resolves.
   */
  private redis: RedisLike;
  private readonly log: NonNullable<CacheAsideOptions['log']>;
  /** True while we're using the in-memory fallback (no live Redis). */
  usingInMemory: boolean;

  constructor(opts: CacheAsideOptions = {}) {
    this.log = opts.log ?? (() => undefined);
    // We resolve the Redis client synchronously by stashing a promise; the
    // first call to `get`/`invalidate` will await it. This avoids making the
    // constructor async.
    if (opts.forceInMemory) {
      this.redis = new InMemoryRedis();
      this.usingInMemory = true;
    } else {
      // Eagerly kick off the connection attempt.
      this.redisPromise = tryConnectRedis(opts.redisUrl);
      // Temporary stand-in; replaced when `init()` resolves.
      this.redis = new InMemoryRedis();
      this.usingInMemory = true;
      void this.init();
    }
  }

  private readonly redisPromise?: Promise<RedisLike | null>;
  private initialised = false;

  private async init(): Promise<void> {
    if (this.initialised) return;
    if (!this.redisPromise) {
      this.initialised = true;
      return;
    }
    const real = await this.redisPromise;
    if (real !== null) {
      // Swap in the real client. The in-memory contents are discarded (they
      // were never authoritative — only the Redis server is).
      this.redis = real;
      this.usingInMemory = false;
      this.log('info', 'cache-aside: connected to Redis');
    } else {
      this.log('warn', 'cache-aside: Redis unreachable, using in-memory fallback');
    }
    this.initialised = true;
  }

  /**
   * Cache-aside read. GET from Redis; on hit, parse and return. On miss, call
   * the loader, SET with the TTL, return. Failures (Redis down) degrade to
   * "always miss" — the loader runs every time, but the request still succeeds.
   *
   * @complexity O(1) on hit (Redis hash-table GET + bounded JSON.parse).
   *   O(1) for the Redis GET on miss + the loader's own complexity (typically
   *   O(log N) for a DB indexed lookup). The composite bound is the loader's.
   */
  async get<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSec: number,
  ): Promise<T> {
    await this.init();
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }
    } catch (e) {
      this.log('warn', 'cache-aside: GET failed, falling through to loader', {
        key,
        err: (e as Error).message,
      });
    }
    // Miss (or Redis error): call the loader.
    const value = await loader();
    // Write back. Failure is non-fatal — the next read will simply miss again.
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (e) {
      this.log('warn', 'cache-aside: SET failed', {
        key,
        err: (e as Error).message,
      });
    }
    return value;
  }

  /**
   * Direct SET (used by write-through paths like the ledger balance, §4.1).
   *
   * @complexity O(1) (Redis hash-table SET + bounded JSON.stringify).
   */
  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    await this.init();
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (e) {
      this.log('warn', 'cache-aside: SET failed', {
        key,
        err: (e as Error).message,
      });
    }
  }

  /**
   * Invalidate a single key. Idempotent — DEL on a non-existent key is a no-op.
   *
   * @complexity O(1) (Redis hash-table DEL).
   */
  async invalidate(key: string): Promise<void> {
    await this.init();
    try {
      await this.redis.del(key);
    } catch (e) {
      this.log('warn', 'cache-aside: DEL failed', {
        key,
        err: (e as Error).message,
      });
    }
  }

  /**
   * Invalidate every key listed in a key-tag SET, then DEL the SET itself.
   *
   * This is the O(K)-not-O(N) replacement for `SCAN`-based invalidation (§5.3):
   *   SMEMBERS <tagSetKey>     → O(K) where K = cached pages (~10-50)
   *   DEL <each member>        → O(K) total (K bounded Redis hash-table DELs)
   *   DEL <tagSetKey>          → O(1)
   *
   * Returns the number of keys deleted (excluding the tag set itself).
   *
   * @complexity O(K) where K = |tagSetKey|. K is bounded (~10-50), so O(1) in
   *   practice.
   */
  async invalidatePattern(tagSetKey: string): Promise<number> {
    await this.init();
    let members: string[];
    try {
      members = await this.redis.smembers(tagSetKey);
    } catch (e) {
      this.log('warn', 'cache-aside: SMEMBERS failed', {
        tagSetKey,
        err: (e as Error).message,
      });
      return 0;
    }
    if (members.length === 0) {
      // Still DEL the (possibly stale) tag set itself.
      try {
        await this.redis.del(tagSetKey);
      } catch {
        /* ignore */
      }
      return 0;
    }
    let deleted = 0;
    try {
      // ioredis DEL accepts variadic keys; the in-memory impl loops internally.
      deleted = await this.redis.del(...members);
    } catch (e) {
      this.log('warn', 'cache-aside: bulk DEL failed, falling back to per-key', {
        tagSetKey,
        err: (e as Error).message,
      });
      for (const m of members) {
        try {
          deleted += await this.redis.del(m);
        } catch {
          /* ignore */
        }
      }
    }
    // Clean up the tag set itself.
    try {
      await this.redis.del(tagSetKey);
    } catch {
      /* ignore */
    }
    this.log('info', 'cache-aside: invalidated pattern', {
      tagSetKey,
      keysDeleted: deleted,
    });
    return deleted;
  }

  /**
   * Register a key under a tag set. Called by the cache-aside write path so the
   * invalidator can find every key that belongs to a group.
   *
   * @complexity O(1) (Redis SADD).
   */
  async tagKey(tagSetKey: string, memberKey: string): Promise<void> {
    await this.init();
    try {
      await this.redis.sadd(tagSetKey, memberKey);
    } catch (e) {
      this.log('warn', 'cache-aside: SADD failed', {
        tagSetKey,
        memberKey,
        err: (e as Error).message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`. Uses the in-memory fallback.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const cache = new CacheAside({ forceInMemory: true });

  let loaderCalls = 0;
  const expensiveLoader = async (id: string): Promise<{ id: string; name: string }> => {
    loaderCalls++;
    // Simulate a DB round-trip.
    await new Promise((r) => setTimeout(r, 5));
    return { id, name: `student-${id}` };
  };

  const run = async () => {
    const key = 'v1:t:t_7:student:rec:s_a3b1';

    // First call: miss → loader runs.
    const t0 = Date.now();
    const r1 = await cache.get(key, () => expensiveLoader('s_a3b1'), 60);
    const missMs = Date.now() - t0;
    console.log(
      `miss  → ${JSON.stringify(r1)}  loaderCalls=${loaderCalls}  ${missMs}ms`,
    );

    // Second call: hit → loader does NOT run.
    const t1 = Date.now();
    const r2 = await cache.get(key, () => expensiveLoader('s_a3b1'), 60);
    const hitMs = Date.now() - t1;
    console.log(
      `hit   → ${JSON.stringify(r2)}  loaderCalls=${loaderCalls}  ${hitMs}ms`,
    );

    // Tag the key under a group, then invalidate the group.
    const tagSet = 'v1:t:t_7:students:list:__keys__';
    // SET the list-page keys first (so DEL has something to delete).
    await cache.set('v1:t:t_7:students:list:page:1:sort:name', [{ id: 's_1' }], 60);
    await cache.set('v1:t:t_7:students:list:page:2:sort:name', [{ id: 's_2' }], 60);
    await cache.tagKey(tagSet, 'v1:t:t_7:students:list:page:1:sort:name');
    await cache.tagKey(tagSet, 'v1:t:t_7:students:list:page:2:sort:name');
    const n = await cache.invalidatePattern(tagSet);
    console.log(`invalidatePattern → ${n} keys deleted`);

    // After invalidation, the next call is a miss again.
    await cache.invalidate(key);
    const t2 = Date.now();
    await cache.get(key, () => expensiveLoader('s_a3b1'), 60);
    console.log(
      `post-invalidate → loaderCalls=${loaderCalls}  ${Date.now() - t2}ms`,
    );
  };

  await run();
}
