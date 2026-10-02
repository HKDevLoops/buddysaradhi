// Implements: 10_Security.md §11 (reset rate limits); RFC-003 §1 G-AUTH
// (reset-request validation); 12_Business_Rules.md BR-SEC-08.

import { describe, it, expect, beforeEach } from "vitest";
import { requestPasswordResetAction } from "./auth";
import { resetAuthRateLimits } from "@/server/auth-rate-limit";

describe("requestPasswordResetAction", () => {
  beforeEach(() => resetAuthRateLimits());

  it("rejects invalid emails with VALIDATION (no Supabase call)", async () => {
    const res = await requestPasswordResetAction({ email: "not-an-email" });
    expect(res.success).toBe(false);
    expect(res.code).toBe("VALIDATION");
  });

  it("rejects empty emails with VALIDATION", async () => {
    const res = await requestPasswordResetAction({ email: "   " });
    expect(res.success).toBe(false);
    expect(res.code).toBe("VALIDATION");
  });

  it("throttles after 5 requests per IP+email with RATE_LIMITED", async () => {
    const email = `throttle-probe-${Date.now()}@example.com`;
    for (let i = 0; i < 5; i++) {
      const res = await requestPasswordResetAction({ email });
      expect(res.code).not.toBe("RATE_LIMITED");
    }
    const blocked = await requestPasswordResetAction({ email });
    expect(blocked.success).toBe(false);
    expect(blocked.code).toBe("RATE_LIMITED");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
