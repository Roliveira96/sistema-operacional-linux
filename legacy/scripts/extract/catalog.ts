// Closed catalog of validation conditions (SPEC-011) and its TypeScript
// evaluator. The Go grader must reach the same verdicts; the equivalence
// fixtures exported by the extractor enforce that.
import type { MaquinaJson } from '../../src/linux/Serializador';
import {
  FILE_TYPES,
  contentOf,
  groupByName,
  groupNameOf,
  lookup,
  modeOf,
  packageStates,
  userByName,
  userNameOf,
} from './snapshot';

export type UserField = 'HOME' | 'SHELL' | 'COMMENT' | 'UID' | 'PRIMARY_GROUP';

export type Condition =
  | { type: 'FILE_EXISTS'; path: string }
  | { type: 'DIRECTORY_EXISTS'; path: string }
  | { type: 'NODE_EXISTS'; path: string }
  | { type: 'SYMLINK'; path: string; target?: string }
  | { type: 'PATH_ABSENT'; path: string }
  | { type: 'CONTENT_EQUALS'; path: string; value: string; trimWhitespace: boolean }
  | { type: 'CONTENT_CONTAINS'; path: string; value: string }
  | { type: 'CONTENT_NOT_EMPTY'; path: string }
  | { type: 'DIRECTORY_EMPTY'; path: string }
  | { type: 'PERMISSION_MODE'; path: string; mode: string; includeSpecialBits: boolean }
  | { type: 'OWNER'; path: string; user: string; group?: string }
  | { type: 'GROUP_OWNER'; path: string; group: string }
  | { type: 'USER_EXISTS'; user: string }
  | { type: 'USER_ABSENT'; user: string }
  | { type: 'USER_ATTRIBUTE'; user: string; field: UserField; value: string }
  | { type: 'USER_PASSWORD_SET'; user: string }
  | { type: 'USER_LOCKED'; user: string; locked: boolean }
  | { type: 'GROUP_EXISTS'; group: string }
  | { type: 'GROUP_ABSENT'; group: string }
  | { type: 'USER_IN_GROUP'; user: string; group: string }
  | { type: 'PACKAGE_INSTALLED'; package: string; installed: boolean }
  | { type: 'SERVICE_STATE'; service: string; active?: boolean; enabled?: boolean }
  | { type: 'APT_LISTS_UPDATED' };

export const CONDITION_TYPES = [
  'FILE_EXISTS', 'DIRECTORY_EXISTS', 'NODE_EXISTS', 'SYMLINK', 'PATH_ABSENT', 'CONTENT_EQUALS',
  'CONTENT_CONTAINS', 'CONTENT_NOT_EMPTY', 'DIRECTORY_EMPTY', 'PERMISSION_MODE', 'OWNER', 'GROUP_OWNER',
  'USER_EXISTS', 'USER_ABSENT', 'USER_ATTRIBUTE', 'USER_PASSWORD_SET', 'USER_LOCKED', 'GROUP_EXISTS',
  'GROUP_ABSENT', 'USER_IN_GROUP', 'PACKAGE_INSTALLED', 'SERVICE_STATE', 'APT_LISTS_UPDATED',
] as const;

const APT_LISTS = '/var/lib/apt/lists/br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease';
const SERVICE_WANTS = '/etc/systemd/system/multi-user.target.wants';
const SERVICE_ACTIVE = '/run/systemd/ativos';

/** Evaluates one condition. Semantics follow legacy/src/conteudo/Verificar.ts. */
export function evaluateCondition(s: MaquinaJson, c: Condition): boolean {
  switch (c.type) {
    case 'FILE_EXISTS': {
      const n = lookup(s, c.path);
      return n !== null && FILE_TYPES.has(n.tipo);
    }
    case 'DIRECTORY_EXISTS':
      return lookup(s, c.path)?.tipo === 'diretorio';
    case 'NODE_EXISTS':
      return lookup(s, c.path) !== null;
    case 'SYMLINK': {
      const n = lookup(s, c.path, false);
      return n?.tipo === 'link' && (c.target === undefined || n.alvo === c.target);
    }
    case 'PATH_ABSENT':
      return lookup(s, c.path) === null;
    case 'CONTENT_EQUALS': {
      const text = contentOf(s, c.path);
      if (text === null) return false;
      return c.trimWhitespace ? text.trim() === c.value.trim() : text === c.value;
    }
    case 'CONTENT_CONTAINS':
      return (contentOf(s, c.path) ?? '').toLowerCase().includes(c.value.toLowerCase());
    case 'CONTENT_NOT_EMPTY':
      return (contentOf(s, c.path) ?? '').trim().length > 0;
    case 'DIRECTORY_EMPTY': {
      const n = lookup(s, c.path);
      return n?.tipo === 'diretorio' && (n.filhos ?? []).length === 0;
    }
    case 'PERMISSION_MODE': {
      const n = lookup(s, c.path);
      if (!n) return false;
      const mask = c.includeSpecialBits ? 0o7777 : 0o777;
      return (modeOf(n) & mask) === parseInt(c.mode, 8);
    }
    case 'OWNER': {
      const n = lookup(s, c.path);
      if (!n || userNameOf(s, n.dono) !== c.user) return false;
      return c.group === undefined || groupNameOf(s, n.grupo) === c.group;
    }
    case 'GROUP_OWNER': {
      const n = lookup(s, c.path);
      return n !== null && groupNameOf(s, n.grupo) === c.group;
    }
    case 'USER_EXISTS':
      return userByName(s, c.user) !== undefined;
    case 'USER_ABSENT':
      return userByName(s, c.user) === undefined;
    case 'USER_ATTRIBUTE': {
      const u = userByName(s, c.user);
      if (!u) return false;
      switch (c.field) {
        case 'HOME':
          return u.home === c.value;
        case 'SHELL':
          return u.shell === c.value;
        case 'COMMENT':
          return u.comentario === c.value;
        case 'UID':
          return String(u.uid) === c.value;
        case 'PRIMARY_GROUP':
          return groupNameOf(s, u.gid) === c.value;
      }
      return false;
    }
    case 'USER_PASSWORD_SET': {
      const u = userByName(s, c.user);
      return u !== undefined && u.senha !== null && u.senha !== '';
    }
    case 'USER_LOCKED': {
      const u = userByName(s, c.user);
      return u !== undefined && u.bloqueado === c.locked;
    }
    case 'GROUP_EXISTS':
      return groupByName(s, c.group) !== undefined;
    case 'GROUP_ABSENT':
      return groupByName(s, c.group) === undefined;
    case 'USER_IN_GROUP': {
      const u = userByName(s, c.user);
      const g = groupByName(s, c.group);
      return u !== undefined && g !== undefined && (g.membros.includes(c.user) || u.gid === g.gid);
    }
    case 'PACKAGE_INSTALLED': {
      const installed = packageStates(s).get(c.package) === 'ii';
      return installed === c.installed;
    }
    case 'SERVICE_STATE': {
      if (c.active !== undefined && (lookup(s, SERVICE_ACTIVE + '/' + c.service) !== null) !== c.active) return false;
      if (c.enabled !== undefined && (lookup(s, SERVICE_WANTS + '/' + c.service + '.service', false) !== null) !== c.enabled) {
        return false;
      }
      return c.active !== undefined || c.enabled !== undefined;
    }
    case 'APT_LISTS_UPDATED':
      return lookup(s, APT_LISTS) !== null;
  }
}

/** Validates the shape of a condition list; an invalid list never passes. */
export function validateConditions(list: unknown): list is Condition[] {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.every((c) => {
    if (typeof c !== 'object' || c === null) return false;
    const cond = c as Record<string, unknown>;
    if (!CONDITION_TYPES.includes(cond.type as (typeof CONDITION_TYPES)[number])) return false;
    if ('mode' in cond && !/^[0-7]{3,4}$/.test(String(cond.mode))) return false;
    return true;
  });
}

/** A list passes when it is valid and every condition holds. */
export function evaluate(s: MaquinaJson, conditions: Condition[]): { passed: boolean; results: boolean[] } {
  if (!validateConditions(conditions)) return { passed: false, results: [] };
  const results = conditions.map((c) => evaluateCondition(s, c));
  return { passed: results.every(Boolean), results };
}
