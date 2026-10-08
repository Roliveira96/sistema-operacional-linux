import { describe, expect, it } from 'vitest';
import { evaluate } from './catalog';
import { dir, file, link, machine } from './fixtures.helper';
import { suggestConditions } from './suggest';

describe('suggestConditions', () => {
  it('describes what the reference solution changed and holds on the final state', () => {
    const before = machine([dir('home', [dir('ana', [file('old.txt', 'x')])]), dir('var', [dir('log', [file('syslog', '')])])]);
    const after = machine([
      dir('home', [dir('ana', [file('novo.txt', 'conteúdo\n', '600', 1001, 1001), link('l', '/tmp')], '700')]),
      dir('var', [dir('log', [file('syslog', 'changed')])]),
    ]);
    after.contas.usuarios.push({ nome: 'bob', uid: 1002, gid: 1002, comentario: '', home: '/home/bob', shell: '/bin/bash', senha: 'h', bloqueado: false });
    after.contas.grupos.push({ nome: 'ops', gid: 3000, membros: ['bob'] });

    const conditions = suggestConditions(before, after);
    const types = conditions.map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining([
      'FILE_EXISTS', 'CONTENT_EQUALS', 'SYMLINK', 'PATH_ABSENT', 'PERMISSION_MODE', 'USER_EXISTS', 'USER_PASSWORD_SET', 'GROUP_EXISTS', 'USER_IN_GROUP',
    ]));
    expect(conditions.some((c) => 'path' in c && c.path.startsWith('/var/log'))).toBe(false);
    expect(evaluate(after, conditions).passed).toBe(true);
    expect(evaluate(before, conditions).passed).toBe(false);
  });
});
