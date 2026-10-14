// Implements: web/04_API_Routes.md §2 (60/min reads, 10/min writes per IP;
// 429 with `Retry-After`) + §9 `RATE_LIMITED`; AGENTS.md §2 Rule 2 posture (one
// instance serves every tutor behind it, so the limiter must not be the thing
// that exhausts it) + Rule 9 (no silent failure).
//
// THE DEFECT. `pruneIfFull` only deleted buckets whose tokens had refilled TO CAP.
// An attacker who sends ONE request per distinct key leaves every bucket at
// 59/60 — nothing is ever "full", so nothing is ever pruned. `buckets` grows
// without bound and every later request pays a full O(n) scan over it, in front
// of every legitimate user on that instance.
//
// WHAT IS ASSERTED, in the order it matters:
//   1. the ceiling is REAL — 10× the cap of distinct keys leaves the map bounded;
//   2. eviction is UNCONDITIONAL — it happens even though no bucket ever refilled,
//      which is the whole point (the old predicate was "has refilled to cap");
//   3. it is LRU, not FIFO — a key still in active use survives a flood of
//      one-shot keys, because its bucket is never idle;
//   4. the 60/10 QUOTAS are untouched by the memory bound — same numbers, same
//      refusal shape, per IP and per kind.

import { describe, it, expect, beforeEach } from "vitest";
import { rateLimitApiRequest, resetApiRateLimits, apiRateLimitBucketCount } from "./rate-limit";

/** The ceiling the module enforces. Mirrors `MAX_BUCKETS` in rate-limit.ts. */
const CEILING = 2000;

beforeEach(() => resetApiRateLimits());

describe("F-29 — the bucket ceiling holds under a 1-request-per-key flood", () => {
  it("stops growing once the ceiling is reached (10× the cap of distinct keys)", () => {
    const now = 10_000_000;
    // One request each, every key distinct, all inside a single instant — so no
    // bucket can possibly refill and the old "has it refilled to cap?" predicate
    // could never fire.
    for (let i = 0; i < CEILING * 10; i++) {
      expect(
        rateLimitApiRequest(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, "read", now)
          .allowed,
      ).toBe(true);
      if (apiRateLimitBucketCount() > CEILING) {
        throw new Error(
          `ceiling breached after ${i + 1} requests: ${apiRateLimitBucketCount()} buckets`,
        );
      }
    }
    expect(apiRateLimitBucketCount()).toBeLessThanOrEqual(CEILING);
    // Bounded and still serving: a real tutor arriving after the flood is allowed.
    expect(rateLimitApiRequest("203.0.113.9", "read", now).allowed).toBe(true);
  });

  it("evicts a bucket that is NOT full, which is exactly what the old predicate missed", () => {
    const now = 11_000_000;
    // Key #0 takes a single token out of 60 and is never touched again.
    rateLimitApiRequest("198.51.100.1", "read", now);
    expect(rateLimitApiRequest("198.51.100.1", "read", now).remaining).toBe(58);

    // Flood with distinct keys until the ceiling has been passed at least twice.
    for (let i = 0; i < CEILING * 2; i++) {
      rateLimitApiRequest(`flood-${i}.example`, "read", now);
    }

    // Its bucket is gone, so the key starts a FRESH 60-token bucket (remaining 59)
    // instead of continuing the old one (remaining 58).
    expect(rateLimitApiRequest("198.51.100.1", "read", now).remaining).toBe(59);
  });

  it("is least-recently-USED, not first-seen: an active IP survives the flood", () => {
    const now = 12_000_000;
    // Touch the incumbent every 100 requests, well inside the ~201 inserts that
    // separate one eviction from the next, so it is always among the newest.
    for (let i = 0; i < CEILING * 2; i++) {
      if (i % 100 === 0) rateLimitApiRequest("192.0.2.7", "read", now);
      rateLimitApiRequest(`burst-${i}.example`, "read", now);
    }
    // 40 touches during the flood, plus this call: 60 tokens - 41 = 19 left.
    // A fresh bucket would have answered 59 — so its debt survived eviction.
    expect(rateLimitApiRequest("192.0.2.7", "read", now).remaining).toBe(19);
  });
});

describe("F-29 — the memory bound did not change the documented quota", () => {
  it("still allows 60 reads and refuses the 61st", () => {
    const now = 13_000_000;
    for (let i = 0; i < 60; i++) {
      expect(rateLimitApiRequest("10.0.0.1", "read", now).allowed, `read #${i + 1}`).toBe(true);
    }
    const blocked = rateLimitApiRequest("10.0.0.1", "read", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(60);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("still allows 10 writes and refuses the 11th", () => {
    const now = 14_000_000;
    for (let i = 0; i < 10; i++) {
      expect(rateLimitApiRequest("10.0.0.2", "write", now).allowed, `write #${i + 1}`).toBe(true);
    }
    const blocked = rateLimitApiRequest("10.0.0.2", "write", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(10);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps read and write quotas separate for the SAME ip (60 and 10)", () => {
    const now = 15_000_000;
    // Exhaust the WRITE quota for this IP only.
    for (let i = 0; i < 10; i++) {
      expect(rateLimitApiRequest("10.0.0.3", "write", now).allowed).toBe(true);
    }
    expect(rateLimitApiRequest("10.0.0.3", "write", now).allowed).toBe(false);

    // The READ quota is untouched and still reads 60, on the very next call.
    for (let i = 0; i < 60; i++) {
      expect(rateLimitApiRequest("10.0.0.3", "read", now).allowed, `read #${i + 1}`).toBe(true);
    }
    expect(rateLimitApiRequest("10.0.0.3", "read", now).limit).toBe(60);
    expect(rateLimitApiRequest("10.0.0.3", "read", now).allowed).toBe(false);
    // ...and the write bucket is still the one refusing.
    expect(rateLimitApiRequest("10.0.0.3", "write", now).allowed).toBe(false);
  });

  it("keeps a read-heavy IP and a write-heavy IP on their own quotas", () => {
    const now = 16_000_000;
    // Reader: 60 requests, then refused.
    for (let i = 0; i < 60; i++) rateLimitApiRequest("10.0.0.4", "read", now);
    expect(rateLimitApiRequest("10.0.0.4", "read", now).allowed).toBe(false);

    // Writer: 10 requests, then refused — the read flood did not spend it.
    for (let i = 0; i < 10; i++) {
      expect(rateLimitApiRequest("10.0.0.5", "write", now).allowed, `write #${i + 1}`).toBe(true);
    }
    expect(rateLimitApiRequest("10.0.0.5", "write", now).allowed).toBe(false);
    // And the reader's write bucket is fresh, not the reader's read bucket.
    expect(rateLimitApiRequest("10.0.0.4", "write", now).allowed).toBe(true);
  });
});
