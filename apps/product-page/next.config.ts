import type { NextConfig } from "next";

// Product surface: standalone deployment (buddysaradhi-product target,
// Root Directory = apps/product-page). Rule 11: this directory deploys to
// exactly one target, never the web app.
//
// TWO POLICIES, ON PURPOSE. Read this before "simplifying" it to one.
//
// 1. THE MARKETING PAGES (`/:path*` minus `/admin`). Fully prerendered, zero
//    user input, zero reflection, no cookie. `script-src` keeps
//    `'unsafe-inline'` because Next.js 16 inlines the RSC flight payload as
//    `self.__next_f.push(...)` scripts whose content depends on the page (12
//    inline scripts on `/`), so their sha256 hashes are per-payload and
//    cannot be allowlisted. MEASURED: with `script-src 'self'` and no nonce,
//    Chrome refuses all 12 and the page never hydrates.
//
//    The earlier comment here said "no cookies and no auth". That became
//    FALSE when `/admin` was added, and a stale security justification is
//    worse than none - so the console has its own, stricter policy and this
//    one no longer covers it.
//
// 2. THE CONSOLE (`/admin/*`). Dynamic, cookie-bearing, renders text a
//    VISITOR typed. It gets a nonce-based policy with no `'unsafe-inline'`,
//    set by `src/proxy.ts`. `next.config.ts` deliberately does NOT match
//    `/admin`, so the two policies never overlap and their precedence is
//    never in question.
//
// `style-src` keeps `'unsafe-inline'` on both: React writes `style="..."`
// attributes, and `style-src` governs style ATTRIBUTES as well as `<style>`
// elements.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // TypeScript 7.x requires the CLI instead of the deprecated compiler API.
    // Same gate as apps/web (AGENTS.md FM-17: tsc --noEmit is the TS gate).
    useTypeScriptCli: true,
  },
  async headers() {
    return [
      {
        source: "/((?!admin).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "img-src 'self' data: blob:",
              "connect-src 'self' https://api.buddysaradhi.app",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
