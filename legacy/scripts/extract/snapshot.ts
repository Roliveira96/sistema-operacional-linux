// Read-only helpers over a serialized machine (format exame-so/maquina v1).
// They mirror the semantics of the legacy filesystem lookups so that the
// declarative conditions decide exactly like the original verifiers.
import type { GrupoJson, MaquinaJson, NoJson, UsuarioJson } from '../../src/linux/Serializador';

const MAX_LINK_DEPTH = 40;

function splitPath(path: string): string[] {
  return path.split('/').filter((part) => part !== '' && part !== '.');
}

/** Resolves an absolute path. Intermediate links are always followed; the last one only when followLast is true. */
export function lookup(snapshot: MaquinaJson, path: string, followLast = true, depth = 0): NoJson | null {
  if (depth > MAX_LINK_DEPTH || !path.startsWith('/')) return null;
  const parts = splitPath(path);
  let node: NoJson = snapshot.raiz;
  const walked: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (part === '..') {
      walked.pop();
      const parent = lookup(snapshot, '/' + walked.join('/'), true, depth + 1);
      if (!parent) return null;
      node = parent;
      continue;
    }
    if (node.tipo !== 'diretorio') return null;
    const child = (node.filhos ?? []).find((f) => f.nome === part);
    if (!child) return null;
    const isLast = i === parts.length - 1;
    if (child.tipo === 'link' && (!isLast || followLast)) {
      const target = child.alvo ?? '';
      const base = target.startsWith('/') ? target : '/' + [...walked, target].join('/');
      const rest = parts.slice(i + 1).join('/');
      return lookup(snapshot, rest ? base.replace(/\/$/, '') + '/' + rest : base, followLast, depth + 1);
    }
    walked.push(part);
    node = child;
  }
  return node;
}

/** Node types that are files in the legacy model (subclasses of Arquivo). */
export const FILE_TYPES: ReadonlySet<string> = new Set(['arquivo', 'gerado', 'binario', 'compactado', 'dispositivo', 'nulo']);

/** Text content of a file-like node; null for directories, links and missing paths. */
export function contentOf(snapshot: MaquinaJson, path: string): string | null {
  const node = lookup(snapshot, path);
  if (!node || !FILE_TYPES.has(node.tipo)) return null;
  return node.conteudo ?? '';
}

/** Numeric mode of a node, including special bits. */
export function modeOf(node: NoJson): number {
  return parseInt(node.permissoes, 8);
}

export function userByName(snapshot: MaquinaJson, name: string): UsuarioJson | undefined {
  return snapshot.contas.usuarios.find((u) => u.nome === name);
}

export function groupByName(snapshot: MaquinaJson, name: string): GrupoJson | undefined {
  return snapshot.contas.grupos.find((g) => g.nome === name);
}

export function userNameOf(snapshot: MaquinaJson, uid: number): string | undefined {
  return snapshot.contas.usuarios.find((u) => u.uid === uid)?.nome;
}

export function groupNameOf(snapshot: MaquinaJson, gid: number): string | undefined {
  return snapshot.contas.grupos.find((g) => g.gid === gid)?.nome;
}

/** Package states and versions from /var/lib/dpkg/status, as the legacy package manager parses them. */
export function packageVersions(snapshot: MaquinaJson): Map<string, { status: 'ii' | 'rc'; version: string }> {
  const states = new Map<string, { status: 'ii' | 'rc'; version: string }>();
  const text = contentOf(snapshot, '/var/lib/dpkg/status') ?? '';
  for (const block of text.split('\n\n')) {
    const fields = new Map<string, string>();
    for (const line of block.split('\n')) {
      const i = line.indexOf(': ');
      if (i > 0) fields.set(line.substring(0, i), line.substring(i + 2));
    }
    const name = fields.get('Package');
    if (name !== undefined) {
      states.set(name, {
        status: (fields.get('Status') ?? '').includes('config-files') ? 'rc' : 'ii',
        version: fields.get('Version') ?? '',
      });
    }
  }
  return states;
}

/** Package states from /var/lib/dpkg/status. */
export function packageStates(snapshot: MaquinaJson): Map<string, 'ii' | 'rc'> {
  return new Map([...packageVersions(snapshot)].map(([name, v]) => [name, v.status]));
}
