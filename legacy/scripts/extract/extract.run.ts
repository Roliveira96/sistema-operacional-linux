// Entry point of the extractor (SPEC-005). Run from legacy/ with:
//   npx vitest run --config vitest.extract.config.ts scripts/extract/extract.run.ts
// The clock is frozen and randomness is seeded, so two runs produce identical artifacts.
import { resolve } from 'node:path';
import { it, vi } from 'vitest';

const FROZEN_CLOCK = new Date('2026-01-01T12:00:00Z');

it('extracts the legacy content into the versioned artifacts', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'], now: FROZEN_CLOCK });
  // Legacy modules capture the boot time when they load (e.g. process start
  // times shown by "ps"), so they are imported only after the clock is frozen.
  const { buildAll } = await import('./build');
  const { writeArtifacts } = await import('./write');
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
