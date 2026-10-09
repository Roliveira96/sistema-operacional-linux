import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  // SPEC-014 CA-08: only the engine adapter may import the legacy engine.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/engine/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@legacy-engine/*", "**/legacy/**"], message: "Import the engine through src/engine/ only." }] }],
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "coverage/**"] },
];

export default config;
