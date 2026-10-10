// Builds the content manifest, the conversion report and the equivalence
// fixtures from the legacy content (SPEC-005). Read-only over legacy/.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogoDeTopicos } from '../../src/conteudo/CatalogoDeTopicos';
import type { Desafio, Licao, ModalidadeSimulado, NivelDificuldade, Passo, QuestaoQuiz, Topico } from '../../src/conteudo/Topico';
import type { Maquina } from '../../src/linux/Maquina';
import type { MaquinaJson } from '../../src/linux/Serializador';
import { evaluate, type Condition } from './catalog';
import { convertConcepts } from './concepts';
import { newMachine, prepareBase, runCommands, runSteps, scenarioMachine, seededRandom, snapshot, type Origin } from './execute';
import { htmlToText, sanitizeHtml } from './sanitize';
import { suggestConditions } from './suggest';
import { translateVerifier } from './translate';

export const FORMAT_VERSION = 1;
const SIMULADO_DURATION_MINUTES = 30;
const SIMULADO_MAX_SCORE = 10;

// ───────────── manifest types ─────────────

export interface StepJson {
  command: string;
  explanation?: string;
  terminal: number;
  login?: { user: string; password: string };
  answers?: string[];
}

export interface BlockJson {
  sourceKey: string;
  type: 'TEXT' | 'COMMAND' | 'TIP' | 'CURIOSITY' | 'STEP_BY_STEP' | 'CARDS' | 'WIDGET' | 'LEGACY_HTML';
  payload: Record<string, unknown>;
}

export interface ModuleJson {
  sourceKey: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  displayOrder: number;
  visibility: 'PUBLIC' | 'AUTHENTICATED';
  blocks: BlockJson[];
}

export interface ScenarioJson {
  sourceKey: string;
  baseSourceKey?: string;
  snapshot: MaquinaJson;
}

export interface QuestionJson {
  sourceKey: string;
  moduleSourceKey: string;
  kind: 'PRACTICAL' | 'THEORETICAL_SINGLE';
  usage: 'EXERCISE' | 'ASSESSMENT';
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  status: 'DRAFT' | 'PUBLISHED';
  title: string;
  statement: string;
  hint?: string;
  explanation?: string;
  scenarioSourceKey?: string;
  referenceSolution?: StepJson[];
  validationConditions?: Condition[];
  choices?: string[];
  answerKey?: { correct: number };
  tags?: string[];
  position: number;
}

export interface TemplateJson {
  sourceKey: string;
  title: string;
  description: string;
  durationMinutes: number;
  maxScore: number;
  questions: Array<{ questionSourceKey: string; position: number; weight: number }>;
}

export interface Manifest {
  formatVersion: number;
  generatedFrom: string;
  contentHash: string;
  modules: ModuleJson[];
  scenarios: ScenarioJson[];
  questions: QuestionJson[];
  assessmentTemplates: TemplateJson[];
}

export interface FixtureCase {
  label: string;
  snapshotHash: string;
  expected: boolean;
}

export interface Fixtures {
  formatVersion: number;
  snapshots: Record<string, MaquinaJson>;
  questions: Array<{ sourceKey: string; conditions: Condition[]; cases: FixtureCase[] }>;
}

export interface ProofResult {
  sourceKey: string;
  origin: string;
  status: 'DRAFT' | 'PUBLISHED';
  translated: boolean;
  /** The scenario replays the earlier challenges of the topic. */
  chained: boolean;
  alternatives: number;
  reasons: string[];
}

export interface BuildResult {
  manifest: Manifest;
  fixtures: Fixtures;
  proofs: ProofResult[];
}

// ───────────── helpers ─────────────

/** JSON with sorted keys, so artifacts are byte-for-byte reproducible. */
export function stableStringify(value: unknown, indent = 0): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Runs fn with Math.random seeded from key, so each question is independent of build order. */
async function seeded<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const original = Math.random;
  Math.random = seededRandom(fnv(key));
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

const DIFFICULTY: Record<NivelDificuldade, QuestionJson['difficulty']> = { facil: 'EASY', medio: 'MEDIUM', dificil: 'HARD' };
const difficulty = (n?: NivelDificuldade): QuestionJson['difficulty'] => (n ? DIFFICULTY[n] : 'MEDIUM');

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function steps(list: Passo[]): StepJson[] {
  return list.map((p) => ({
    command: p.comando,
    ...(p.explicacao ? { explanation: p.explicacao } : {}),
    terminal: p.terminal ?? 1,
    ...(p.login ? { login: { user: p.login.usuario, password: p.login.senha } } : {}),
    ...(p.respostas?.length ? { answers: p.respostas } : {}),
  }));
}

function titleOf(statement: string): string {
  const text = htmlToText(statement);
  return text.length <= 90 ? text : text.slice(0, 87).trimEnd() + '…';
}

// ───────────── modules and blocks (RN-02) ─────────────

function lessonBlocks(topicId: string, index: number, l: Licao): BlockJson[] {
  const key = `${topicId}/lesson-${index + 1}`;
  const blocks: BlockJson[] = [
    {
      sourceKey: `${key}/text`,
      type: 'TEXT',
      payload: {
        title: l.titulo,
        command: l.comando,
        html: sanitizeHtml(`<p>${l.descricao}</p><pre><code>${escapeHtml(l.sintaxe)}</code></pre>`),
      },
    },
  ];
  if (l.opcoes?.length) {
    const rows = l.opcoes.map(([opt, desc]) => `<tr><td><code>${escapeHtml(opt)}</code></td><td>${desc}</td></tr>`).join('');
    blocks.push({
      sourceKey: `${key}/options`,
      type: 'TEXT',
      payload: { html: sanitizeHtml(`<table><thead><tr><th>Opção</th><th>O que faz</th></tr></thead><tbody>${rows}</tbody></table>`) },
    });
  }
  if (l.exemplos.length) blocks.push({ sourceKey: `${key}/examples`, type: 'COMMAND', payload: { steps: steps(l.exemplos) } });
  if (l.dicas?.length) {
    blocks.push({
      sourceKey: `${key}/tips`,
      type: 'TIP',
      payload: { variant: 'DEFAULT', html: sanitizeHtml('<ul>' + l.dicas.map((d) => `<li>${d}</li>`).join('') + '</ul>') },
    });
  }
  if (l.naPratica) {
    blocks.push({ sourceKey: `${key}/real-life`, type: 'CURIOSITY', payload: { title: 'Na vida real', html: sanitizeHtml(l.naPratica) } });
  }
  if (l.pegadinha) {
    blocks.push({ sourceKey: `${key}/pitfall`, type: 'TIP', payload: { variant: 'WARNING', title: 'Cai na prova', html: sanitizeHtml(l.pegadinha) } });
  }
  if (l.extra) {
    const component = l.extra === 'calculadora-permissoes' ? 'PERMISSION_CALCULATOR' : 'LS_ANATOMY';
    blocks.push({ sourceKey: `${key}/widget`, type: 'WIDGET', payload: { component, params: {} } });
  }
  return blocks;
}

function moduleOf(topic: Topico, isSimulado: boolean): ModuleJson {
  const blocks: BlockJson[] = [];
  // The concepts become cards of the platform (SPEC-005 RN-02): one per h3, with tips and tables as blocks.
  if (topic.conceitos.trim()) blocks.push(...convertConcepts(topic.id, sanitizeHtml(topic.conceitos)));
  if (topic.naPratica) {
    blocks.push({ sourceKey: `${topic.id}/real-life`, type: 'CURIOSITY', payload: { title: 'Na vida real', html: sanitizeHtml(topic.naPratica) } });
  }
  if (topic.demonstracao?.length) {
    // The demonstration is a card of its own, so it does not stick to the last concept card.
    blocks.push({ sourceKey: `${topic.id}/demo-card`, type: 'TEXT', payload: { title: 'Veja na prática', command: 'demonstração', html: '' } });
    blocks.push({ sourceKey: `${topic.id}/demo`, type: 'COMMAND', payload: { steps: steps(topic.demonstracao) } });
  }
  topic.licoes.forEach((l, i) => blocks.push(...lessonBlocks(topic.id, i, l)));
  return {
    sourceKey: topic.id,
    title: topic.titulo,
    description: [topic.subtitulo, topic.resumo].filter(Boolean).join(' — '),
    icon: topic.icone,
    color: topic.cor,
    displayOrder: topic.numero,
    visibility: isSimulado ? 'AUTHENTICATED' : 'PUBLIC',
    blocks,
  };
}

// ───────────── alternative solutions (read from the frozen legacy test) ─────────────

interface AlternativeCase {
  id: string;
  alternativas: Array<{ nome: string; comandos: string[] }>;
}

/** Reads CASOS_ALTERNATIVOS as data from the legacy test file, without executing the test. */
export function loadAlternatives(legacyRoot: string): Map<string, AlternativeCase['alternativas']> {
  const source = readFileSync(resolve(legacyRoot, 'tests/simulado_formas_alternativas.test.ts'), 'utf8');
  const start = source.indexOf('export const CASOS_ALTERNATIVOS');
  const open = source.indexOf('[', source.indexOf('=', start));
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === '[') depth += 1;
    if (source[end] === ']') depth -= 1;
    if (depth === 0) break;
  }
  // The literal is plain data (strings, arrays, objects); evaluate it as such.
  const cases = new Function(`return ${source.slice(open, end + 1)};`)() as AlternativeCase[];
  return new Map(cases.map((c) => [c.id, c.alternativas]));
}

// ───────────── practical questions and equivalence proof (RN-04 to RN-07) ─────────────

interface PracticalInput {
  challenge: Desafio;
  origin: Origin;
  originKey: string;
  moduleKey: string;
  usage: QuestionJson['usage'];
  position: number;
  /** Earlier challenges of the same topic, used when the question depends on them. */
  previous: Desafio[];
}

async function practical(
  input: PracticalInput,
  alternatives: Map<string, AlternativeCase['alternativas']>,
  fixtures: Fixtures,
): Promise<{ question: QuestionJson; scenario: ScenarioJson; proof: ProofResult }> {
  const { challenge: d, origin } = input;
  const reasons: string[] = [];

  let previous: Desafio[] = [];
  const runState = async (label: string, mutate?: (m: Maquina) => Promise<void>) =>
    seeded(`${d.id}/${label}`, async () => {
      const m = await scenarioMachine(origin, d, previous);
      if (mutate) await mutate(m);
      return { snapshot: snapshot(m), original: d.verificar(m) };
    });

  let untouched = await runState('scenario');
  let reference = await runState('reference', (m) => runSteps(m, d.solucao));
  let chained = false;
  if (!reference.original && input.previous.length > 0) {
    // In the legacy topic flow all challenges share one machine; replay the earlier ones.
    previous = input.previous;
    chained = true;
    untouched = await runState('scenario');
    reference = await runState('reference', (m) => runSteps(m, d.solucao));
  }
  const alts = alternatives.get(d.id) ?? [];
  const altStates = [];
  for (const alt of alts) altStates.push({ name: alt.nome, ...(await runState(`alt/${alt.nome}`, (m) => runCommands(m, alt.comandos))) });

  if (untouched.original) reasons.push('the untouched scenario already passes the original verifier');
  if (!reference.original) reasons.push('the reference solution fails the original verifier in an isolated scenario');
  altStates.filter((a) => !a.original).forEach((a) => reasons.push(`alternative "${a.name}" fails the original verifier`));

  const translation = translateVerifier(d.verificar.toString());
  const translated = translation.untranslated.length === 0 && translation.conditions.length > 0;
  let conditions = translation.conditions;
  if (!translated) {
    reasons.push('verifier not translatable: ' + translation.untranslated.map((t) => t.replace(/__vite_ssr_import_\d+__\./g, '')).join(' && '));
    conditions = suggestConditions(untouched.snapshot, reference.snapshot);
    if (conditions.length === 0) reasons.push('no suggestion could be derived from the reference solution');
  }

  const states = [
    { label: 'scenario', ...untouched },
    { label: 'reference', ...reference },
    ...altStates.map((a) => ({ label: `alternative: ${a.name}`, snapshot: a.snapshot, original: a.original })),
  ];
  const cases: FixtureCase[] = [];
  for (const st of states) {
    const verdict = conditions.length > 0 && evaluate(st.snapshot, conditions).passed;
    if (translated && verdict !== st.original) reasons.push(`conditions decide ${verdict} but the original verifier decides ${st.original} on ${st.label}`);
    const hash = sha256(stableStringify(st.snapshot));
    fixtures.snapshots[hash] = st.snapshot;
    cases.push({ label: st.label, snapshotHash: hash, expected: verdict });
  }
  if (conditions.length > 0) fixtures.questions.push({ sourceKey: d.id, conditions, cases });

  const status: QuestionJson['status'] = reasons.length === 0 ? 'PUBLISHED' : 'DRAFT';
  const scenarioKey = `scenario/question/${d.id}`;
  return {
    question: {
      sourceKey: d.id,
      moduleSourceKey: input.moduleKey,
      kind: 'PRACTICAL',
      usage: input.usage,
      difficulty: difficulty(d.nivel),
      status,
      title: titleOf(d.enunciado),
      statement: sanitizeHtml(d.enunciado),
      hint: sanitizeHtml(d.dica),
      scenarioSourceKey: scenarioKey,
      referenceSolution: steps(d.solucao),
      ...(conditions.length ? { validationConditions: conditions } : {}),
      position: input.position,
    },
    scenario: { sourceKey: scenarioKey, baseSourceKey: input.originKey, snapshot: untouched.snapshot },
    proof: { sourceKey: d.id, origin: input.originKey, status, translated, chained, alternatives: alts.length, reasons },
  };
}

function quizQuestion(q: QuestaoQuiz, moduleKey: string, position: number): QuestionJson {
  return {
    sourceKey: q.id,
    moduleSourceKey: moduleKey,
    kind: 'THEORETICAL_SINGLE',
    usage: 'ASSESSMENT',
    difficulty: difficulty(q.nivel),
    status: 'PUBLISHED',
    title: titleOf(q.pergunta),
    statement: sanitizeHtml(q.pergunta),
    explanation: sanitizeHtml(q.explicacao),
    choices: q.opcoes.map((o) => sanitizeHtml(o)),
    answerKey: { correct: q.correta },
    tags: [q.certificacao],
    position,
  };
}

// ───────────── entry point ─────────────

export async function buildAll(legacyRoot: string): Promise<BuildResult> {
  const topics = new CatalogoDeTopicos().listar();
  const alternatives = loadAlternatives(legacyRoot);
  const fixtures: Fixtures = { formatVersion: FORMAT_VERSION, snapshots: {}, questions: [] };
  const modules: ModuleJson[] = [];
  const scenarios: ScenarioJson[] = [];
  const questions: QuestionJson[] = [];
  const templates: TemplateJson[] = [];
  const proofs: ProofResult[] = [];
  const seen = new Set<string>();
  const positions = new Map<string, number>();
  const nextPosition = (moduleKey: string): number => {
    const n = (positions.get(moduleKey) ?? 0) + 1;
    positions.set(moduleKey, n);
    return n;
  };
  const unique = (id: string) => {
    if (seen.has(id)) throw new Error(`duplicate legacy id: ${id}`);
    seen.add(id);
  };

  const baseScenario = async (key: string, origin: Origin) =>
    seeded(key, () => {
      const m = newMachine();
      prepareBase(m, origin);
      return { sourceKey: key, snapshot: snapshot(m) } satisfies ScenarioJson;
    });

  for (const topic of topics) {
    const isSimulado = (topic.modalidades?.length ?? 0) > 0;
    modules.push(moduleOf(topic, isSimulado));

    // The simulado topic repeats the "escola" modality in its own list; its
    // questions come from the modalities only.
    if (topic.desafios.length && !isSimulado) {
      const origin: Origin = { kind: 'topic', topic };
      const key = `scenario/topic/${topic.id}`;
      scenarios.push(await baseScenario(key, origin));
      for (const [i, d] of topic.desafios.entries()) {
        unique(d.id);
        const r = await practical(
          { challenge: d, origin, originKey: key, moduleKey: topic.id, usage: 'EXERCISE', position: nextPosition(topic.id), previous: topic.desafios.slice(0, i) },
          alternatives,
          fixtures,
        );
        questions.push(r.question);
        scenarios.push(r.scenario);
        proofs.push(r.proof);
      }
    }

    for (const modality of topic.modalidades ?? []) {
      const tpl: TemplateJson = {
        sourceKey: `simulado/${modality.id}`,
        title: modality.titulo,
        description: [modality.badge, modality.descricao].filter(Boolean).join(' — '),
        durationMinutes: SIMULADO_DURATION_MINUTES,
        maxScore: SIMULADO_MAX_SCORE,
        questions: [],
      };
      if (modality.desafios?.length) {
        const origin: Origin = { kind: 'modality', modality: modality as ModalidadeSimulado };
        const key = `scenario/simulado/${modality.id}`;
        scenarios.push(await baseScenario(key, origin));
        for (const [i, d] of modality.desafios.entries()) {
          unique(d.id);
          const r = await practical(
            { challenge: d, origin, originKey: key, moduleKey: topic.id, usage: 'ASSESSMENT', position: nextPosition(topic.id), previous: [] },
            alternatives,
            fixtures,
          );
          questions.push(r.question);
          scenarios.push(r.scenario);
          proofs.push(r.proof);
          tpl.questions.push({ questionSourceKey: d.id, position: i + 1, weight: 1 });
        }
      }
      for (const [i, q] of (modality.questoes ?? []).entries()) {
        unique(q.id);
        questions.push(quizQuestion(q, topic.id, nextPosition(topic.id)));
        tpl.questions.push({ questionSourceKey: q.id, position: i + 1, weight: 1 });
      }
      templates.push(tpl);
    }
  }

  const body = { modules, scenarios, questions, assessmentTemplates: templates };
  const manifest: Manifest = {
    formatVersion: FORMAT_VERSION,
    generatedFrom: 'legacy/src/conteudo',
    contentHash: sha256(stableStringify(body)),
    ...body,
  };
  return { manifest, fixtures, proofs };
}
