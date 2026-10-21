// Implements: 10_Security.md §6 (XSS-1) + 23_Security_Harness_Plan.md §7, for
// the ONE surface in this app that reads a cookie, renders operator-supplied
// text and accepts a mutation: the operations console.
//
// TWO POLICIES, AND WHY. The MARKETING pages cannot drop `'unsafe-inline'`
// from `script-src`: Next.js 16 inlines the RSC flight payload as
// `self.__next_f.push(...)` scripts whose content depends on the page (12
// inline scripts on `/`), so their sha256 hashes are per-payload and cannot
// be allowlisted. Measured, not assumed: with `script-src 'self'` and no
// nonce, Chrome refuses all 12 and the page never hydrates (no `<canvas>`,
// no beat nav). Those pages are fully prerendered with zero user input and
// zero reflection, so `next.config.ts` keeps the static policy for them.
//
// The CONSOLE is different: dynamic (a session cookie decides what renders),
// it renders text a VISITOR typed (the access-request inbox), and it accepts
// mutations. A nonce-based policy with no `'unsafe-inline'` is the right
// shape there, and Next.js applies the nonce to its own inline scripts
// automatically when the page is dynamically rendered.
//
// `style-src` keeps `'unsafe-inline'` on purpose: React writes
// `style="..."` attributes, and `style-src` governs style ATTRIBUTES as well
// as `<style>` elements. A CSS injection is a far smaller blast radius than
// script execution, and the attribute form is needed by the design-system
// primitives.
//
// Mirrors the pattern already proven in this repo at `apps/web/src/proxy.ts`
// (same nonce construction, same `'strict-dynamic'` posture), so there is one
// CSP shape in the codebase, not two.
//
// Rule 2: no new origin is allowlisted here. Rule 9: this file adds no
// logging and swallows nothing.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The console's own CSP. `script-src` has NO `'unsafe-inline'`: the only
 * inline scripts that may run are the ones Next.js stamps with this request's
 * nonce. `'strict-dynamic'` lets that nonce-trusted bootstrap load the
 * chunk files it needs, and (in a CSP3 browser) makes the `'self'` source
 * expression irrelevant to them, which is what stops an injected
 * `<script src="/_next/static/...">` from running.
 */
function consoleCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://api.buddysaradhi.app",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * A fresh, unpredictable nonce per request. 128 bits of entropy from
 * `crypto.randomUUID`, base64 encoded (the encoding Next.js's parser accepts:
 * it looks for the `'nonce-{value}'` pattern, so the value must not contain a
 * quote or a semicolon — base64url-ish output from `btoa` on a UUID contains
 * neither).
 */
function freshNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export default function proxy(request: NextRequest): NextResponse {
  const nonce = freshNonce();
  const csp = consoleCsp(nonce);

  // The REQUEST headers carry the CSP, because Next.js reads the nonce from
  // there while rendering. The RESPONSE headers carry it too, because that is
  // the header the browser enforces.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  /**
   * The console and nothing else. The marketing pages keep the static policy
   * in `next.config.ts` (see the header comment for why they must), and the
   * API routes are excluded because they return JSON, never HTML.
   */
  matcher: ["/admin/:path*"],
};
