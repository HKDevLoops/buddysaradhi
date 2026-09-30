import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// F-3 (reviews/verification-production-readiness-report-2026-09-29.md §F-3)
// webkit + "Mobile Safari" hung at login waitForURL while chromium +
// "Mobile Chrome" were green against the same server and credentials.
//
// Root cause: `apps/web/next.config.ts:22` emits
// `Content-Security-Policy: ... upgrade-insecure-requests` on every response.
// That directive is a no-op in production (origin is already https), but the E2E
// harness serves the production build over plain http, so the W3C
// upgrade-insecure-requests spec (§4.1 "if scheme is http, set scheme to https";
// §1.2.3 "Failed Upgrade — there is no fallback") forces the browser to rewrite
// every same-origin http subresource URL to https. The local server speaks no
// TLS, so every JS/CSS/font fetch dies with `SSL connect error`, React never
// hydrates, and the Sign In click falls through to a NATIVE form GET
// (`/login?`) which is upgraded and fails identically — a silent dead button.
// No app handler ever runs (`defaultPrevented=false`), which is why there is no
// error text anywhere in the DOM.
//
// Chromium spares loopback ("potentially trustworthy") origins from the upgrade;
// WebKit implements the spec literally. Stripping ONLY that one directive makes
// the plain-http test origin behave exactly like the https production origin.
// The rest of the CSP (nonce, strict-dynamic, connect-src, form-action, ...) and
// the HSTS header stay enforced, so nothing real is being bypassed, and the
// helper is a no-op against an https origin — it cannot mask a production bug.
// ---------------------------------------------------------------------------
const UPGRADE_DIRECTIVE = /;?\s*upgrade-insecure-requests\b/gi;

/** Call once per page before the first goto in every e2e authenticate(). */
export async function neutralizePlainHttpUpgrade(page: Page): Promise<void> {
  await page.route(
    (url) => url.protocol === "http:" && !url.pathname.startsWith("/_next/"),
    async (route) => {
      if (route.request().resourceType() !== "document") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const headers = { ...response.headers() };
      const csp = headers["content-security-policy"];
      if (csp) headers["content-security-policy"] = csp.replace(UPGRADE_DIRECTIVE, "");
      await route.fulfill({ response, headers });
    },
  );
}
