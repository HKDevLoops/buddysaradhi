// Implements: 10_Security.md §17 (no exfiltration surfaces) + AGENTS.md §2 Rule 3
// (AP-10) — and the gateway's own declared `SECURITY_HEADERS` policy.
//
// WHY THIS FILE EXISTS. Both defects below are the same species: a control that
// was correct as a CONSTANT but never verified on the WIRE. The pre-existing
// suite asserted `getSecurityHeaders()["Cache-Control"]` contains `no-store` —
// which it does, and always did. That assertion cannot fail, because it reads
// the literal, not the response a client actually receives. The live path went
// through `addSecurityHeaders`, whose `if (!headers.has(key))` skipped any
// header the response already carried. A cache HIT always carried one. So the
// declared policy was inert on exactly the responses that carry student PII.
//
// A test that cannot fail is worse than no test: it tells the reader they are
// protected while they are not (AGENTS.md §2 Rule 9).

import { describe, it, expect } from "vitest";
import { getSecurityHeaders } from "../lib/security.ts";
import { addSecurityHeaders, decorateCacheHit } from "../lib/http-headers.ts";
import { setCacheResponse, getCachedResponse, invalidateTenant } from "../lib/cache.ts";

/** The declared policy — the same literal the gateway applies. */
const SECURITY_HEADERS = getSecurityHeaders();

const REQ = new Request("https://gateway.invalid/api/v1/students?x=1");

/** A response shaped like a gateway cache HIT: already carrying Cache-Control. */
function cachedResponse(cacheControl: string): Response {
  return new Response(JSON.stringify({ success: true, data: { students: [] } }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": cacheControl },
  });
}

/**
 * Applies the SHIPPING policy function — not a copy of it.
 *
 * This is the entire point of extracting `addSecurityHeaders` into
 * `lib/http-headers.ts`. An earlier draft of this file re-implemented the header
 * loop inline, and it passed 6/6 **even with the production fix deleted**,
 * because the copy was untouched. A test that guards a copy guards nothing.
 * Deleting the `headers.set("Cache-Control", …)` line in `lib/http-headers.ts`
 * turns these red — verified as a negative control, not assumed.
 */
function applySecurityHeaders(resp: Response): Headers {
  return addSecurityHeaders(REQ, resp, "req-test").headers;
}

describe("Cache-Control reaches the wire on a cache HIT (not just the constant)", () => {
  it("the declared policy is no-store", () => {
    // The assertion that already existed, kept so its intent stays visible.
    expect(getSecurityHeaders()["Cache-Control"]).toContain("no-store");
  });

  it("overrides a cached response's `public, max-age=…`", () => {
    // This is the regression. `public` on a tenant-scoped response lets any
    // shared intermediary store it under a URL-derived key and serve it to a
    // DIFFERENT tenant. Nothing varies on Authorization.
    const headers = applySecurityHeaders(
      cachedResponse("public, max-age=30, stale-while-revalidate=10")
    );
    expect(headers.get("Cache-Control")).toBe(SECURITY_HEADERS["Cache-Control"]);
    expect(headers.get("Cache-Control")).toContain("no-store");
    expect(headers.get("Cache-Control")).not.toContain("public");
  });

  it("also overrides `okCached`'s own `public, max-age=30`", () => {
    // The same policy applied to a route-level cache directive, not the Map.
    const headers = applySecurityHeaders(cachedResponse("public, max-age=30"));
    expect(headers.get("Cache-Control")).not.toContain("public");
  });

  it("leaves an uncached response no-store as before", () => {
    const headers = applySecurityHeaders(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
    );
    expect(headers.get("Cache-Control")).toContain("no-store");
  });

  it("does not disturb the other security headers", () => {
    const headers = applySecurityHeaders(cachedResponse("public, max-age=30"));
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (key === "Cache-Control") continue;
      expect(headers.get(key)).toBe(value);
    }
  });
});

describe("F-23 / a cache HIT leaks neither the tenant id nor the query string", () => {
  // The defect: cache hits carried `X-Cache-Key: gw:<tenantId>:<path>:<query>`
  // — the tenant id and the tutor's full query string (potentially a student's
  // name) in a response header, readable by anyone who can read responses.
  // Fixed by deleting the header (index.ts:289). This pins the wire property,
  // not the absence of one line: plant a key containing a tenant id and a
  // student search term, run the full hit pipeline, and assert NEITHER string
  // survives in ANY response header value.
  const TENANT = "tenant-f23-sekrit";
  const SEARCH = "search=Aarav";

  function plantedHit(): Response {
    const key = `gw:${TENANT}:/api/v1/students:?${SEARCH}`;
    setCacheResponse(key, JSON.stringify({ success: true, data: [] }));
    const hit = getCachedResponse(key);
    if (!hit) throw new Error("cache did not return the planted entry");
    return hit;
  }

  function finalHeaderValues(resp: Response): string[] {
    return addSecurityHeaders(
      new Request(`https://gateway.invalid/api/v1/students?${SEARCH}`),
      resp,
      "req-f23-opaque-id",
    ).headers;
  }

  it("no header on a cache hit contains the tenant id", () => {
    const headers = finalHeaderValues(plantedHit());
    const values: string[] = [];
    headers.forEach((v) => values.push(v));
    expect(values.some((v) => v.includes(TENANT))).toBe(false);
  });

  it("no header on a cache hit contains the query string", () => {
    const headers = finalHeaderValues(plantedHit());
    const values: string[] = [];
    headers.forEach((v) => values.push(v));
    expect(values.some((v) => v.includes("Aarav"))).toBe(false);
  });

  it("there is no X-Cache-Key header at all", () => {
    const headers = finalHeaderValues(plantedHit());
    expect(headers.get("X-Cache-Key")).toBeNull();
  });

  it("decorateCacheHit adds EXACTLY two headers and nothing else", () => {
    // The strong guard. `decorateCacheHit` is the SHIPPING function
    // `index.ts` calls on the hit path — not a copy. If anyone re-adds an
    // `X-Cache-Key` (or any other) header there, this goes red, because the
    // assertion is on the exact added set, not on the absence of one name.
    // (Asserting only `get("X-Cache-Key")` would pass vacuously the day the
    // leak is renamed — this fails on ANY addition.)
    const before = new Response("[]", {
      headers: { "Content-Type": "application/json" },
    });
    const beforeNames = new Set<string>();
    before.headers.forEach((_, name) => beforeNames.add(name));
    decorateCacheHit(before, "req-exact", 3.14159);
    const afterNames = new Set<string>();
    before.headers.forEach((_, name) => afterNames.add(name));
    const added = [...afterNames].filter((n) => !beforeNames.has(n)).sort();
    expect(added).toEqual(["x-request-id", "x-response-time"]);
    expect(before.headers.get("X-Response-Time")).toBe("3.14ms");
    expect(before.headers.get("X-Request-Id")).toBe("req-exact");
  });
});

describe("the gateway Map cache still serves reads (no-store costs no performance)", () => {
  it("a stored entry is returned to the caller after the header policy applies", () => {
    // The override only governs EXTERNAL caches. The in-process Map is the
    // actual latency optimisation and must keep working — if it did not, the
    // "no performance cost" claim in index.ts would be false.
    const key = `students::tenant-cachehdr::1::`;
    setCacheResponse(key, "[]");
    invalidateTenant("tenant-cachehdr"); // clear any prior run
    setCacheResponse(key, "[]");
    const hit = getCachedResponse(key);
    expect(hit).not.toBeNull();
    // And the hit is exactly what would have carried the bad header.
    expect(hit!.headers.get("Cache-Control")).toContain("public");
    expect(applySecurityHeaders(hit!).get("Cache-Control")).toContain("no-store");
  });
});