import type { NextConfig } from "next";

// Product surface: standalone deployment (buddysaradhi-product target,
// Root Directory = apps/product-page). No auth, no app routes, no proxy.
// Rule 11: this directory deploys to exactly one target, never the web app.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // TypeScript 7.x requires the CLI instead of the deprecated compiler API.
    // Same gate as apps/web (AGENTS.md FM-17: tsc --noEmit is the TS gate).
    useTypeScriptCli: true,
  },
  // NOTE: script-src uses 'unsafe-inline' (not nonces) ON PURPOSE.
  // Nonce-based CSP requires dynamic rendering (Next.js docs + vercel/next.js
  // #96063: static prerender has no request headers, so no nonce can be
  // injected and every script is blocked). This page is force-static with zero
  // user input, zero reflection, no cookies and no auth, so the XSS injection
  // surface is effectively none. All other directives stay locked down.
  async headers() {
    return [
      {
        source: "/:path*",
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
