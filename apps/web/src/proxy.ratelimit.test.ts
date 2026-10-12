// Implements: web/04_API_Routes.md §2 (edge enforcement of the 60/min-read,
// 10/min-write token bucket on `/api/v1/*`) + §9 `RATE_LIMITED`;
// 10_Security.md §11.
//
// Exercises `src/proxy.ts` end-to-end at the middleware layer: a burst over
// the threshold answers 429 with `Retry-After` + the `RateLimit-*` trio and
// a `RATE_LIMITED` body, while normal traffic passes through untouched (with
// informative `RateLimit-*` headers) and preflights stay exempt.

import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSession = vi.hoisted(() => vi.fn(async (_req: unknown, res: unknown) => res));
vi.mock("./lib/supabase/middleware", () => ({ updateSession }));

import { NextRequest } from "next/server";
import proxy from "./proxy";
import { resetApiRateLimits } from "./server/rate-limit";

function apiReq(ip: string, path = "/api/v1/students", method = "GET"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  updateSession.mockClear();
  resetApiRateLimits();
});

describe("proxy edge rate limit — /api/v1/*", () => {
  it("answers a read storm with 429 + Retry-After + RateLimit headers", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 61; i++) {
      last = await proxy(apiReq("9.9.9.1"));
    }
    expect(last).not.toBeNull();
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
    expect(Number(last?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(last?.headers.get("RateLimit-Limit")).toBe("60");
    expect(last?.headers.get("RateLimit-Remaining")).toBe("0");
    expect(last?.headers.get("RateLimit-Reset")).toBeTruthy();
    const body = (await last?.json()) as { success: boolean; code: string; retryAfter: number };
    expect(body.success).toBe(false);
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("lets normal traffic through with informative RateLimit headers", async () => {
    const res = await proxy(apiReq("9.9.9.2"));
    // `NextResponse.next()` in middleware tests surfaces as a 200 with the
    // headers the middleware set — the pass-through itself, not the route.
    expect(res.status).toBe(200);
    expect(res.headers.get("RateLimit-Limit")).toBe("60");
    expect(res.headers.get("RateLimit-Remaining")).toBe("59");
    expect(res.headers.get("429")).toBeNull();
  });

  it("throttles writes at 10/min on a separate bucket", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await proxy(apiReq("9.9.9.3", "/api/v1/students", "POST"));
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("RateLimit-Limit")).toBe("10");
    // Reads for the same IP are unaffected by the write storm.
    const read = await proxy(apiReq("9.9.9.3"));
    expect(read.status).toBe(200);
  });

  it("never throttles CORS preflights (OPTIONS is exempt)", async () => {
    for (let i = 0; i < 70; i++) {
      const preflight = await proxy(apiReq("9.9.9.4", "/api/v1/students", "OPTIONS"));
      expect(preflight.status, `preflight #${i + 1}`).toBe(204);
    }
  });

  it("isolates buckets per client IP", async () => {
    for (let i = 0; i < 60; i++) {
      await proxy(apiReq("9.9.9.5"));
    }
    expect((await proxy(apiReq("9.9.9.5"))).status).toBe(429);
    expect((await proxy(apiReq("9.9.9.6"))).status).toBe(200);
  });
});

describe("proxy fingerprint + redirect headers", () => {
  it("emits the tightened CSP (no unsafe-inline in script-src) on the / redirect", async () => {
    const { REDIRECT_CSP } = await import("./proxy");
    const res = await proxy(
      new NextRequest("http://localhost:3000/", { headers: { "user-agent": "test" } }),
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBe(REDIRECT_CSP);
    // script-src carries NO 'unsafe-inline' (the flagged weakness); the other
    // directives keep their safety-net values.
    const scriptSrc = csp
      ?.split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
    // The rest of the policy is byte-identical to the next.config safety net
    // (style/fonts/img/connect/frame-ancestors/base/form-action/upgrade).
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("omits x-detected-platform in production but keeps it in dev", async () => {
    // SAFETY: `process.env.NODE_ENV` is typed readonly; the mutable view is
    // test-only and the original value is restored in `finally`, so no other
    // test can observe the flip. This is the only way to exercise the
    // production fingerprint gate without a second process.
    const env = process.env as Record<string, string | undefined>;
    const saved = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      const prodApi = await proxy(apiReq("9.9.9.7"));
      expect(prodApi.headers.get("x-detected-platform")).toBeNull();
      expect(prodApi.headers.get("x-matched-path")).toBeNull();

      const prodPage = await proxy(
        new NextRequest("http://localhost:3000/dashboard", { headers: { "user-agent": "test" } }),
      );
      expect(prodPage.headers.get("x-detected-platform")).toBeNull();
      expect(prodPage.headers.get("x-matched-path")).toBeNull();
    } finally {
      env.NODE_ENV = saved;
    }

    const devApi = await proxy(apiReq("9.9.9.8"));
    expect(devApi.headers.get("x-detected-platform")).toBeTruthy();
    // Our layer never emits x-matched-path in any environment.
    expect(devApi.headers.get("x-matched-path")).toBeNull();
  });

  it("never emits X-Powered-By from the middleware layer", async () => {
    expect((await proxy(apiReq("9.9.9.9"))).headers.get("x-powered-by")).toBeNull();
  });
});
