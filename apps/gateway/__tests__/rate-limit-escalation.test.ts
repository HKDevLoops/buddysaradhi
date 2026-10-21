// Implements: 2.12 (the rate limiter's backoff must escalate while a client
// keeps hammering), 10_Security.md §3 (the lockout ceilings).
import { describe, it, expect, vi } from "vitest";

// The limiter logs every rejection, and the log carries the counter - so the
// mock is how the test SEES the counter.
const warned = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../lib/log.ts", () => ({
  logWarn: vi.fn((_event: string, meta?: Record<string, unknown>) => {
    warned.push(meta ?? {});
  }),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { checkIpRateLimit } from "../lib/security.ts";

describe("2.12 - the IP rate limiter's backoff escalates", () => {
  it("the counter advances on the REJECT path", () => {
    warned.length = 0;
    const ip = "198.51.100.77";

    // Burn the allowance, then keep hammering.
    for (let i = 0; i < 140; i++) checkIpRateLimit(ip);

    const counts = warned
      .filter((m) => m.count !== undefined)
      .map((m) => Number(m.count));
    expect(counts.length).toBeGreaterThan(1);

    // THE DEFECT: the counter only advanced on the ALLOW path, so every
    // rejection logged the SAME count - the backoff was frozen at the value
    // it had when the penalty was first set, and a client that kept
    // hammering kept getting exactly the same wait.
    // THE FIX: each rejection advances it, so the next penalty is computed
    // from a larger count (`PROGRESSIVE_PENALTY_BASE_MS * 2^k`) and the
    // backoff escalates with continued abuse.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1] as number);
    }
  });

  it("a client inside a penalty is still refused", () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 140; i++) checkIpRateLimit(ip);
    expect(checkIpRateLimit(ip).allowed).toBe(false);
    expect(checkIpRateLimit(ip).status).toBe(429);
  });

  it("a different client is unaffected by the first one's penalty", () => {
    expect(checkIpRateLimit("192.0.2.55").allowed).toBe(true);
  });
});
