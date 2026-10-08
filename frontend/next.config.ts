import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps a single .env at the repository root. Next.js commands
// run from frontend/, and @next/env caches the first load, so force a reload.
loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", console, true);

// All /api traffic is proxied to the Go backend so the browser only talks to
// the frontend origin; this keeps SameSite=Strict session cookies working
// without CORS (SPEC-004).
const backendUrl = process.env.BACKEND_INTERNAL_URL;
if (!backendUrl) {
  throw new Error("BACKEND_INTERNAL_URL is required (see .env.example)");
}

// The dev server is opened from other machines by IP; Next.js blocks
// cross-origin dev resources unless the host is allowed explicitly.
const allowedDevOrigins = (process.env.FRONTEND_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl.replace(/\/$/, "")}/api/:path*` }];
  },
};

export default nextConfig;
