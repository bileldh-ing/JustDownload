import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  // Next.js inlines a small bootstrap; the theme boot script is inline too.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // Browser talks to the worker directly only for signed uploads, downloads and progress events.
  `connect-src 'self'${process.env.NEXT_PUBLIC_WORKER_PUBLIC_URL ? ` ${process.env.NEXT_PUBLIC_WORKER_PUBLIC_URL}` : ""}`,
  "media-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@justdownload/core"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default config;
