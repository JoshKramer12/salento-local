import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  allowedDevOrigins: [
    "*.lhr.life",
    "*.localhost.run",
    "*.loca.lt",
    "*.trycloudflare.com",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "*.lhr.life",
        "*.localhost.run",
        "*.loca.lt",
        "*.trycloudflare.com",
      ],
    },
  },
  serverExternalPackages: [
    "@auth/prisma-adapter",
    "@prisma/client",
    "bcryptjs",
    "nodemailer",
    "resend",
    "stripe",
  ],
  async headers() {
    return [
      {
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(), payment=()",
          },
        ],
        source: "/(.*)",
      },
    ];
  },
};

export default nextConfig;
