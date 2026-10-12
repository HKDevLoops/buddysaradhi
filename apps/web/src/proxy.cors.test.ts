// Implements: AGENTS.md §2 Rule 9 (fail-closed errors, no silent fallbacks);
// 10_Security.md §6 CORS-1 + 23_Security_Harness_Plan.md §7 (cross-origin must be
// allowlisted); 23_Security_Harness_Plan.md §9 client domain (a header that lies
// about the caller's origin is the defect, not just the leak).
//
// THE DEFECT. `getCorsHeaders` computed `isAllowed = origin && ALLOWED_ORIGIN_PATTERNS
// .includes(origin)` and then answered `isAllowed ? origin : APP_BASE_URL` with
// `Access-Control-Allow-Credentials: 'true'` either way. So an unknown origin got a
// concrete ACAO — the canonical app origin — paired with credentials. A browser
// rejects the pair (the value must equal the caller's own origin), which is the only
// reason nothing leaked. That is a fail-OPEN default kept alive by browser
// forgiveness; the fix mirrors apps/gateway/lib/errors.ts `corsHeadersForOrigin` and the
// OPTIONS
// handler in app/api/v1/[...slug]/route.ts, which had already been corrected.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const updateSession = vi.hoisted(() => vi.fn(async (_req: unknown, res: unknown) => res));
vi.mock("./lib/supabase/middleware", () => ({ updateSession }));

import { NextRequest } from "next/server";
import proxy from "./proxy";
import { resetApiRateLimits } from "./server/rate-limit";

function apiReq(origin: string | null, path = "/api/v1/students", method = "GET"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: origin ? { origin } : {},
  });
}

beforeEach(() => {
  updateSession.mockClear();
  // The edge rate limiter (web/04_API_Routes.md §2) shares one bucket per
  // test file: these CORS assertions must never depend on how many requests
  // earlier tests in this file consumed.
  resetApiRateLimits();
});

describe("proxy CORS — fail closed for an unlisted origin", () => {
  it("answers an unlisted origin with NO Allow-Origin and NO Allow-Credentials", async () => {
    const res = await proxy(apiReq("https://evil.example"));

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    // The origin-independent grant survives: it authorises nothing by itself.
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
  });

  it("never falls back to APP_BASE_URL as the echoed origin", async () => {
    const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://buddysaradhi.vercel.app";
    const res = await proxy(apiReq("https://evil.example"));
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(appBase);
    expect(JSON.stringify([...res.headers.entries()])).not.toContain(appBase);
  });

  it("emits no origin for a request with no Origin header at all", async () => {
    const res = await proxy(apiReq(null));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("adds Vary: Origin — without it a shared cache can cross-serve one origin's credentialed response", async () => {
    expect((await proxy(apiReq("https://evil.example"))).headers.get("Vary")).toBe("Origin");
    expect((await proxy(apiReq("https://buddysaradhi.app"))).headers.get("Vary")).toBe("Origin");
    const preflight = await proxy(apiReq("https://evil.example", "/api/v1/students", "OPTIONS"));
    expect(preflight.headers.get("Vary")).toBe("Origin");
  });

  it("echoes an allowlisted origin WITH credentials", async () => {
    for (const origin of [
      "https://buddysaradhi.app",
      "https://buddysaradhi.vercel.app",
      "https://app.buddysaradhi.app",
      "http://localhost:3000",
      "tauri://localhost",
    ]) {
      const res = await proxy(apiReq(origin));
      expect(res.headers.get("Access-Control-Allow-Origin"), origin).toBe(origin);
      expect(res.headers.get("Access-Control-Allow-Credentials"), origin).toBe("true");
    }
  });

  it("rejects near-miss origins (suffix, prefix, scheme and case)", async () => {
    for (const origin of [
      "https://buddysaradhi.app.evil.example",
      "https://evil.example/#https://buddysaradhi.app",
      "http://buddysaradhi.app",
      "https://BUDDYSARADHI.APP",
      "https://buddysaradhi.app:8443",
      "null",
      "",
      "https://sub.buddysaradhi.app",
      "https://evil-https://buddysaradhi.app",
    ]) {
      const res = await proxy(apiReq(origin));
      expect(res.headers.get("Access-Control-Allow-Origin"), origin).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Credentials"), origin).toBeNull();
    }
  });

  it("answers an OPTIONS preflight with the same fail-closed decision as a normal request", async () => {
    const unlisted = await proxy(apiReq("https://evil.example", "/api/v1/students", "OPTIONS"));
    expect(unlisted.status).toBe(204);
    expect(unlisted.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(unlisted.headers.get("Access-Control-Allow-Credentials")).toBeNull();

    const listed = await proxy(apiReq("https://buddysaradhi.app", "/api/v1/students", "OPTIONS"));
    expect(listed.status).toBe(204);
    expect(listed.headers.get("Access-Control-Allow-Origin")).toBe("https://buddysaradhi.app");
    expect(listed.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does not disturb non-API responses", async () => {
    const res = await proxy(apiReq(null, "/dashboard"));
    expect(res.headers.get("x-detected-platform")).toBeTruthy();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// The middleware OPTIONS branch is what actually answers a preflight for `/api/v1/*`
// (its `config.matcher` covers every path but static assets, so it returns 204 before
// the route's own OPTIONS export is reached). The cross-resolver agreement check
// therefore lives in route.bff.test.ts, where both modules are already loaded.
describe("proxy CORS — ALLOWED_ORIGINS env widening", () => {
  const saved = process.env.ALLOWED_ORIGINS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = saved;
    vi.resetModules();
  });

  it("honours a comma-separated operator allowlist, and only that", async () => {
    process.env.ALLOWED_ORIGINS = "https://tutor-portal.example, https://qa.buddysaradhi.app";
    vi.resetModules();
    vi.doMock("./lib/supabase/middleware", () => ({ updateSession }));
    const fresh = (await import("./proxy")).default;

    expect((await fresh(apiReq("https://tutor-portal.example"))).headers.get("Access-Control-Allow-Origin")).toBe(
      "https://tutor-portal.example",
    );
    expect((await fresh(apiReq("https://qa.buddysaradhi.app"))).headers.get("Access-Control-Allow-Origin")).toBe(
      "https://qa.buddysaradhi.app",
    );
    expect((await fresh(apiReq("https://not-listed.example"))).headers.get("Access-Control-Allow-Origin")).toBeNull();
    vi.doUnmock("./lib/supabase/middleware");
  });
});