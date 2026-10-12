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
// DDoS protection stays with the edge firewall. `resetApiRateLimits` is
// test-only (same pattern as `resetAuthRateLimits`).

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

const buckets = new Map<string, Bucket>();

function capFor(kind: ApiRouteKind): number {
  return kind === "read" ? READ_CAP : WRITE_CAP;
}

function pruneIfFull(nowMs: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    // A bucket whose full-refill moment has passed holds no debt.
    const refillRate = bucket.cap / (WINDOW_MS / 1000);
    const tokens = Math.min(
      bucket.cap,
      bucket.tokens + ((nowMs - bucket.lastRefillMs) / 1000) * refillRate,
    );
    if (tokens >= bucket.cap) buckets.delete(key);
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
  pruneIfFull(nowMs);

  const stored = buckets.get(key);
  const tokens = stored
    ? Math.min(cap, stored.tokens + ((nowMs - stored.lastRefillMs) / 1000) * refillRate)
    : cap;

  if (tokens < 1) {
    buckets.set(key, { tokens, lastRefillMs: stored?.lastRefillMs ?? nowMs, cap });
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillRate)),
      limit: cap,
      remaining: 0,
      resetAfterSeconds: Math.max(1, Math.ceil((cap - tokens) / refillRate)),
    };
  }

  const left = tokens - 1;
  buckets.set(key, { tokens: left, lastRefillMs: nowMs, cap });
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
