// Automatic translation of legacy verifier functions into declarative
// conditions (SPEC-005 RN-05). The function source is read at runtime and
// split into the top-level "&&" terms; each term must match a known idiom of
// legacy/src/conteudo/Verificar.ts (or of the package and service helpers).
// Anything else makes the translation fail, and the question falls back to a
// suggestion and DRAFT status. The equivalence proof checks every result.
import { CATALOGO } from '../../src/linux/Pacotes';
import type { Condition } from './catalog';

export interface Translation {
  conditions: Condition[];
  /** Terms that could not be translated; empty when the translation is complete. */
  untranslated: string[];
}

// A string or number literal as printed by the transform (single, double or
// back quotes; decimal or 0o octal numbers).
const STR = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60(?:[^\x60\\$]|\\.)*\x60)`;
const NUM = String.raw`(0o[0-7]+|\d+)`;
// Optional module prefix added by the bundler, e.g. "__vite_ssr_import_0__.".
const P = String.raw`(?:[\w$]+\.)?`;
const M = String.raw`\w+`;

function str(literal: string): string {
  if (literal.startsWith('`')) return literal.slice(1, -1).replace(/\\(.)/g, '$1');
  // Double- and single-quoted JS literals; convert single quotes to JSON.
  if (literal.startsWith("'")) {
    return JSON.parse('"' + literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"') as string;
  }
  return JSON.parse(literal) as string;
}

function octal(numeric: string): string {
  const n = numeric.startsWith('0o') ? parseInt(numeric.slice(2), 8) : parseInt(numeric, 10);
  return n.toString(8).padStart(3, '0');
}

type Rule = [RegExp, (g: string[]) => Condition];

const call = (name: string, args: string): string => String.raw`${P}Verificar\.${name}\(${M},\s*${args}\)`;
const rx = (source: string): RegExp => new RegExp('^' + source + '$');

const RULES: Rule[] = [
  [rx(call('diretorio', STR)), (g) => ({ type: 'DIRECTORY_EXISTS', path: str(g[1]!) })],
  [rx(call('arquivo', STR)), (g) => ({ type: 'FILE_EXISTS', path: str(g[1]!) })],
  [rx(call('link', STR)), (g) => ({ type: 'SYMLINK', path: str(g[1]!) })],
  [rx(call('linkAlvo', `${STR},\\s*${STR}`)), (g) => ({ type: 'SYMLINK', path: str(g[1]!), target: str(g[2]!) })],
  [rx(call('naoExiste', STR)), (g) => ({ type: 'PATH_ABSENT', path: str(g[1]!) })],
  [rx('!' + call('naoExiste', STR)), (g) => ({ type: 'NODE_EXISTS', path: str(g[1]!) })],
  [rx(call('contem', `${STR},\\s*${STR}`)), (g) => ({ type: 'CONTENT_CONTAINS', path: str(g[1]!), value: str(g[2]!) })],
  [rx(call('modo', `${STR},\\s*${NUM}`)), (g) => ({ type: 'PERMISSION_MODE', path: str(g[1]!), mode: octal(g[2]!), includeSpecialBits: false })],
  [rx(call('dono', `${STR},\\s*${STR}`)), (g) => ({ type: 'OWNER', path: str(g[1]!), user: str(g[2]!) })],
  [rx(call('dono', `${STR},\\s*${STR},\\s*${STR}`)), (g) => ({ type: 'OWNER', path: str(g[1]!), user: str(g[2]!), group: str(g[3]!) })],
  [rx(call('grupoDoNo', `${STR},\\s*${STR}`)), (g) => ({ type: 'GROUP_OWNER', path: str(g[1]!), group: str(g[2]!) })],
  [rx(call('membro', `${STR},\\s*${STR}`)), (g) => ({ type: 'USER_IN_GROUP', user: str(g[1]!), group: str(g[2]!) })],
  [rx(call('vazio', STR)), (g) => ({ type: 'DIRECTORY_EMPTY', path: str(g[1]!) })],
  [rx(call('usuario', STR) + String.raw`\s*!==?\s*(?:undefined|null)`), (g) => ({ type: 'USER_EXISTS', user: str(g[1]!) })],
  [rx('!!' + call('usuario', STR)), (g) => ({ type: 'USER_EXISTS', user: str(g[1]!) })],
  [rx(call('usuario', STR)), (g) => ({ type: 'USER_EXISTS', user: str(g[1]!) })],
  [rx(call('usuario', STR) + String.raw`\s*===?\s*(?:undefined|null)`), (g) => ({ type: 'USER_ABSENT', user: str(g[1]!) })],
  [rx('!' + call('usuario', STR)), (g) => ({ type: 'USER_ABSENT', user: str(g[1]!) })],
  [rx(call('grupo', STR) + String.raw`\s*!==?\s*(?:undefined|null)`), (g) => ({ type: 'GROUP_EXISTS', group: str(g[1]!) })],
  [rx('!!' + call('grupo', STR)), (g) => ({ type: 'GROUP_EXISTS', group: str(g[1]!) })],
  [rx(call('grupo', STR)), (g) => ({ type: 'GROUP_EXISTS', group: str(g[1]!) })],
  [rx(call('grupo', STR) + String.raw`\s*===?\s*(?:undefined|null)`), (g) => ({ type: 'GROUP_ABSENT', group: str(g[1]!) })],
  [rx('!' + call('grupo', STR)), (g) => ({ type: 'GROUP_ABSENT', group: str(g[1]!) })],
  [rx(call('no', STR) + String.raw`\s*!==?\s*null`), (g) => ({ type: 'NODE_EXISTS', path: str(g[1]!) })],
  [rx(call('no', STR) + String.raw`\s*===?\s*null`), (g) => ({ type: 'PATH_ABSENT', path: str(g[1]!) })],
  [rx(call('no', STR) + String.raw`\?\.modo\s*===\s*${NUM}`), (g) => ({ type: 'PERMISSION_MODE', path: str(g[1]!), mode: octal(g[2]!), includeSpecialBits: true })],
  [rx(call('usuario', STR) + String.raw`\?\.shell\s*===\s*${STR}`), (g) => ({ type: 'USER_ATTRIBUTE', user: str(g[1]!), field: 'SHELL', value: str(g[2]!) })],
  [rx(call('usuario', STR) + String.raw`\?\.home\s*===\s*${STR}`), (g) => ({ type: 'USER_ATTRIBUTE', user: str(g[1]!), field: 'HOME', value: str(g[2]!) })],
  [rx(call('usuario', STR) + String.raw`\?\.comentario\s*===\s*${STR}`), (g) => ({ type: 'USER_ATTRIBUTE', user: str(g[1]!), field: 'COMMENT', value: str(g[2]!) })],
  [rx(call('usuario', STR) + String.raw`\?\.uid\s*===\s*${NUM}`), (g) => ({ type: 'USER_ATTRIBUTE', user: str(g[1]!), field: 'UID', value: String(parseInt(g[2]!, 10)) })],
  [rx(call('usuario', STR) + String.raw`\?\.bloqueado\s*===\s*(true|false)`), (g) => ({ type: 'USER_LOCKED', user: str(g[1]!), locked: g[2] === 'true' })],
  [rx(call('usuario', STR) + String.raw`\?\.bloqueado`), (g) => ({ type: 'USER_LOCKED', user: str(g[1]!), locked: true })],
  [rx('!' + call('usuario', STR) + String.raw`\?\.bloqueado`), (g) => ({ type: 'USER_LOCKED', user: str(g[1]!), locked: false })],
  [rx(call('usuario', STR) + String.raw`\?\.senha\s*!==?\s*null`), (g) => ({ type: 'USER_PASSWORD_SET', user: str(g[1]!) })],
  [rx(call('usuario', STR) + String.raw`\?\.senha\s*!==?\s*(?:""|'')`), (g) => ({ type: 'USER_PASSWORD_SET', user: str(g[1]!) })],
  [rx(String.raw`\(${call('usuario', STR)}\?\.senha\s*\?\?\s*null\)\s*!==?\s*null`), (g) => ({ type: 'USER_PASSWORD_SET', user: str(g[1]!) })],
  [rx(call('conteudo', STR) + String.raw`\s*===\s*${STR}`), (g) => ({ type: 'CONTENT_EQUALS', path: str(g[1]!), value: str(g[2]!), trimWhitespace: false })],
  [rx(call('conteudo', STR) + String.raw`\?\.trim\(\)\s*===\s*${STR}`), (g) => ({ type: 'CONTENT_EQUALS', path: str(g[1]!), value: str(g[2]!), trimWhitespace: true })],
  [rx(call('conteudo', STR) + String.raw`\s*!==?\s*null`), (g) => ({ type: 'FILE_EXISTS', path: str(g[1]!) })],
  [rx(String.raw`\(${call('conteudo', STR)}\s*\?\?\s*(?:""|'')\)\.trim\(\)\.length\s*>\s*0`), (g) => ({ type: 'CONTENT_NOT_EMPTY', path: str(g[1]!) })],
  [rx(String.raw`\(${call('conteudo', STR)}\s*\?\?\s*(?:""|'')\)\.length\s*>\s*0`), (g) => ({ type: 'CONTENT_NOT_EMPTY', path: str(g[1]!) })],
  [rx(String.raw`\(${call('conteudo', STR)}\s*\?\?\s*(?:""|'')\)\.includes\(${STR}\)`), (g) => ({ type: 'CONTENT_CONTAINS', path: str(g[1]!), value: str(g[2]!) })],
  [rx(String.raw`new\s+${P}GerenciadorDePacotes\(${M}\)\.listasAtualizadas\(\)`), () => ({ type: 'APT_LISTS_UPDATED' })],
  // SPEC-013 idioms.
  [rx('!' + call('contem', `${STR},\\s*${STR}`)), (g) => ({ type: 'CONTENT_NOT_CONTAINS', path: str(g[1]!), value: str(g[2]!) })],
  [rx(String.raw`!\(${call('conteudo', STR)}\s*\?\?\s*(?:""|'')\)\.includes\(${STR}\)`),
    (g) => ({ type: 'CONTENT_NOT_CONTAINS', path: str(g[1]!), value: str(g[2]!), caseSensitive: true })],
  [rx(String.raw`\(?${call('conteudo', STR)}(?:\s*\?\?\s*(?:""|''))?\)?\.trim\(\)\.split\((?:"\\n"|'\\n')\)\)?\.length\s*(===|>=)\s*${NUM}`),
    (g) => ({ type: 'CONTENT_LINE_COUNT', path: str(g[1]!), comparison: g[2] === '===' ? 'EQUAL' : 'AT_LEAST', count: parseInt(g[3]!, 10) })],
  [rx(String.raw`new\s+${P}GerenciadorDePacotes\(${M}\)\.atualizaveis\(\)\.length\s*===\s*0`), () => ({
    type: 'PACKAGES_AT_VERSIONS',
    // The candidate version of the legacy catalog: the new version when there is one.
    packages: CATALOGO.map((p) => ({ package: p.nome, version: p.versaoNova ?? p.versao })),
  })],
  [rx(String.raw`new\s+${P}GerenciadorDePacotes\(${M}\)\.estado\(\)\.get\(${STR}\)\s*===\s*undefined`), (g) => ({ type: 'PACKAGE_INSTALLED', package: str(g[1]!), installed: false })],
  [rx(String.raw`new\s+${P}Servicos\(${M}\)\.ativo\(${STR}\)`), (g) => ({ type: 'SERVICE_STATE', service: str(g[1]!), active: true })],
  [rx(String.raw`!new\s+${P}Servicos\(${M}\)\.ativo\(${STR}\)`), (g) => ({ type: 'SERVICE_STATE', service: str(g[1]!), active: false })],
  [rx(String.raw`new\s+${P}Servicos\(${M}\)\.habilitado\(${STR}\)`), (g) => ({ type: 'SERVICE_STATE', service: str(g[1]!), enabled: true })],
  [rx(String.raw`!new\s+${P}Servicos\(${M}\)\.habilitado\(${STR}\)`), (g) => ({ type: 'SERVICE_STATE', service: str(g[1]!), enabled: false })],
  [rx(String.raw`new\s+${P}GerenciadorDePacotes\(${M}\)\.instalado\(${STR}\)`), (g) => ({ type: 'PACKAGE_INSTALLED', package: str(g[1]!), installed: true })],
  [rx(String.raw`!new\s+${P}GerenciadorDePacotes\(${M}\)\.instalado\(${STR}\)`), (g) => ({ type: 'PACKAGE_INSTALLED', package: str(g[1]!), installed: false })],
];

/**
 * Extracts the expression of an arrow function. Block bodies are accepted
 * when they only declare constants and return an expression: each constant
 * is substituted by its value, so "const u = X; return u.a && u.b" becomes
 * "(X).a && (X).b". Returns null for anything else.
 */
export function expressionBody(source: string): string | null {
  const arrow = source.indexOf('=>');
  if (arrow < 0) return null;
  const body = source.slice(arrow + 2).trim();
  if (!body.startsWith('{')) return body;
  const inner = body.slice(1, -1).trim();
  const statements = inner.split(/;\s*(?=const |let |return )/).map((st) => st.trim().replace(/;$/, ''));
  const ret = statements.pop();
  if (!ret?.startsWith('return ')) return null;
  let expr = ret.slice('return '.length).trim();
  for (const st of statements.reverse()) {
    const m = /^(?:const|let)\s+(\w+)(?:\s*:\s*[\w<>[\]|\s]+)?\s*=\s*([\s\S]+)$/.exec(st);
    if (!m) return null;
    expr = expr.replace(new RegExp(`\\b${m[1]}\\b`, 'g'), `(${m[2]!.trim()})`);
  }
  return expr;
}

/** Normalizes forms produced by constant substitution so the idioms match. */
function normalize(term: string): string {
  let t = term.replace(/\s+/g, ' ').trim();
  // "(X ?? "")" used directly as a call target keeps its parentheses; plain "(call)" loses them.
  for (let i = 0; i < 3; i += 1) {
    t = t.replace(/\(((?:[\w$]+\.)?(?:Verificar\.\w+|new (?:[\w$]+\.)?\w+\(\w+\)\.\w+)\([^()]*\))\)/g, '$1');
    t = t.replace(/\(new ((?:[\w$]+\.)?\w+)\((\w+)\)\)/g, 'new $1($2)');
  }
  // Property access on a substituted user lookup: "Verificar.usuario(m, X).senha" -> "?.senha".
  t = t.replace(/(Verificar\.usuario\(\w+, *(?:"[^"]*"|'[^']*')\))\.(\w+)/g, '$1?.$2');
  return t;
}

/** Expands "["a", "b"].every((x) => F(... "prefix" + x ...))" into one term per item. */
function expandEvery(term: string): string[] | null {
  const m = /^\[([^\]]*)\]\.every\(\(?(\w+)\)?\s*=>\s*([\s\S]+)\)$/.exec(term);
  if (!m) return null;
  const items = m[1]!.split(',').map((x) => x.trim()).filter(Boolean);
  if (!items.every((x) => /^("[^"]*"|'[^']*')$/.test(x))) return null;
  const variable = m[2]!;
  return items.map((item) => {
    const value = str(item);
    // Join "prefix" + x into a single literal.
    return m[3]!
      .replace(new RegExp(`("(?:[^"\\\\]|\\\\.)*")\\s*\\+\\s*${variable}\\b`, 'g'), (_, lit: string) => JSON.stringify(str(lit) + value))
      .replace(new RegExp(`\\b${variable}\\b`, 'g'), JSON.stringify(value));
  });
}

/** Splits an expression on top-level "&&", respecting brackets and strings. */
export function splitConjunction(expr: string): string[] {
  return splitTopLevel(expr, '&');
}

function splitTopLevel(expr: string, op: '&' | '|'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0 && ch === op && expr[i + 1] === op) {
      parts.push(expr.slice(start, i).trim());
      start = i + 2;
      i += 1;
    }
  }
  parts.push(expr.slice(start).trim());
  return parts.map(stripParens).filter((p) => p !== '');
}

function stripParens(term: string): string {
  let t = term.trim();
  while (t.startsWith('(') && t.endsWith(')') && balanced(t.slice(1, -1))) t = t.slice(1, -1).trim();
  return t;
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Splits an expression on top-level "||", respecting brackets and strings. */
export function splitDisjunction(expr: string): string[] {
  return splitTopLevel(expr, '|');
}

/** Translates one term; null when no idiom matches. A top-level "||" of
 * translatable terms becomes ANY_OF (one level, SPEC-013). */
export function translateTerm(term: string): Condition | null {
  const normalized = normalize(term);
  const alternatives = splitDisjunction(normalized);
  if (alternatives.length > 1) {
    const inner = alternatives.map((a) => translateSingle(a));
    if (inner.some((c) => c === null || c.type === 'ANY_OF')) return null;
    return { type: 'ANY_OF', conditions: inner as Condition[] };
  }
  return translateSingle(normalized);
}

function translateSingle(term: string): Condition | null {
  const normalized = normalize(term);
  for (const [pattern, build] of RULES) {
    const m = pattern.exec(normalized);
    if (m) return build(m.slice(0));
  }
  return null;
}

/** Translates a verifier function source. */
export function translateVerifier(source: string): Translation {
  const expr = expressionBody(source);
  if (expr === null) return { conditions: [], untranslated: [source.trim()] };
  const conditions: Condition[] = [];
  const untranslated: string[] = [];
  for (const raw of splitConjunction(expr)) {
    const expanded = expandEvery(normalize(raw)) ?? [raw];
    for (const term of expanded.flatMap((t) => splitConjunction(t))) {
      const c = translateTerm(term);
      if (c) conditions.push(c);
      else untranslated.push(term);
    }
  }
  return { conditions, untranslated };
}
