// Conversion report (SPEC-005 RN-09): counts, translation results and the
// equivalence proof of every practical question, in Portuguese because it is
// a document for the Tech Lead and the teacher.
import type { BuildResult } from './build';

export function renderReport(result: BuildResult): string {
  const { manifest, proofs, fixtures } = result;
  const blocks = manifest.modules.reduce((n, m) => n + m.blocks.length, 0);
  const practical = manifest.questions.filter((q) => q.kind === 'PRACTICAL');
  const theoretical = manifest.questions.filter((q) => q.kind !== 'PRACTICAL');
  const published = proofs.filter((p) => p.status === 'PUBLISHED');
  const drafts = proofs.filter((p) => p.status === 'DRAFT');
  const translated = proofs.filter((p) => p.translated);
  const withAlternatives = proofs.filter((p) => p.alternatives > 0);
  const altCount = proofs.reduce((n, p) => n + p.alternatives, 0);

  const lines = [
    '# Relatório de conversão do conteúdo legado',
    '',
    `Gerado pelo extrator da SPEC-005. Formato do manifesto: versão ${manifest.formatVersion}. Hash do conteúdo: \`${manifest.contentHash}\`.`,
    '',
    '## Contagens',
    '',
    '| Item | Quantidade |',
    '| :--- | ---: |',
    `| Módulos de ensino | ${manifest.modules.length} |`,
    `| Blocos | ${blocks} |`,
    `| Cenários (base e derivados) | ${manifest.scenarios.length} |`,
    `| Questões práticas | ${practical.length} |`,
    `| Questões teóricas (quiz) | ${theoretical.length} |`,
    `| Modelos de avaliação | ${manifest.assessmentTemplates.length} |`,
    `| Estados de máquina nas fixtures de equivalência | ${Object.keys(fixtures.snapshots).length} |`,
    '',
    '## Correções e prova de equivalência',
    '',
    '| Resultado | Quantidade |',
    '| :--- | ---: |',
    `| Correções traduzidas automaticamente | ${translated.length} de ${proofs.length} |`,
    `| Questões com formas alternativas testadas | ${withAlternatives.length} (${altCount} formas) |`,
    `| Cenários encadeados (desafios de tópico que dependem dos anteriores) | ${proofs.filter((p) => p.chained).length} |`,
    `| Questões publicadas (prova aprovada) | ${published.length} |`,
    `| Questões em rascunho (revisão pendente) | ${drafts.length} |`,
    '',
    '## Questões em rascunho',
    '',
  ];
  if (drafts.length === 0) {
    lines.push('Nenhuma.');
  } else {
    lines.push('| Questão | Origem | Motivos |', '| :--- | :--- | :--- |');
    for (const d of drafts) {
      const reasons = d.reasons.map((r) => r.replace(/\|/g, '\\|').replace(/\s+/g, ' ')).join('<br>');
      lines.push(`| \`${d.sourceKey}\` | \`${d.origin}\` | ${reasons} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
