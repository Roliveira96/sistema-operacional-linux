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

// SPEC-014 and SPEC-016: the frontend reuses the POSIX/VFS engine core and
// the terminal window of the prototype read-only. The
// alias points at src/engine/core; only src/engine/ may import it.
const monorepoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: monorepoRoot,
    // Exact aliases: src/engine/ imports only these two entry points of the engine.
    resolveAlias: {
      "@engine-core/linux/Serializador": "./src/engine/core/linux/Serializador.ts",
      "@engine-core/linux/Maquina": "./src/engine/core/linux/Maquina.ts",
      "@engine-core/linux/Pacotes": "./src/engine/core/linux/Pacotes.ts",
      "@engine-core/shell/Shell": "./src/engine/core/shell/Shell.ts",
      "@engine-core/shell/Saida": "./src/engine/core/shell/Saida.ts",
      "@engine-core/shell/comandos/Processos": "./src/engine/core/shell/comandos/Processos.ts",
      "@engine-core/terminal/JanelaDeTerminais": "./src/engine/core/terminal/JanelaDeTerminais.ts",
      "@engine-core/app/ArmazemDeMaquinas": "./src/engine/core/app/ArmazemDeMaquinas.ts",
      "@engine-core/app/ColaDeComandos": "./src/engine/core/app/ColaDeComandos.ts",
      "@engine-core/conteudo/CatalogoDeTopicos": "./src/engine/core/conteudo/CatalogoDeTopicos.ts",
      "@engine-core/estilos/terminal.css": "./src/engine/core/estilos/terminal.css",
    },
  },
  allowedDevOrigins,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl.replace(/\/$/, "")}/api/:path*` }];
  },
};

export default nextConfig;
