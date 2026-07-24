import type { NextConfig } from "next";

const csp: NextConfig["headers"] = () => [
  {
    source: "/:path*",
    headers: [
      { key: "Content-Security-Policy", value: [
        "default-src 'self'",
        // 'unsafe-inline' on script-src/style-src is for Next.js runtime + Tailwind only.
        // v1.x tightens this with nonces (10_Security.md §12.1).
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' https://*.supabase.co wss://*.turso.io https://*.turso.io",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
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
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return csp();
  },
};

export default nextConfig;
