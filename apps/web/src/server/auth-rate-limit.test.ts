// Implements: 10_Security.md §11 (rate limits); RFC-003 §1 G-AUTH.

import { describe, it, expect, beforeEach } from "vitest";
import {
  PASSWORD_RESET_WINDOW,
  authRateLimitKey,
  checkAuthRateLimit,
  resetAuthRateLimits,
} from "./auth-rate-limit";

describe("auth-rate-limit", () => {
  beforeEach(() => resetAuthRateLimits());

  it("normalises the key per IP+email (case/whitespace-insensitive email)", () => {
    expect(authRateLimitKey("1.2.3.4", "Tutor@X.com ")).toBe(authRateLimitKey("1.2.3.4", "tutor@x.com"));
    expect(authRateLimitKey("1.2.3.4", "a@x.com")).not.toBe(authRateLimitKey("9.9.9.9", "a@x.com"));
    expect(authRateLimitKey("1.2.3.4", "a@x.com")).not.toBe(authRateLimitKey("1.2.3.4", "b@x.com"));
  });

  it("allows up to the limit, then blocks with retry-after", () => {
    const key = authRateLimitKey("10.0.0.1", "tutor@example.com");
    for (let i = 0; i < PASSWORD_RESET_WINDOW.limit; i++) {
      expect(checkAuthRateLimit(key, PASSWORD_RESET_WINDOW, 1_000).allowed).toBe(true);
    }
    const blocked = checkAuthRateLimit(key, PASSWORD_RESET_WINDOW, 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = authRateLimitKey("10.0.0.2", "tutor@example.com");
    const window = { limit: 1, windowMs: 60_000 };
    expect(checkAuthRateLimit(key, window, 0).allowed).toBe(true);
    expect(checkAuthRateLimit(key, window, 1_000).allowed).toBe(false);
    expect(checkAuthRateLimit(key, window, 61_000).allowed).toBe(true);
  });
});
