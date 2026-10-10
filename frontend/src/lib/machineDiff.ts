// The snapshot of a module has to leave the student's machine exactly as the teacher left theirs. The commands the
// teacher typed are replayed on a fresh machine, and what still differs from the teacher's machine (a file with
// the text typed in an editor, a permission, an owner) is made equal: the files as data, the rest as commands (SPEC-021).

import { bytesOf, MAX_FILE_BYTES, MAX_FILES, MAX_FILES_BYTES, type SetupFile, type SetupStep } from "./setup";
import { shellQuote } from "./setupContent";

/** A node of the file tree of a machine, as the engine serializes it. */
export interface TreeNode {
  nome: string;
  tipo: "diretorio" | "arquivo" | "gerado" | "nulo" | "link" | "dispositivo" | "binario" | "compactado";
  dono: number;
  grupo: number;
  /** Octal text: "755", "644". */
  permissoes: string;
  conteudo?: string;
  filhos?: TreeNode[];
  alvo?: string;
}

/** The parts of a serialized machine this file reads. */
export interface MachineTree {
  raiz: TreeNode;
  contas: { usuarios: { nome: string; uid: number; gid?: number }[]; grupos: { nome: string; gid: number; membros?: string[] }[] };
}

export interface Reconciliation {
  /** The commands that make the replayed machine equal to the recorded one (folders, links, removals, permissions). */
  steps: SetupStep[];
  /** The files whose text the replay lacks or has different, with their mode and owner. */
  files: SetupFile[];
  /** What could not be made equal, so the author knows it will differ. */
  inexact: string[];
}

/** Places a machine changes by itself, that say nothing about what the teacher built. */
const NOISE_PREFIXES = ["/proc", "/sys", "/dev", "/run", "/var/log"];
const NOISE_NAMES = new Set([".bash_history", ".viminfo", ".lesshst", ".selected_editor"]);
/** What a command creates when the teacher does not say otherwise (the terminal runs as root). */
const DEFAULT_MODE = { diretorio: "755", arquivo: "644", link: "777" } as const;

const isNoise = (path: string) => NOISE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) || NOISE_NAMES.has(path.slice(path.lastIndexOf("/") + 1));
const SKIPPED = new Set(["gerado", "nulo", "dispositivo"]);

function flatten(node: TreeNode, path: string, out: Map<string, TreeNode>) {
  for (const child of node.filhos ?? []) {
    const childPath = path === "/" ? `/${child.nome}` : `${path}/${child.nome}`;
    if (isNoise(childPath) || SKIPPED.has(child.tipo)) continue;
    out.set(childPath, child);
    if (child.tipo === "diretorio") flatten(child, childPath, out);
  }
}

/** Every node of the machine by absolute path, without the places a machine changes by itself. */
export const flattenTree = (machine: MachineTree) => {
  const out = new Map<string, TreeNode>();
  flatten(machine.raiz, "/", out);
  return out;
};

const depth = (path: string) => path.split("/").length;

/**
 * What `recorded` has that `replayed` lacks or has different. Files go as data (any size up to the limits of the server);
 * folders, links, removals, permissions and owners go as commands; what neither can reproduce is told.
 */
export function reconcile(recorded: MachineTree, replayed: MachineTree): Reconciliation {
  const want = flattenTree(recorded);
  const have = flattenTree(replayed);
  const users = new Map(recorded.contas.usuarios.map((u) => [u.uid, u.nome]));
  const groups = new Map(recorded.contas.grupos.map((g) => [g.gid, g.nome]));
  const steps: SetupStep[] = [];
  const files: SetupFile[] = [];
  const inexact: string[] = [];
  const removed: string[] = [];
  let bytes = 0;

  // What the replay made and the teacher did not have: take it away (the top-most path only).
  for (const path of [...have.keys()].sort()) {
    const node = want.get(path);
    const mine = have.get(path)!;
    const gone = !node || node.tipo !== mine.tipo;
    if (gone && !removed.some((r) => path.startsWith(`${r}/`))) {
      removed.push(path);
      steps.push({ command: `rm -rf ${shellQuote(path)}` });
    }
  }
  const survives = (path: string) => !removed.some((r) => path === r || path.startsWith(`${r}/`));
  const created = (path: string) => !have.has(path) || !survives(path) || have.get(path)!.tipo !== want.get(path)!.tipo;

  for (const path of [...want.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
    const node = want.get(path)!;
    const fresh = created(path);
    const mine = fresh ? undefined : have.get(path);
    const quoted = shellQuote(path);
    const user = users.get(node.dono);
    const group = groups.get(node.grupo);

    if (node.tipo === "arquivo") {
      const text = node.conteudo ?? "";
      const size = bytesOf(text);
      if (fresh || mine?.conteudo !== text) {
        if (size > MAX_FILE_BYTES) inexact.push(`${path}: o arquivo tem ${(size / 1048576).toFixed(1)} MB e o limite é de ${MAX_FILE_BYTES / 1048576} MB por arquivo.`);
        else if (bytes + size > MAX_FILES_BYTES) inexact.push(`${path}: passaria do limite de ${MAX_FILES_BYTES / 1048576} MB de arquivos no ambiente.`);
        else if (files.length >= MAX_FILES) inexact.push(`${path}: passaria do limite de ${MAX_FILES} arquivos no ambiente.`);
        else if (!user || !group) inexact.push(`${path}: o dono (${node.dono}:${node.grupo}) não tem nome na máquina.`);
        else {
          bytes += size;
          // The file carries its own mode and owner, since it goes in after the commands.
          files.push({ path, content: text, mode: node.permissoes, owner: user, group });
        }
        continue;
      }
    } else if (node.tipo === "diretorio") {
      if (fresh) steps.push({ command: `mkdir -p ${quoted}` });
    } else if (node.tipo === "link") {
      if (fresh || mine?.alvo !== node.alvo) {
        if (!fresh) steps.push({ command: `rm -f ${quoted}` });
        steps.push({ command: `ln -s ${shellQuote(node.alvo ?? "")} ${quoted}` });
      }
    } else {
      if (fresh) inexact.push(`${path}: arquivos do tipo "${node.tipo}" não são reproduzidos pelo ambiente.`);
      continue;
    }

    const mode = fresh ? DEFAULT_MODE[node.tipo] : mine!.permissoes;
    if (node.tipo !== "link" && node.permissoes !== mode) steps.push({ command: `chmod ${node.permissoes} ${quoted}` });
    const owner = fresh ? { dono: 0, grupo: 0 } : { dono: mine!.dono, grupo: mine!.grupo };
    if (node.dono !== owner.dono || node.grupo !== owner.grupo) {
      if (user && group) steps.push({ command: `chown ${user}:${group} ${quoted}` });
      else inexact.push(`${path}: o dono (${node.dono}:${node.grupo}) não tem nome na máquina.`);
    }
  }

  const rebuilt = new Set(replayed.contas.usuarios.map((u) => u.nome));
  for (const user of recorded.contas.usuarios) if (!rebuilt.has(user.nome)) inexact.push(`Usuário ${user.nome}: existe no terminal e não é criado pelos comandos.`);
  return { steps, files, inexact };
}
