import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: [],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
