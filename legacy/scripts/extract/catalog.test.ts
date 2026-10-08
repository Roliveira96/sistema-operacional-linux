import { describe, expect, it } from 'vitest';
import { evaluate, evaluateCondition, validateConditions, type Condition } from './catalog';
import { sample } from './fixtures.helper';
import { contentOf, lookup } from './snapshot';

// Covers SPEC-011 CA-03 on the TypeScript side: one positive and one negative per type.
const cases: Array<[Condition, Condition]> = [
  [{ type: 'FILE_EXISTS', path: '/home/ana/notas.txt' }, { type: 'FILE_EXISTS', path: '/home/ana' }],
  [{ type: 'DIRECTORY_EXISTS', path: '/srv/uploads' }, { type: 'DIRECTORY_EXISTS', path: '/home/ana/notas.txt' }],
  [{ type: 'NODE_EXISTS', path: '/atalho/notas.txt' }, { type: 'NODE_EXISTS', path: '/nada' }],
  [{ type: 'SYMLINK', path: '/atalho', target: '/home/ana' }, { type: 'SYMLINK', path: '/atalho', target: '/root' }],
  [{ type: 'PATH_ABSENT', path: '/home/bob' }, { type: 'PATH_ABSENT', path: '/home/ana' }],
  [{ type: 'CONTENT_EQUALS', path: '/home/ana/notas.txt', value: 'Linux é demais', trimWhitespace: true },
    { type: 'CONTENT_EQUALS', path: '/home/ana/notas.txt', value: 'Linux é demais', trimWhitespace: false }],
  [{ type: 'CONTENT_CONTAINS', path: '/home/ana/notas.txt', value: 'LINUX' }, { type: 'CONTENT_CONTAINS', path: '/home/ana/notas.txt', value: 'windows' }],
  [{ type: 'CONTENT_NOT_EMPTY', path: '/home/ana/notas.txt' }, { type: 'CONTENT_NOT_EMPTY', path: '/run/systemd/ativos/nginx' }],
  [{ type: 'DIRECTORY_EMPTY', path: '/home/ana/vazia' }, { type: 'DIRECTORY_EMPTY', path: '/home/ana' }],
  [{ type: 'PERMISSION_MODE', path: '/srv/uploads', mode: '777', includeSpecialBits: false },
    { type: 'PERMISSION_MODE', path: '/srv/uploads', mode: '777', includeSpecialBits: true }],
  [{ type: 'OWNER', path: '/home/ana/notas.txt', user: 'ana', group: 'dev' }, { type: 'OWNER', path: '/home/ana/notas.txt', user: 'root' }],
  [{ type: 'GROUP_OWNER', path: '/home/ana/notas.txt', group: 'dev' }, { type: 'GROUP_OWNER', path: '/home/ana/notas.txt', group: 'ana' }],
  [{ type: 'USER_EXISTS', user: 'ana' }, { type: 'USER_EXISTS', user: 'bob' }],
  [{ type: 'USER_ABSENT', user: 'bob' }, { type: 'USER_ABSENT', user: 'ana' }],
  [{ type: 'USER_ATTRIBUTE', user: 'ana', field: 'SHELL', value: '/bin/sh' }, { type: 'USER_ATTRIBUTE', user: 'ana', field: 'HOME', value: '/root' }],
  [{ type: 'USER_PASSWORD_SET', user: 'root' }, { type: 'USER_PASSWORD_SET', user: 'ana' }],
  [{ type: 'USER_LOCKED', user: 'ana', locked: true }, { type: 'USER_LOCKED', user: 'root', locked: true }],
  [{ type: 'GROUP_EXISTS', group: 'dev' }, { type: 'GROUP_EXISTS', group: 'ops' }],
  [{ type: 'GROUP_ABSENT', group: 'ops' }, { type: 'GROUP_ABSENT', group: 'dev' }],
  [{ type: 'USER_IN_GROUP', user: 'ana', group: 'dev' }, { type: 'USER_IN_GROUP', user: 'root', group: 'dev' }],
  [{ type: 'PACKAGE_INSTALLED', package: 'htop', installed: true }, { type: 'PACKAGE_INSTALLED', package: 'vim', installed: true }],
  [{ type: 'SERVICE_STATE', service: 'nginx', active: true, enabled: true }, { type: 'SERVICE_STATE', service: 'mysql', active: true }],
  [{ type: 'APT_LISTS_UPDATED' }, { type: 'PATH_ABSENT', path: '/var/lib/apt/lists/br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease' }],
];

describe('condition catalog', () => {
  it.each(cases)('%j passes and its counterpart fails', (positive, negative) => {
    expect(evaluateCondition(sample, positive)).toBe(true);
    expect(evaluateCondition(sample, negative)).toBe(false);
  });

  it('covers every user attribute', () => {
    expect(evaluateCondition(sample, { type: 'USER_ATTRIBUTE', user: 'ana', field: 'COMMENT', value: 'Ana' })).toBe(true);
    expect(evaluateCondition(sample, { type: 'USER_ATTRIBUTE', user: 'ana', field: 'UID', value: '1001' })).toBe(true);
    expect(evaluateCondition(sample, { type: 'USER_ATTRIBUTE', user: 'ana', field: 'PRIMARY_GROUP', value: 'ana' })).toBe(true);
    expect(evaluateCondition(sample, { type: 'USER_ATTRIBUTE', user: 'bob', field: 'UID', value: '1' })).toBe(false);
  });

  it('treats uninstalled and removed packages and stopped services as negatives', () => {
    expect(evaluateCondition(sample, { type: 'PACKAGE_INSTALLED', package: 'vim', installed: false })).toBe(true);
    expect(evaluateCondition(sample, { type: 'PACKAGE_INSTALLED', package: 'nano', installed: false })).toBe(true);
    expect(evaluateCondition(sample, { type: 'SERVICE_STATE', service: 'mysql', active: false, enabled: false })).toBe(true);
    expect(evaluateCondition(sample, { type: 'SERVICE_STATE', service: 'nginx' })).toBe(false);
  });

  // Covers SPEC-011 CA-04 on the TypeScript side.
  it('rejects invalid lists', () => {
    expect(validateConditions([])).toBe(false);
    expect(validateConditions([{ type: 'NOPE' }])).toBe(false);
    expect(validateConditions([{ type: 'PERMISSION_MODE', path: '/x', mode: '9z9' }])).toBe(false);
    expect(validateConditions('x')).toBe(false);
    expect(evaluate(sample, [{ type: 'NOPE' } as unknown as Condition]).passed).toBe(false);
  });

  it('requires every condition to hold', () => {
    const ok: Condition = { type: 'USER_EXISTS', user: 'ana' };
    const bad: Condition = { type: 'USER_EXISTS', user: 'bob' };
    expect(evaluate(sample, [ok, ok]).passed).toBe(true);
    expect(evaluate(sample, [ok, bad])).toEqual({ passed: false, results: [true, false] });
  });

  it('resolves paths like the legacy filesystem', () => {
    expect(lookup(sample, 'relative')).toBeNull();
    expect(lookup(sample, '/home/ana/../ana/notas.txt')?.nome).toBe('notas.txt');
    expect(lookup(sample, '/home/ana/notas.txt/x')).toBeNull();
    expect(contentOf(sample, '/home')).toBeNull();
  });
});
