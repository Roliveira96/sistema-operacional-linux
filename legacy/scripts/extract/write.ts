// Writes the three artifacts (SPEC-005 RN-09) deterministically. Gzip output
// has no timestamp in its header, so identical input gives identical bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { stableStringify, type BuildResult } from './build';
import { renderReport } from './report';

export const OUTPUT_DIR = '../backend/internal/modules/content/seed/data';

export function writeArtifacts(result: BuildResult, legacyRoot: string): string {
  const dir = resolve(legacyRoot, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  // Gzip keeps the repository small: the 236 full machine states take about 19 MB as plain JSON.
  writeFileSync(resolve(dir, 'content_manifest.json.gz'), gzipSync(stableStringify(result.manifest), { level: 9 }));
  writeFileSync(resolve(dir, 'content_report.md'), renderReport(result));
  // mtime 0 in the gzip header keeps the file reproducible.
  writeFileSync(resolve(dir, 'equivalence_fixtures.json.gz'), gzipSync(stableStringify(result.fixtures), { level: 9 }));
  return dir;
}
