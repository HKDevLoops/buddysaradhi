import type { NextConfig } from "next";

const csp: NextConfig["headers"] = () => [
  {
    source: "/:path*",
    headers: [
      { key: "Content-Security-Policy", value: [
        "default-src 'self'",
        // Nonce-based CSP is enforced per-request by the middleware for HTML pages.
        // This static CSP serves API routes and static file responses as a safety net.
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://*.supabase.co",
        "connect-src 'self' https://*.supabase.co wss://*.turso.io https://*.turso.io https://*.turso.ai https://api.buddysaradhi.app",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
      ].join("; ") },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), interest-cohort=()" },
    ],
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.23.224.1", "localhost", "127.0.0.1"],
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    // TypeScript 7.x requires the CLI instead of the deprecated compiler API.
    // Ref: Next.js 16 + TS 7 compatibility note.
    useTypeScriptCli: true,
  },
  async headers() {
    return csp();
  },
  async redirects() {
    return [
      { source: "/landing", destination: "/", permanent: true },
      { source: "/dpa", destination: "/", permanent: true },
      { source: "/faq", destination: "/", permanent: true },
      { source: "/privacy", destination: "/", permanent: true },
      { source: "/terms", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
