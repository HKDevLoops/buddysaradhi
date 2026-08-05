import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  experimental: {
    // TypeScript 7.x requires the CLI instead of the deprecated compiler API.
    // Ref: Next.js 16 + TS 7 compatibility note.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
