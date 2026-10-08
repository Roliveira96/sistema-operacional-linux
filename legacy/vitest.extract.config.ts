import { defineConfig } from 'vitest/config';

// Content extractor (SPEC-005). Runs only the files under scripts/extract and
// never the legacy test suite, which stays frozen.
export default defineConfig({
  test: {
    include: ['scripts/extract/**/*.test.ts', 'scripts/extract/**/*.run.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
