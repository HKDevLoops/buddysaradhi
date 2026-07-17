import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['172.23.224.1', 'localhost', '127.0.0.1'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
