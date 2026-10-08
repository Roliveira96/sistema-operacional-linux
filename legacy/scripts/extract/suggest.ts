// Fallback for verifiers that cannot be translated (SPEC-005 RN-05): a
// suggestion is built from the difference between the untouched scenario and
// the state after the reference solution. Suggested questions are always
// DRAFT and need human review.
import type { MaquinaJson, NoJson } from '../../src/linux/Serializador';
import type { Condition } from './catalog';
import { groupNameOf, modeOf, packageStates, userNameOf } from './snapshot';

// Paths whose changes are side effects of running commands, not the goal.
const IGNORED = [
  /^\/var\/log(\/|$)/,
  /^\/var\/cache(\/|$)/,
  /^\/var\/lib\/(dpkg|apt)(\/|$)/,
  /^\/run(\/|$)/,
  /^\/etc\/systemd\/system(\/|$)/,
  /\/\.bash_history$/,
  /^\/tmp\/\.[^/]*$/,
];

function flatten(node: NoJson, path: string, out: Map<string, NoJson>): void {
  out.set(path, node);
  for (const child of node.filhos ?? []) flatten(child, path === '/' ? '/' + child.nome : path + '/' + child.nome, out);
}

function nodes(s: MaquinaJson): Map<string, NoJson> {
  const out = new Map<string, NoJson>();
  flatten(s.raiz, '/', out);
  return out;
}

const ignored = (path: string): boolean => IGNORED.some((re) => re.test(path));

function existence(path: string, n: NoJson): Condition {
  if (n.tipo === 'diretorio') return { type: 'DIRECTORY_EXISTS', path };
  if (n.tipo === 'link') return { type: 'SYMLINK', path, target: n.alvo };
  return { type: 'FILE_EXISTS', path };
}

/** Suggests conditions that hold after the reference solution and describe what it changed. */
export function suggestConditions(before: MaquinaJson, after: MaquinaJson): Condition[] {
  const out: Condition[] = [];
  const pre = nodes(before);
  const post = nodes(after);

  for (const [path, n] of post) {
    if (ignored(path)) continue;
    const old = pre.get(path);
    if (!old) {
      out.push(existence(path, n));
      if (n.tipo === 'arquivo' && (n.conteudo ?? '').trim() !== '') {
        out.push({ type: 'CONTENT_EQUALS', path, value: n.conteudo ?? '', trimWhitespace: true });
      }
    } else if (old.tipo === n.tipo) {
      if (old.permissoes !== n.permissoes) {
        out.push({ type: 'PERMISSION_MODE', path, mode: n.permissoes.padStart(3, '0'), includeSpecialBits: modeOf(n) > 0o777 });
      }
      if (old.dono !== n.dono || old.grupo !== n.grupo) {
        const user = userNameOf(after, n.dono);
        const group = groupNameOf(after, n.grupo);
        if (user) out.push({ type: 'OWNER', path, user, ...(group ? { group } : {}) });
      }
      if (n.tipo === 'arquivo' && old.conteudo !== n.conteudo) {
        out.push({ type: 'CONTENT_EQUALS', path, value: n.conteudo ?? '', trimWhitespace: true });
      }
    } else {
      out.push(existence(path, n));
    }
  }
  for (const path of pre.keys()) {
    if (ignored(path) || post.has(path)) continue;
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    if (post.has(parent)) out.push({ type: 'PATH_ABSENT', path });
  }

  const usersBefore = new Map(before.contas.usuarios.map((u) => [u.nome, u]));
  const usersAfter = new Map(after.contas.usuarios.map((u) => [u.nome, u]));
  for (const [name, u] of usersAfter) {
    const old = usersBefore.get(name);
    if (!old) out.push({ type: 'USER_EXISTS', user: name });
    if (old && old.shell !== u.shell) out.push({ type: 'USER_ATTRIBUTE', user: name, field: 'SHELL', value: u.shell });
    if (old && old.home !== u.home) out.push({ type: 'USER_ATTRIBUTE', user: name, field: 'HOME', value: u.home });
    if (old && old.comentario !== u.comentario) out.push({ type: 'USER_ATTRIBUTE', user: name, field: 'COMMENT', value: u.comentario });
    if ((!old || old.bloqueado !== u.bloqueado) && u.bloqueado) out.push({ type: 'USER_LOCKED', user: name, locked: true });
    if (old && old.bloqueado && !u.bloqueado) out.push({ type: 'USER_LOCKED', user: name, locked: false });
    if (u.senha && (!old || old.senha !== u.senha)) out.push({ type: 'USER_PASSWORD_SET', user: name });
  }
  for (const name of usersBefore.keys()) if (!usersAfter.has(name)) out.push({ type: 'USER_ABSENT', user: name });

  const groupsBefore = new Map(before.contas.grupos.map((g) => [g.nome, g]));
  const groupsAfter = new Map(after.contas.grupos.map((g) => [g.nome, g]));
  for (const [name, g] of groupsAfter) {
    const old = groupsBefore.get(name);
    if (!old) out.push({ type: 'GROUP_EXISTS', group: name });
    for (const member of g.membros) {
      if (!old || !old.membros.includes(member)) out.push({ type: 'USER_IN_GROUP', user: member, group: name });
    }
  }
  for (const name of groupsBefore.keys()) if (!groupsAfter.has(name)) out.push({ type: 'GROUP_ABSENT', group: name });

  const pkgBefore = packageStates(before);
  const pkgAfter = packageStates(after);
  for (const name of new Set([...pkgBefore.keys(), ...pkgAfter.keys()])) {
    const was = pkgBefore.get(name) === 'ii';
    const is = pkgAfter.get(name) === 'ii';
    if (was !== is) out.push({ type: 'PACKAGE_INSTALLED', package: name, installed: is });
  }

  const services = (s: MaquinaJson, dir: string): Set<string> => {
    const set = new Set<string>();
    for (const [path] of nodes(s)) if (path.startsWith(dir + '/')) set.add(path.slice(dir.length + 1).replace(/\.service$/, ''));
    return set;
  };
  for (const [dir, key] of [['/run/systemd/ativos', 'active'], ['/etc/systemd/system/multi-user.target.wants', 'enabled']] as const) {
    const was = services(before, dir);
    const is = services(after, dir);
    for (const s of is) if (!was.has(s)) out.push({ type: 'SERVICE_STATE', service: s, [key]: true });
    for (const s of was) if (!is.has(s)) out.push({ type: 'SERVICE_STATE', service: s, [key]: false });
  }

  if (!nodes(before).has('/var/lib/apt/lists/br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease') &&
      nodes(after).has('/var/lib/apt/lists/br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease')) {
    out.push({ type: 'APT_LISTS_UPDATED' });
  }
  return out;
}
