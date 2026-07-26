// Implements: 21_Redis_Caching_Layer.md §7 — Redis-backed token-bucket rate limiter.
//
// Per spec 21 §7, the rate-limit stage (stage 3 in the gateway pipeline) is
// Redis-backed so that the bucket is shared across all gateway workers. The
// implementation uses `INCR` + `EXPIRE`:
//
//   INCR   t:{tid}:rl:bucket:{minute}      ← O(1) atomic increment
//   EXPIRE t:{tid}:rl:bucket:{minute} 120  ← O(1) auto-cleanup after 2 min
//
// If the `INCR` result exceeds the limit, return 429. If Redis is unreachable
// (circuit open), a per-worker in-process Map fallback kicks in at a
// *conservative* lower limit (100 req/min vs the Redis 300 req/min default) —
// slower but correct, and avoids a Redis outage turning into a free-for-all.
//
// All operations are O(1).

import type { CircuitBreaker } from './circuit-breaker.js';
import type { RedisLike } from './cache-aside.js';

/**
 * Result of a rate-limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed through. */
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Seconds until the window resets (for the `Retry-After` header). */
  retryAfterSec: number;
  /** Whether the in-process fallback was used. */
  fallback: boolean;
}

/**
 * In-process fallback state for one tutor. We track the count and the minute
 * bucket it belongs to. When the minute rolls over, the counter resets.
 */
interface FallbackBucket {
  minute: number;
  count: number;
}

/**
 * Redis-backed token-bucket rate limiter.
 *
 * Usage:
 *   const limiter = new RateLimiter({ redis, breaker });
 *   const r = await limiter.check('t_7', 300, 60);
 *   if (!r.allowed) return new Response('rate limited', { status: 429 });
 */
export class RateLimiter {
  private readonly redis: RedisLike | null;
  private readonly breaker: CircuitBreaker | null;
  private readonly fallbacks = new Map<string, FallbackBucket>();
  /** Conservative per-worker limit when Redis is down. */
  private readonly fallbackLimit: number;

  constructor(opts: {
    redis?: RedisLike | null;
    breaker?: CircuitBreaker | null;
    /** Conservative limit for the in-process fallback. Default 100/min. */
    fallbackLimit?: number;
  }) {
    this.redis = opts.redis ?? null;
    this.breaker = opts.breaker ?? null;
    this.fallbackLimit = opts.fallbackLimit ?? 100;
  }

  /**
   * Check whether `tutorId` may make one more request within the given window.
   *
   * Implementation:
   *   1. Compute the bucket key: `v1:t:{tid}:rl:bucket:{floor(now / windowSec)}`.
   *   2. Under the circuit breaker: `INCR` the bucket; if the result is 1, set
   *      `EXPIRE` to `windowSec * 2` (so the key auto-cleans shortly after the
   *      window closes).
   *   3. If `INCR` > limit, return `{ allowed: false, ... }`.
   *   4. On `CircuitOpenError`, use the in-process fallback.
   *
   * @complexity O(1). Redis INCR/EXPIRE are O(1); the in-process fallback is a
   *   Map lookup + integer increment, also O(1).
   */
  async check(
    tutorId: string,
    limit: number,
    windowSec: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStartSec = Math.floor(now / 1000 / windowSec);
    const bucketKey = `v1:t:${tutorId}:rl:bucket:${windowStartSec}`;

    // If there's no Redis configured at all, go straight to fallback.
    if (this.redis === null || this.breaker === null) {
      return this.fallbackCheck(tutorId, limit, windowSec, now);
    }

    try {
      const count = await this.breaker.withCircuit(async () => {
        // INCR returns the post-increment value. ioredis exposes it as a number;
        // our RedisLike interface returns string | null from GET, but for INCR
        // we'll call a method we know the real client has. We model it as a
        // direct call below.
        const incr = (this.redis as unknown as {
          incr: (k: string) => Promise<number>;
          expire: (k: string, s: number) => Promise<number>;
        });
        const n = await incr.incr(bucketKey);
        if (n === 1) {
          // First request in this window — set the TTL so the key auto-cleans.
          await incr.expire(bucketKey, windowSec * 2);
        }
        return n;
      });

      const remaining = Math.max(0, limit - count);
      const retryAfterSec = windowSec - (Math.floor(now / 1000) % windowSec);
      return {
        allowed: count <= limit,
        remaining,
        retryAfterSec,
        fallback: false,
      };
    } catch {
      // Circuit open or Redis error — fail-open to the in-process fallback.
      return this.fallbackCheck(tutorId, this.fallbackLimit, windowSec, now);
    }
  }

  /**
   * In-process fallback. Per-worker, so a tutor hitting multiple workers gets
   * `fallbackLimit` per worker — that's why the fallback limit is conservative
   * (100 vs the Redis 300). The fallback uses a Map<tutorId, {minute, count}>.
   *
   * @complexity O(1) (Map lookup + integer increment).
   */
  private fallbackCheck(
    tutorId: string,
    limit: number,
    windowSec: number,
    now: number,
  ): RateLimitResult {
    const windowStartSec = Math.floor(now / 1000 / windowSec);
    let bucket = this.fallbacks.get(tutorId);
    if (bucket === undefined || bucket.minute !== windowStartSec) {
      bucket = { minute: windowStartSec, count: 0 };
      this.fallbacks.set(tutorId, bucket);
    }
    bucket.count++;
    const remaining = Math.max(0, limit - bucket.count);
    const retryAfterSec = windowSec - (Math.floor(now / 1000) % windowSec);
    return {
      allowed: bucket.count <= limit,
      remaining,
      retryAfterSec,
      fallback: true,
    };
  }

  /**
   * Clear the in-process fallback state (used in tests).
   *
   * @complexity O(1).
   */
  resetFallback(): void {
    this.fallbacks.clear();
  }
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`. Uses the in-process fallback.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  // No Redis, no breaker → straight to the in-process fallback.
  const limiter = new RateLimiter({});

  console.log('=== in-process fallback (limit 5 / 60s) ===');
  for (let i = 1; i <= 7; i++) {
    const r = await limiter.check('t_7', 5, 60);
    console.log(
      `  call ${i}: allowed=${r.allowed}  remaining=${r.remaining}  fallback=${r.fallback}`,
    );
  }

  console.log('\n=== second tutor is independent ===');
  const r2 = await limiter.check('t_8', 5, 60);
  console.log(
    `  t_8 call 1: allowed=${r2.allowed}  remaining=${r2.remaining}`,
  );

  console.log('\n=== with a mock Redis + CLOSED breaker ===');
  // Mock a Redis that counts via an internal Map.
  const mockStore = new Map<string, number>();
  const mockRedis: RedisLike = {
    get: async (k) => (mockStore.has(k) ? String(mockStore.get(k)) : null),
    set: async (k, v) => {
      mockStore.set(k, Number(v));
      return 'OK';
    },
    del: async (...keys) => {
      let n = 0;
      for (const k of keys) {
        if (mockStore.delete(k)) n++;
      }
      return n;
    },
    sadd: async () => 1,
    smembers: async () => [],
    ping: async () => 'PONG',
  };
  // Add the INCR/EXPIRE methods the limiter expects.
  (mockRedis as unknown as { incr: (k: string) => Promise<number> }).incr = async (k) => {
    const n = (mockStore.get(k) ?? 0) + 1;
    mockStore.set(k, n);
    return n;
  };
  (mockRedis as unknown as { expire: (k: string, s: number) => Promise<number> }).expire = async () => 1;

  const { CircuitBreaker } = await import('./circuit-breaker.ts');
  const breaker = new CircuitBreaker({ failureThreshold: 100, cooldownMs: 1000 });
  const limiter2 = new RateLimiter({ redis: mockRedis, breaker });

  for (let i = 1; i <= 4; i++) {
    const r = await limiter2.check('t_9', 3, 60);
    console.log(
      `  call ${i}: allowed=${r.allowed}  remaining=${r.remaining}  fallback=${r.fallback}`,
    );
  }
}
