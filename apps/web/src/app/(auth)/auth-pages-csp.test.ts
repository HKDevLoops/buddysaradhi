// Implements: 10_Security.md §6 (XSS-1 — a nonce-based, strict-dynamic CSP).
//
// Regression guard for docs/audit/DYNAMIC-WEB.md F-1.
//
// The edge serves every document under a PER-REQUEST CSP nonce. A page
// exported `force-static` is prerendered at build time, so its `<script>`
// tags carry no nonce — and with `strict-dynamic` the browser ignores the
// `'self'` allowlist and refuses every same-origin script. Measured live
// 2026-10-21: 29 of 30 script tags on /login had no nonce, 17 chunk requests
// failed with ERR_BLOCKED_BY_CSP, React never hydrated, and the sign-in form
// did nothing.
//
// The root layout reads `headers()` (for the nonce), so a route that does not
// force static rendering renders per request and carries the policy's nonce.
// This test needs no server: it pins that invariant directly.

import { describe, it, expect } from "vitest";

type PageModule = Record<string, unknown>;

const PAGE_MODULES: Array<[string, () => Promise<PageModule>]> = [
  ["(auth)/login", () => import("./login/page") as Promise<PageModule>],
  ["(auth)/signup", () => import("./signup/page") as Promise<PageModule>],
  ["(auth)/forgot-password", () => import("./forgot-password/page") as Promise<PageModule>],
  ["(auth)/reset-password", () => import("./reset-password/page") as Promise<PageModule>],
  ["(auth)/signup/provision", () => import("./signup/provision/page") as Promise<PageModule>],
];

describe("auth pages must not be prerendered (CSP nonce must match the document)", () => {
  for (const [name, load] of PAGE_MODULES) {
    it(`${name} is not exported as force-static`, async () => {
      const mod = await load();
      const dynamic = mod["dynamic"];
      expect(dynamic, `${name} exports dynamic="${String(dynamic)}"`).not.toBe("force-static");
    });
  }
});
