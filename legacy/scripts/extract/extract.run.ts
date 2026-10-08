// Entry point of the extractor (SPEC-005). Run from legacy/ with:
//   npx vitest run --config vitest.extract.config.ts scripts/extract/extract.run.ts
// The clock is frozen and randomness is seeded, so two runs produce identical artifacts.
import { resolve } from 'node:path';
import { it, vi } from 'vitest';
import { buildAll } from './build';
import { writeArtifacts } from './write';

const FROZEN_CLOCK = new Date('2026-01-01T12:00:00Z');

it('extracts the legacy content into the versioned artifacts', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'], now: FROZEN_CLOCK });
  const legacyRoot = resolve(import.meta.dirname, '../..');
  const result = await buildAll(legacyRoot);
  const dir = writeArtifacts(result, legacyRoot);
  const drafts = result.proofs.filter((p) => p.status === 'DRAFT').length;
  process.stdout.write(
    `\n[extract] ${result.manifest.modules.length} modules, ${result.manifest.questions.length} questions, ` +
      `${result.proofs.length - drafts} published, ${drafts} draft -> ${dir}\n`,
  );
  vi.useRealTimers();
});
