// Implements: web/04_API_Routes.md §2 (the `/api/v1/*` token bucket) +
// 10_Security.md §11.
//
// Regression guard for the second half of docs/audit/DYNAMIC-WEB.md F-2: the
// per-IP bucket is only as strong as the IP it is keyed on, so a client that
// can choose that IP can mint unlimited buckets. The per-INSTANCE ceiling is
// keyed on nothing the client can influence.
//
// The ceiling is a FLOOD tripwire, not rationing: 100x the per-IP read cap.

import { describe, it, expect, beforeEach } from "vitest";
import { rateLimitApiRequestGlobal, resetApiRateLimits } from "./rate-limit";

beforeEach(() => {
  resetApiRateLimits();
});

describe("per-instance rate-limit ceiling", () => {
  it("allows a burst that is far below the ceiling", () => {
    for (let i = 0; i < 500; i++) {
      const d = rateLimitApiRequestGlobal("read", 1_000_000 + i);
      expect(d.allowed, `request #${i + 1}`).toBe(true);
    }
  });

  it("refuses once the instance-wide budget is spent, whatever the client claims to be", () => {
    // The ceiling is not keyed on an IP, so "many different clients" is
    // exactly the case it exists for: the total is what is bounded.
    let refusal: ReturnType<typeof rateLimitApiRequestGlobal> | null = null;
    for (let i = 0; i < 20_000; i++) {
      const d = rateLimitApiRequestGlobal("read", 1_000_000 + i);
      if (!d.allowed) {
        refusal = d;
        break;
      }
    }
    expect(refusal).not.toBeNull();
    expect(refusal?.allowed).toBe(false);
    expect(refusal?.remaining).toBe(0);
    expect(refusal?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps the write ceiling separate from the read ceiling", () => {
    for (let i = 0; i < 20_000; i++) {
      const d = rateLimitApiRequestGlobal("read", 1_000_000 + i);
      if (!d.allowed) break;
    }
    const write = rateLimitApiRequestGlobal("write", 2_000_000);
    expect(write.allowed).toBe(true);
  });
});
