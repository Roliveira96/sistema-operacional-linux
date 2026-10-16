import { messages } from "./messages";
import { processLines, programOf, type ProcessLine } from "./ps";
import type { EngineCommand, EngineContext } from "./types";

interface Node {
  line: ProcessLine;
  children: Node[];
}

const compare = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** The children of a process are listed by name and then by PID, as pstree does. */
const byNameThenPid = (a: ProcessLine, b: ProcessLine) => compare(programOf(a.comando), programOf(b.comando)) || compare(a.pid, b.pid);

/** A thread of the kernel is listed as [name]; pstree does not draw them. */
const isKernelThread = (line: ProcessLine) => /^\[.*\]$/.test(line.comando);

function treeOf(all: ProcessLine[]): Node[] {
  const lines = all.filter((line) => !isKernelThread(line));
  const nodes = new Map(lines.map((line) => [line.pid, { line, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const line of [...lines].sort(byNameThenPid)) {
    const node = nodes.get(line.pid)!;
    const parent = nodes.get(line.ppid);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** The lines of a process and what is under it: a single child goes on the same line, and several ones branch, like the real pstree. */
function draw(node: Node, withPids: boolean): string[] {
  const name = programOf(node.line.comando);
  const label = withPids ? `${name}(${node.line.pid})` : name;
  const kids = node.children;
  if (kids.length === 0) return [label];
  if (kids.length === 1) {
    const sub = draw(kids[0]!, withPids);
    return [`${label}───${sub[0]}`, ...sub.slice(1).map((row) => " ".repeat(label.length + 3) + row)];
  }
  const out: string[] = [];
  kids.forEach((kid, index) => {
    const last = index === kids.length - 1;
    const sub = draw(kid, withPids);
    out.push((index === 0 ? `${label}─┬─` : `${" ".repeat(label.length)}${last ? " └─" : " ├─"}`) + sub[0]);
    for (const row of sub.slice(1)) out.push(`${" ".repeat(label.length)}${last ? "   " : " │ "}${row}`);
  });
  return out;
}

function find(roots: Node[], pid: number): Node | undefined {
  for (const node of roots) {
    if (node.line.pid === pid) return node;
    const inside = find(node.children, pid);
    if (inside) return inside;
  }
  return undefined;
}

/** pstree: who is the parent of whom, drawn as a tree (SPEC-029 entrega A). */
export const pstreeCommand: EngineCommand = {
  nome: "pstree",
  resumo: "mostra os processos em árvore, com pais e filhos (pstree -p mostra os PIDs)",
  ajuda: {
    uso: "pstree [-p] [PID]",
    descricao: "Desenha os processos em árvore: cada processo à direita do pai, e os irmãos em ramos. Sem PID começa pelo primeiro processo; com PID mostra só a árvore dele.",
    opcoes: [["-p", "mostra o PID de cada processo, entre parênteses"]],
    exemplos: [
      ["pstree", "a árvore de todos os processos"],
      ["pstree -p", "a árvore com os PIDs"],
      ["pstree -p 2400", "só o que está embaixo do processo 2400"],
    ],
  },
  async executar(args: string[], context: EngineContext): Promise<number> {
    let withPids = false;
    let from: number | null = null;
    for (const arg of args) {
      if (arg === "-p") withPids = true;
      else if (/^\d+$/.test(arg)) from = Number(arg);
      else {
        context.falhar(messages.pstree.invalidOption(arg.replace(/^-+/, "").charAt(0) || arg));
        return 1;
      }
    }
    const roots = treeOf(processLines(context.maquina));
    let shown = roots;
    if (from !== null) {
      const node = find(roots, from);
      if (!node) {
        context.falhar(messages.pstree.noProcess(from));
        return 1;
      }
      shown = [node];
    }
    for (const root of shown) for (const row of draw(root, withPids)) context.linha(row);
    return 0;
  },
};

/** pidof: the PIDs of the programs with the names given (SPEC-029 entrega A). */
export const pidofCommand: EngineCommand = {
  nome: "pidof",
  resumo: "mostra os PIDs de um programa (pidof sleep)",
  ajuda: {
    uso: "pidof [-s] [-q] NOME...",
    descricao: "Imprime os PIDs dos processos que rodam o programa, o maior primeiro. Termina com 1 se nenhum processo tem o nome.",
    opcoes: [
      ["-s", "mostra só um PID por programa"],
      ["-q", "não imprime nada, só termina com 0 (achou) ou 1 (não achou)"],
    ],
    exemplos: [
      ["pidof sleep", "os PIDs de todos os sleep"],
      ["pidof -s bash", "um PID só"],
    ],
  },
  async executar(args: string[], context: EngineContext): Promise<number> {
    let single = false;
    let quiet = false;
    const names: string[] = [];
    for (const arg of args) {
      if (arg === "-s") single = true;
      else if (arg === "-q") quiet = true;
      else if (arg.startsWith("-") && arg.length > 1) {
        context.falhar(messages.pidof.invalidOption(arg.replace(/^-+/, "").charAt(0)));
        return 1;
      } else names.push(arg);
    }
    if (names.length === 0) {
      context.falhar(messages.pidof.usage);
      return 1;
    }
    const lines = processLines(context.maquina);
    const pids: number[] = [];
    for (const name of names) {
      const found = lines.filter((l) => programOf(l.comando) === name.split("/").pop()).map((l) => l.pid).sort((a, b) => b - a);
      pids.push(...(single ? found.slice(0, 1) : found));
    }
    if (pids.length === 0) return 1;
    if (!quiet) context.linha(pids.join(" "));
    return 0;
  },
};
