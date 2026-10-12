// Implements: web/04_API_Routes.md §2 (60/min reads, 10/min writes per IP;
// 429 with `Retry-After`) + §9 `RATE_LIMITED`; 10_Security.md §11 (throttle
// abuse friction on unauthenticated surfaces).
//
// Pins the exact contract `src/proxy.ts` enforces on `/api/v1/*`: the caps,
// the refill math, the refusal fields the edge turns into headers, and the
// per-IP/per-kind isolation. Time is injected (`nowMs`) so no test sleeps.

import { describe, it, expect, beforeEach } from "vitest";
import {
  rateLimitApiRequest,
  resetApiRateLimits,
} from "./rate-limit";

beforeEach(() => resetApiRateLimits());

describe("api rate limit — read bucket (60/min per IP)", () => {
  it("allows 60 reads, then refuses with a positive retry-after", () => {
    const now = 1_000_000;
    for (let i = 0; i < 60; i++) {
      const decision = rateLimitApiRequest("10.0.0.1", "read", now);
      expect(decision.allowed, `read #${i + 1}`).toBe(true);
      expect(decision.retryAfterSeconds).toBe(0);
      expect(decision.limit).toBe(60);
    }
    const blocked = rateLimitApiRequest("10.0.0.1", "read", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(60);
    expect(blocked.resetAfterSeconds).toBeGreaterThan(0);
  });

  it("reports a draining remaining count on allowed requests", () => {
    const now = 2_000_000;
    expect(rateLimitApiRequest("10.0.0.2", "read", now).remaining).toBe(59);
    expect(rateLimitApiRequest("10.0.0.2", "read", now).remaining).toBe(58);
  });

  it("refills after the window elapses", () => {
    const start = 3_000_000;
    for (let i = 0; i < 60; i++) {
      expect(rateLimitApiRequest("10.0.0.3", "read", start).allowed).toBe(true);
    }
    expect(rateLimitApiRequest("10.0.0.3", "read", start).allowed).toBe(false);
    // One full window later the bucket is whole again.
    expect(rateLimitApiRequest("10.0.0.3", "read", start + 61_000).allowed).toBe(true);
  });
});

describe("api rate limit — write bucket (10/min per IP)", () => {
  it("allows 10 writes, then refuses", () => {
    const now = 4_000_000;
    for (let i = 0; i < 10; i++) {
      expect(rateLimitApiRequest("10.0.0.4", "write", now).allowed, `write #${i + 1}`).toBe(true);
    }
    const blocked = rateLimitApiRequest("10.0.0.4", "write", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(10);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("api rate limit — isolation", () => {
  it("keeps read and write buckets independent", () => {
    const now = 5_000_000;
    for (let i = 0; i < 10; i++) {
      rateLimitApiRequest("10.0.0.5", "write", now);
    }
    expect(rateLimitApiRequest("10.0.0.5", "write", now).allowed).toBe(false);
    // The read bucket for the same IP is untouched.
    expect(rateLimitApiRequest("10.0.0.5", "read", now).allowed).toBe(true);
  });

  it("keeps IPs independent", () => {
    const now = 6_000_000;
    for (let i = 0; i < 60; i++) {
      rateLimitApiRequest("10.0.0.6", "read", now);
    }
    expect(rateLimitApiRequest("10.0.0.6", "read", now).allowed).toBe(false);
    expect(rateLimitApiRequest("10.0.0.7", "read", now).allowed).toBe(true);
  });

  it("treats a blank IP as one shared unknown bucket", () => {
    const now = 7_000_000;
    expect(rateLimitApiRequest("   ", "read", now).remaining).toBe(59);
    expect(rateLimitApiRequest("", "read", now).remaining).toBe(58);
  });
});
