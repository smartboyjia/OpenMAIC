import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['alipay-sdk', 'better-sqlite3'],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
