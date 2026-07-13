import type { NextConfig } from "next";

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");
const MEDIA_HOST = process.env.NEXT_PUBLIC_MEDIA_ORIGIN
  ? new URL(process.env.NEXT_PUBLIC_MEDIA_ORIGIN).hostname
  : null;

const nextConfig: NextConfig = {
  output: "standalone",
  staticPageGenerationTimeout: 300,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cravatar.cn",
      },
      {
        protocol: "https",
        hostname: "cravatar.com",
      },
      {
        protocol: "https",
        hostname: "cn.cravatar.com",
      },
      {
        protocol: "https",
        hostname: "api.dicebear.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "kanle.net",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "4000",
      },
      ...(MEDIA_HOST ? [{ protocol: "https" as const, hostname: MEDIA_HOST }] : []),
    ],
  },
  async redirects() {
    return [
      {
        source: "/post/:id",
        destination: "/moments/:id",
        permanent: true,
      },
      {
        source: "/profile",
        destination: "/archives",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/api/:path*",
          destination: `${BACKEND_URL}/api/:path*`,
        },
        {
          source: "/uploads/:path*",
          destination: `${BACKEND_URL}/uploads/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
