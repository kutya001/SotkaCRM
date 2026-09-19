import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/payments',
        destination: '/payouts',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
