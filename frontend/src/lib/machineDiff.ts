// The snapshot of a module has to leave the student's machine exactly as the teacher left theirs. The commands the
// teacher typed are replayed on a fresh machine, and what still differs from the teacher's machine (a file with
// the text typed in an editor, a permission, an owner) is turned into the commands that make them equal (SPEC-021).

import { printfSteps, shellQuote } from "./setupContent";
import type { SetupStep } from "./setup";

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
  contas: { usuarios: { nome: string; uid: number }[]; grupos: { nome: string; gid: number }[] };
}

export interface Reconciliation {
  /** The commands that make the replayed machine equal to the recorded one. */
  steps: SetupStep[];
  /** What could not be made equal by a command, so the author knows it will differ. */
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

const tree = (machine: MachineTree) => {
  const out = new Map<string, TreeNode>();
  flatten(machine.raiz, "/", out);
  return out;
};

const depth = (path: string) => path.split("/").length;

/** What `recorded` has that `replayed` lacks or has different, as commands, and what no command can fix. */
export function reconcile(recorded: MachineTree, replayed: MachineTree): Reconciliation {
  const want = tree(recorded);
  const have = tree(replayed);
  const users = new Map(recorded.contas.usuarios.map((u) => [u.uid, u.nome]));
  const groups = new Map(recorded.contas.grupos.map((g) => [g.gid, g.nome]));
  const steps: SetupStep[] = [];
  const inexact: string[] = [];
  const removed: string[] = [];

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

    if (node.tipo === "diretorio") {
      if (fresh) steps.push({ command: `mkdir -p ${quoted}` });
    } else if (node.tipo === "arquivo") {
      const text = node.conteudo ?? "";
      if (fresh || mine?.conteudo !== text) {
        if (text !== "" && !text.endsWith(String.fromCharCode(10))) inexact.push(`${path}: o arquivo não termina com quebra de linha, que o ambiente acrescentaria.`);
        else if (text.includes("\\")) inexact.push(`${path}: o arquivo tem barra invertida (\\) no texto, que o ambiente não consegue reproduzir por comando.`);
        else steps.push(...printfSteps(path, text.endsWith("\n") ? text.slice(0, -1) : text));
      }
    } else if (node.tipo === "link") {
      if (fresh || mine?.alvo !== node.alvo) {
        if (!fresh) steps.push({ command: `rm -f ${quoted}` });
        steps.push({ command: `ln -s ${shellQuote(node.alvo ?? "")} ${quoted}` });
      }
    } else {
      if (fresh) inexact.push(`${path}: arquivos do tipo "${node.tipo}" não são reproduzidos pelo ambiente.`);
      continue;
    }

    const defaultMode = DEFAULT_MODE[node.tipo];
    const mode = fresh ? defaultMode : mine!.permissoes;
    if (node.tipo !== "link" && node.permissoes !== mode) steps.push({ command: `chmod ${node.permissoes} ${quoted}` });
    const owner = fresh ? { dono: 0, grupo: 0 } : { dono: mine!.dono, grupo: mine!.grupo };
    if (node.dono !== owner.dono || node.grupo !== owner.grupo) {
      const user = users.get(node.dono);
      const group = groups.get(node.grupo);
      if (user && group) steps.push({ command: `chown ${user}:${group} ${quoted}` });
      else inexact.push(`${path}: o dono (${node.dono}:${node.grupo}) não tem nome na máquina.`);
    }
  }

  const rebuilt = new Set(replayed.contas.usuarios.map((u) => u.nome));
  for (const user of recorded.contas.usuarios) if (!rebuilt.has(user.nome)) inexact.push(`Usuário ${user.nome}: existe no terminal e não é criado pelos comandos.`);
  return { steps, inexact };
}
