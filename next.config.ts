import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // firebase-admin pulls in optional native/gRPC deps that must stay on the
  // Node runtime rather than being traced into the client or edge bundles.
  serverExternalPackages: ["firebase-admin"],

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.twelvedata.com" },
      { protocol: "https", hostname: "**.twelvedata.com" },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default config;
