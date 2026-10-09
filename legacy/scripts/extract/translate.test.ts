import { describe, expect, it } from 'vitest';
import { expressionBody, splitConjunction, translateTerm, translateVerifier } from './translate';

const V = '__vite_ssr_import_0__.Verificar';

describe('translateVerifier', () => {
  it('translates conjunctions of Verificar calls', () => {
    const r = translateVerifier(`(m) => ${V}.usuario(m, "carlos") !== undefined && ${V}.diretorio(m, "/home/carlos") && ${V}.modo(m, "/x", 493)`);
    expect(r.untranslated).toEqual([]);
    expect(r.conditions).toEqual([
      { type: 'USER_EXISTS', user: 'carlos' },
      { type: 'DIRECTORY_EXISTS', path: '/home/carlos' },
      { type: 'PERMISSION_MODE', path: '/x', mode: '755', includeSpecialBits: false },
    ]);
  });

  it('expands every() over literal lists', () => {
    const r = translateVerifier(`(m) => [ "rh", "ti" ].every((p) => ${V}.diretorio(m, "/root/empresa/" + p))`);
    expect(r.conditions).toEqual([
      { type: 'DIRECTORY_EXISTS', path: '/root/empresa/rh' },
      { type: 'DIRECTORY_EXISTS', path: '/root/empresa/ti' },
    ]);
  });

  it('inlines constants of block bodies', () => {
    const r = translateVerifier(`(m) => { const u = ${V}.usuario(m, "lucas"); return u !== undefined && u.senha !== null && u.senha !== ""; }`);
    expect(r.untranslated).toEqual([]);
    expect(r.conditions.map((c) => c.type)).toEqual(['USER_EXISTS', 'USER_PASSWORD_SET', 'USER_PASSWORD_SET']);

    const g = translateVerifier('(m) => { const g = new __vite_ssr_import_1__.GerenciadorDePacotes(m); return g.instalado("tree") && g.listasAtualizadas(); }');
    expect(g.conditions).toEqual([{ type: 'PACKAGE_INSTALLED', package: 'tree', installed: true }, { type: 'APT_LISTS_UPDATED' }]);
  });

  it('reports untranslatable terms instead of guessing', () => {
    const r = translateVerifier(`(m) => m.usuariosNasConexoes().includes("lucas") && ${V}.arquivo(m, "/a")`);
    expect(r.untranslated).toEqual(['m.usuariosNasConexoes().includes("lucas")']);
    expect(translateVerifier('(m) => { if (x) return 1; }').untranslated).toHaveLength(1);
    expect(expressionBody('no arrow')).toBeNull();
  });

  it('understands the remaining idioms', () => {
    const terms: Array<[string, string]> = [
      [`${V}.no(m, '/srv/up')?.modo === 1023`, 'PERMISSION_MODE'],
      [`${V}.usuario(m, "a")?.shell === "/bin/zsh"`, 'USER_ATTRIBUTE'],
      [`${V}.usuario(m, "a")?.bloqueado === true`, 'USER_LOCKED'],
      [`${V}.conteudo(m, "/f")?.trim() === "ok"`, 'CONTENT_EQUALS'],
      [`(${V}.conteudo(m, "/f") ?? "").trim().length > 0`, 'CONTENT_NOT_EMPTY'],
      [`(${V}.usuario(m, "a")?.senha ?? null) !== null`, 'USER_PASSWORD_SET'],
      [`new __vite_ssr_import_2__.Servicos(m).ativo("nginx")`, 'SERVICE_STATE'],
      [`!new __vite_ssr_import_2__.Servicos(m).habilitado("mysql")`, 'SERVICE_STATE'],
      [`new __vite_ssr_import_1__.GerenciadorDePacotes(m).estado().get("htop") === undefined`, 'PACKAGE_INSTALLED'],
      [`${V}.linkAlvo(m, '/a', '/b')`, 'SYMLINK'],
      [`${V}.dono(m, "/f", "ana", "dev")`, 'OWNER'],
      [`${V}.grupo(m, "dev") === undefined`, 'GROUP_ABSENT'],
      [`${V}.membro(m, "ana", "dev")`, 'USER_IN_GROUP'],
      [`${V}.vazio(m, '/d')`, 'DIRECTORY_EMPTY'],
    ];
    for (const [term, type] of terms) expect(translateTerm(term)?.type, term).toBe(type);
    expect(translateTerm(`${V}.no(m, '/srv/up')?.modo === 1023`)).toMatchObject({ mode: '1777', includeSpecialBits: true });
  });

  it('splits only top-level conjunctions', () => {
    expect(splitConjunction('a(b && c) && "x && y" && (d)')).toEqual(['a(b && c)', '"x && y"', 'd']);
  });
});

// Covers SPEC-013 RN-02.
describe('SPEC-013 idioms', () => {
  it('translates negations, line counts, disjunctions and upgradable packages', () => {
    expect(translateTerm(`!${V}.contem(m, "/a", "/bin/bash")`)).toEqual({ type: 'CONTENT_NOT_CONTAINS', path: '/a', value: '/bin/bash' });
    expect(translateTerm(`!(${V}.conteudo(m, "/a") ?? "").includes("Accepted")`)).toMatchObject({ type: 'CONTENT_NOT_CONTAINS', caseSensitive: true });
    expect(translateTerm(`(${V}.conteudo(m, "/a")).trim().split("\\n").length === 5`)).toEqual({ type: 'CONTENT_LINE_COUNT', path: '/a', comparison: 'EQUAL', count: 5 });
    expect(translateTerm(`${V}.contem(m, "/a", "root") || ${V}.contem(m, "/a", "ricardo")`)).toEqual({
      type: 'ANY_OF',
      conditions: [
        { type: 'CONTENT_CONTAINS', path: '/a', value: 'root' },
        { type: 'CONTENT_CONTAINS', path: '/a', value: 'ricardo' },
      ],
    });
    expect(translateTerm(`${V}.contem(m, "/a", "root") || somethingElse()`)).toBeNull();
    const pkgs = translateTerm('(new __vite_ssr_import_1__.GerenciadorDePacotes(m)).atualizaveis().length === 0');
    expect(pkgs?.type).toBe('PACKAGES_AT_VERSIONS');
    expect(pkgs && 'packages' in pkgs && pkgs.packages.length).toBeGreaterThan(5);
  });

  it('translates the block-bodied line count verifier', () => {
    const r = translateVerifier(`(m) => { const c = ${V}.conteudo(m, "/home/ricardo/primeiras_contas.txt"); return c !== null && c.trim().split("\\n").length === 5; }`);
    expect(r.untranslated).toEqual([]);
    expect(r.conditions.map((c) => c.type)).toEqual(['FILE_EXISTS', 'CONTENT_LINE_COUNT']);
  });
});
