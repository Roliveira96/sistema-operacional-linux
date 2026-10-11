import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // SPEC-014: read-only legacy engine, used only by src/engine/.
      "@legacy-engine": path.resolve(import.meta.dirname, "../legacy/src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
    // SPEC-006: services, hooks and components must stay above 80% coverage.
    coverage: {
      provider: "v8",
      include: ["src/services/**", "src/hooks/**", "src/components/**", "src/lib/**", "src/engine/commands/**"],
      exclude: ["**/*.test.{ts,tsx}", "src/engine/commands/fixtures/**"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
