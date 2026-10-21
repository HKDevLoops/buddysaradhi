// Implements: 10_Security.md §6 (XSS-1 — a nonce-based, strict-dynamic CSP).
//
// Regression guard for docs/audit/DYNAMIC-WEB.md F-1 and F-3.
//
// F-1: the edge mints a PER-REQUEST nonce and serves documents under
// `script-src 'self' 'nonce-<n>' 'strict-dynamic'`. A prerendered page
// cannot satisfy that, and `strict-dynamic` makes the browser ignore the
// `'self'` allowlist — so every same-origin script is refused.
//
// F-3: `isHtmlPage` used to exclude any path containing a dot, so a dotted 404
// (`/nope.json`) was served under the STATIC safety net from
// `next.config.ts` (`script-src 'self' 'unsafe-inline'`) while `/nope` got
// the strict nonce policy.
//
// The nonce has to travel: Next's app-render reads it from the REQUEST's
// `content-security-policy` header, and Next copies the middleware's RESPONSE
// headers into the downstream request (resolve-routes.js: `req.headers[key]
// = value`). So the edge's CSP reaches the renderer — but only for a page
// rendered during the request.

import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSession = vi.hoisted(() => vi.fn(async (_req: unknown, res: unknown) => res));
vi.mock("./lib/supabase/middleware", () => ({ updateSession }));

import { NextRequest } from "next/server";
import proxy from "./proxy";

function page(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { "user-agent": "test" } });
}

function nonceOf(csp: string | null): string | null {
  const m = /'nonce-([^']+)'/.exec(csp ?? "");
  return m ? (m[1] ?? null) : null;
}

/** The `script-src` directive on its own — `style-src` legitimately carries
 *  `'unsafe-inline'`, so a whole-header search would be the wrong assertion. */
function scriptSrc(csp: string | null): string {
  const directive = (csp ?? "")
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src"));
  return directive ?? "";
}

beforeEach(() => {
  updateSession.mockClear();
});

describe("edge CSP — the document's nonce must be the policy's nonce", () => {
  it("serves a nonce-based, strict-dynamic policy on an HTML page", async () => {
    const res = await proxy(page("/login"));
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("strict-dynamic");
    // `script-src` must not allow inline script: with a nonce + strict-dynamic
    // the only authorised inline script is the one carrying the nonce.
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(scriptSrc(csp)).toContain("'strict-dynamic'");
    expect(nonceOf(csp)).toBeTruthy();
  });

  it("puts the SAME nonce on the request the renderer sees (so Next can stamp it on <script>)", async () => {
    const res = await proxy(page("/login"));
    const headerNonce = nonceOf(res.headers.get("Content-Security-Policy"));
    const requestNonce = res.headers.get("x-middleware-request-x-nonce");
    // Next copies `x-middleware-request-<name>` onto the downstream request.
    expect(requestNonce).toBeTruthy();
    expect(requestNonce).toBe(headerNonce);
  });

  it("carries the CSP on the REQUEST - that is the header Next 16 reads the nonce from", async () => {
    // THE CONTRACT, from Next's own source:
    //   node_modules/next/dist/esm/server/app-render/app-render.js:134
    //     const csp = headers['content-security-policy']
    //                || headers['content-security-policy-report-only'];
    //   node_modules/next/dist/esm/server/app-render/get-script-nonce-from-header.js
    //     getScriptNonceFromHeader() splits the CSP VALUE on ';' and extracts
    //     the first 'nonce-...' source from the script-src directive.
    //
    // So the nonce reaches the renderer ONLY through the request's
    // Content-Security-Policy header. A custom `x-nonce` header is NOT read by
    // Next: the renderer finds no CSP, stamps no nonce on the `<script>` tags
    // it emits, and because CSP3 makes `'self'` ignored once
    // `'strict-dynamic'` is present, the browser then blocks every one of them.
    // Measured live before the fix: 30 CSP violations on /login,
    // `window.next === undefined`, zero React fibers - the app downloaded
    // ~150-230 KB gzip of JS and NEVER HYDRATED.
    const res = await proxy(page("/login"));
    const requestCsp = res.headers.get("x-middleware-request-content-security-policy");
    expect(
      requestCsp,
      "the request must carry the CSP - Next 16 reads the nonce from it (app-render.js:134)",
    ).toBeTruthy();
    const requestNonce = nonceOf(requestCsp);
    expect(requestNonce, "the request's CSP must name a nonce").toBeTruthy();
    // The SAME nonce the enforced policy names - a mismatch means the renderer
    // stamps a nonce the browser will not accept.
    expect(requestNonce).toBe(nonceOf(res.headers.get("Content-Security-Policy")));
  });

  it("applies the strict policy to a DOTTED path too (F-4: /nope.json is an HTML document)", async () => {
    const dotted = await proxy(page("/nope.json"));
    const plain = await proxy(page("/nope"));
    for (const res of [dotted, plain]) {
      const csp = res.headers.get("Content-Security-Policy");
      // A dotted path used to fall through to the static safety net, which
      // means NO header at all from the edge — hence the explicit truthiness
      // assertion before the shape checks.
      expect(csp, "no CSP header on a dotted path").toBeTruthy();
      expect(csp).toContain("strict-dynamic");
      expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
      expect(nonceOf(csp)).toBeTruthy();
    }
  });

  it("mints a DIFFERENT nonce per request", async () => {
    const a = nonceOf((await proxy(page("/login"))).headers.get("Content-Security-Policy"));
    const b = nonceOf((await proxy(page("/login"))).headers.get("Content-Security-Policy"));
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("does NOT stamp a nonce policy on an API response", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/v1/releases/latest", { headers: { "user-agent": "test" } }),
    );
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("keeps the contentless `/` redirect on the nonce-free, inline-free policy", async () => {
    const { REDIRECT_CSP } = await import("./proxy");
    const res = await proxy(page("/"));
    expect(res.headers.get("Content-Security-Policy")).toBe(REDIRECT_CSP);
  });
});
