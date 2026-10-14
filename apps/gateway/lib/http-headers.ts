// Implements: 10_Security.md §17 (no exfiltration surfaces; every response
// carries the deny-by-default header set) + AGENTS.md §2 Rule 3 (AP-10).
//
// WHY THIS FILE EXISTS — extracted so the header policy is TESTABLE AT ALL.
//
// `addSecurityHeaders` used to live inside `apps/gateway/index.ts`, which calls
// `Deno.serve()` at module scope. A test cannot import that module without
// booting a listener, so the policy was only ever asserted on its SOURCE
// CONSTANT (`getSecurityHeaders()["Cache-Control"]`), never on the response a
// client receives. That assertion could not fail.
//
// It then did fail, silently. `lib/cache.ts` builds a cache HIT already carrying
// `Cache-Control: public, max-age=<n>, stale-while-revalidate=10`. The old loop
// applied each security header with `if (!headers.has(key))`, so it saw
// `Cache-Control` already present and skipped it — the declared
// `no-store, no-cache, must-revalidate, proxy-revalidate` was never applied. Only
// the cache-MISS path was protected. So `/api/v1/students`,
// `/api/v1/attendance/batches`, `/api/v1/settings` and `/api/v1/notifications`
// shipped student names, grades, balances, institute contact details and
// notification bodies as PUBLICLY cacheable for up to 63 seconds.
//
// `public` is the harmful directive, not the TTL: the response is tenant-scoped
// by `cacheKey` (`gw:<tenantId>:<path>:<qs>`), but `public` lifts the
// restriction that only a private cache may store it, letting any shared
// intermediary store it under a URL-derived key and serve it to a DIFFERENT
// tenant whose request produces the same URL. Nothing varies on `Authorization`.
//
// This module makes the policy an importable unit so
// `__tests__/cache-security-headers.test.ts` asserts the SHIPPING function. A
// test that cannot fail is worse than no test — it tells the reader they are
// protected while they are not (AGENTS.md §2 Rule 9).

import { getSecurityHeaders } from "./security.ts";
import { corsHeadersForOrigin } from "./errors.ts";

/**
 * CORS headers for a request. Identical to the local `getCorsHeaders` that
 * `index.ts` defined — it was a one-line wrapper over this primitive, and the
 * allowlist decision stays in `lib/errors.ts` (the ONE place an origin is
 * decided). Wrapping rather than re-implementing keeps that property.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  return corsHeadersForOrigin(req.headers.get("Origin"));
}

/**
 * Apply the security header policy to a response.
 *
 * `Cache-Control` is an OVERRIDE, not a default — the single exception to the
 * `if (!headers.has(key))` rule below. Setting `no-store` costs no performance:
 * the gateway's latency optimisation is the in-process `Map` in `lib/cache.ts`,
 * and response headers govern EXTERNAL caches only (browser, CDN, corporate
 * proxy). The Map keeps serving hits regardless.
 */
export function addSecurityHeaders(req: Request, resp: Response, requestId: string): Response {
  const headers = new Headers(resp.headers);
  const declared = getSecurityHeaders();
  for (const [key, value] of Object.entries(declared)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  // The override. See the file header for the full defect write-up.
  headers.set("Cache-Control", declared["Cache-Control"] ?? "no-store");
  for (const [key, value] of Object.entries(getCorsHeaders(req))) {
    headers.set(key, value);
  }
  headers.set("X-Request-Id", requestId);
  headers.delete("Server");
  headers.delete("X-Powered-By");
  headers.delete("X-AspNet-Version");
  headers.delete("X-AspNetMvc-Version");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

/**
 * Stamp a cache HIT before it goes through `addSecurityHeaders`.
 *
 * Extracted from `index.ts` for the same reason `addSecurityHeaders` was: the
 * hit branch is untestable in place (module-scope `Deno.serve`), and the last
 * defect here — F-23, the `X-Cache-Key` header echoing
 * `gw:<tenantId>:<path>:<query>` — survived precisely because no test could
 * reach the code that set it.
 *
 * Contract, pinned by `cache-security-headers.test.ts`: this adds EXACTLY two
 * headers (`X-Response-Time`, `X-Request-Id`) and nothing else. In particular
 * it MUST NOT echo the cache key, the tenant id, or the query string. A debug
 * header that names the cache entry is a cross-tenant disclosure the moment a
 * shared intermediary stores the response: nothing here varies on
 * `Authorization`, and nothing consumed the old header.
 */
export function decorateCacheHit(cached: Response, requestId: string, dtMs: number): void {
  cached.headers.set("X-Response-Time", `${dtMs.toFixed(2)}ms`);
  cached.headers.set("X-Request-Id", requestId);
}