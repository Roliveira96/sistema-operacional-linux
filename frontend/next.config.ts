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

// SPEC-014 and SPEC-016: the frontend reuses, read-only, the legacy POSIX/VFS
// engine, the prototype terminal window, its cheat sheet and its styles. The
// aliases point at legacy/src; only src/engine/ may import them.
const monorepoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: monorepoRoot,
    // Exact aliases: the only entry points src/engine/ imports.
    resolveAlias: {
      "@legacy-engine/linux/Maquina": "../legacy/src/linux/Maquina.ts",
      "@legacy-engine/linux/Serializador": "../legacy/src/linux/Serializador.ts",
      "@legacy-engine/terminal/JanelaDeTerminais": "../legacy/src/terminal/JanelaDeTerminais.ts",
      "@legacy-engine/app/ArmazemDeMaquinas": "../legacy/src/app/ArmazemDeMaquinas.ts",
      "@legacy-engine/app/ColaDeComandos": "../legacy/src/app/ColaDeComandos.ts",
      "@legacy-engine/conteudo/CatalogoDeTopicos": "../legacy/src/conteudo/CatalogoDeTopicos.ts",
      "@legacy-engine/estilos/terminal.css": "../legacy/src/estilos/terminal.css",
      "@legacy-engine/estilos/topico.css": "../legacy/src/estilos/topico.css",
    },
  },
  allowedDevOrigins,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl.replace(/\/$/, "")}/api/:path*` }];
  },
};

export default nextConfig;
