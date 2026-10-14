// Implements: web/04_API_Routes.md §2 (in-memory token bucket per IP: 60/min
// reads, 10/min writes; 429 with `Retry-After`) + §9 `RATE_LIMITED`.
//
// This is the module §2 names (`src/server/rate-limit.ts`) and sketches. It
// did not exist — only the password-reset throttle (`auth-rate-limit.ts`,
// 10_Security.md §11) did — so unauthenticated `/api/v1/*` storms answered
// 200 forever with no `429`/`Retry-After`/`RateLimit*` header (black-box
// probe finding 7). The edge wires it in `src/proxy.ts` for `/api/v1/*`.
//
// Behaviour contract (== the §2 sketch, kept branch-for-branch):
//   - bucket per `${ip}|${kind}`, capacity 60 reads / 10 writes per 60s;
//   - refill is linear at cap/60 tokens per second; consuming the last token
//     is allowed, the next request inside the window is refused;
//   - refusal carries `retryAfterSeconds = ceil((1 - tokens) / refillRate)`.
// Two deliberate deviations from the sketch, both documented:
//   - `nowMs` is injectable (defaults to `Date.now()`): without it the bucket
//     is untestable except by sleeping, and an untestable limiter is theatre.
//   - the decision also reports `limit`/`remaining`/`resetAfterSeconds` so the
//     edge can emit the `RateLimit-Limit/Remaining/Reset` trio (the probe
//     asked for `RateLimit*` headers; §2 only mandates `Retry-After`).
// `resetAfterSeconds` is the time to a FULL bucket — the honest meaning of
// "reset" for a continuously-refilling bucket.
//
// Edge-safe by construction: no imports, no Node APIs, `Date.now()` only.
// On Vercel the Map is per-instance and approximate — §2 states this openly;
// DDoS protection stays with the edge firewall. `resetApiRateLimits` and
// `apiRateLimitBucketCount` are test-only (same pattern as
// `resetAuthRateLimits`).
//
// MEMORY CEILING (Rule 2 posture: one instance serves every tutor behind it, so
// the limiter must not be the thing that runs it out). `buckets` is capped at
// `MAX_BUCKETS` with UNCONDITIONAL least-recently-used eviction. It previously
// pruned only buckets that had refilled to cap, which an attacker defeats with
// one request per distinct key — every bucket then sits at 59/60, nothing is
// pruned, the map grows without limit, and every later request pays an O(n) scan
// over it ahead of every legitimate user. Eviction therefore does not consult a
// bucket's token level; it evicts by recency until the map is under the ceiling.
// The 60/10 quotas above are unchanged — this bounds MEMORY, not quota.

export type ApiRouteKind = "read" | "write";

export interface ApiRateLimitDecision {
  allowed: boolean;
  /** Seconds until at least one token is available (0 when allowed). */
  retryAfterSeconds: number;
  /** Bucket capacity for this kind (60 reads / 10 writes). */
  limit: number;
  /** Whole tokens left AFTER this request (0 when refused). */
  remaining: number;
  /** Seconds until the bucket is full again. */
  resetAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  cap: number;
}

const READ_CAP = 60;
const WRITE_CAP = 10;
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 2000;
/**
 * Evict down to this many, not to exactly `MAX_BUCKETS`.
 *
 * Deleting to exactly the ceiling would re-run the eviction scan on the NEXT
 * insert — O(n) work on the hot path, once per request, for every legitimate
 * user on the instance. Amortised, the scan costs
 * `(MAX_BUCKETS - EVICTION_TARGET) / (MAX_BUCKETS - EVICTION_TARGET)` = one
 * deletion per insert.
 */
const EVICTION_TARGET = Math.floor(MAX_BUCKETS * 0.9);

const buckets = new Map<string, Bucket>();

function capFor(kind: ApiRouteKind): number {
  return kind === "read" ? READ_CAP : WRITE_CAP;
}

/**
 * Store `bucket` as the most-recently-used entry for `key`.
 *
 * A JS `Map` preserves INSERTION order, and re-`set`ing an existing key does
 * NOT move it — so a plain `set` would make the eviction below first-SEEN
 * rather than least-recently-USED, and one busy tutor would lose their quota to
 * whichever flood of one-shot keys arrived after their first request.
 * delete + set is what turns insertion order into recency order, at the cost of
 * two O(1) map operations.
 */
function remember(key: string, bucket: Bucket): void {
  buckets.delete(key);
  buckets.set(key, bucket);
}

/**
 * Make the `MAX_BUCKETS` ceiling real. Unconditional: eviction never depends on
 * a bucket looking idle.
 *
 * The previous `pruneIfFull` only deleted buckets whose tokens had refilled TO
 * CAP. An attacker who sends ONE request per distinct key leaves every bucket at
 * 59/60, so nothing was ever pruned: `buckets` grew without bound, and every
 * subsequent request paid a full O(n) scan over it — in front of every
 * legitimate user on that instance. A bucket holding debt is still evictable;
 * "has it refilled" is not a liveness test.
 *
 * Iteration is bounded by the number of entries actually removed, not by the map
 * size: the loop returns as soon as the target is reached, and `remember` keeps
 * the busiest keys at the END of the order where they are never reached.
 */
function enforceCeiling(): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const key of buckets.keys()) {
    if (buckets.size <= EVICTION_TARGET) return;
    buckets.delete(key);
  }
}

/** Consume one token for `ip`+`kind`. Pure in `nowMs` for tests. */
export function rateLimitApiRequest(
  ip: string,
  kind: ApiRouteKind,
  nowMs: number = Date.now(),
): ApiRateLimitDecision {
  const key = `${ip.trim() || "unknown"}|${kind}`;
  const cap = capFor(kind);
  const refillRate = cap / (WINDOW_MS / 1000);

  const stored = buckets.get(key);
  const tokens = stored
    ? Math.min(cap, stored.tokens + ((nowMs - stored.lastRefillMs) / 1000) * refillRate)
    : cap;

  if (tokens < 1) {
    remember(key, { tokens, lastRefillMs: stored?.lastRefillMs ?? nowMs, cap });
    enforceCeiling();
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillRate)),
      limit: cap,
      remaining: 0,
      resetAfterSeconds: Math.max(1, Math.ceil((cap - tokens) / refillRate)),
    };
  }

  const left = tokens - 1;
  remember(key, { tokens: left, lastRefillMs: nowMs, cap });
  enforceCeiling();
  return {
    allowed: true,
    retryAfterSeconds: 0,
    limit: cap,
    remaining: Math.floor(left),
    resetAfterSeconds: Math.ceil((cap - left) / refillRate),
  };
}

/** Test-only reset (buckets are module-private). */
export function resetApiRateLimits(): void {
  buckets.clear();
}

/**
 * Test/diagnostics-only live bucket count — the property `enforceCeiling` exists
 * to hold. Same test-only convention as `resetApiRateLimits`; production code
 * never needs to know how many IPs this instance has seen.
 */
export function apiRateLimitBucketCount(): number {
  return buckets.size;
}
