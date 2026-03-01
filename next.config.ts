import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  basePath: '/tools/brainflow',
  outputFileTracingRoot: path.join(__dirname, './'),
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'i0.hdslb.com' },
      { protocol: 'http', hostname: 'i1.hdslb.com' },
      { protocol: 'http', hostname: 'i2.hdslb.com' }
    ]
  }
};

export default nextConfig;
