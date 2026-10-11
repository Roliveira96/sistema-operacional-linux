// An exercise can be done in many ways; what matters is how it ends (SPEC-022). The conditions of finalization say what
// must hold in the machine at the end. They are worked out from what the teacher did in the terminal (the machine before
// and after) and checked on the machine of the student.

import { bytesOf, MAX_FILE_BYTES } from "./setup";
import { flattenTree, type MachineTree } from "./machineDiff";

export type ConditionKind =
  | "DIR_EXISTS"
  | "FILE_EXISTS"
  | "PATH_ABSENT"
  | "FILE_CONTENT"
  | "MODE"
  | "OWNER"
  | "LINK"
  | "USER_EXISTS"
  | "GROUP_EXISTS"
  | "USER_IN_GROUP"
  // How a process ended up, by the name of its program (SPEC-029): `name` is the program.
  | "PROCESS_RUNNING"
  | "PROCESS_ABSENT"
  | "PROCESS_STOPPED"
  | "PROCESS_ENDED_BY"
  | "PROCESS_NICE";

/** The kinds about processes: they read the processes of the machine, not its files or accounts. */
export const PROCESS_KINDS: ConditionKind[] = ["PROCESS_RUNNING", "PROCESS_ABSENT", "PROCESS_STOPPED", "PROCESS_ENDED_BY", "PROCESS_NICE"];

export interface ExerciseCondition {
  kind: ConditionKind;
  path?: string;
  content?: string;
  /** For FILE_CONTENT: the text is the same, or only has to be in the file. */
  match?: "equals" | "contains";
  mode?: string;
  owner?: string;
  group?: string;
  target?: string;
  /** A user, or a group when the kind is about one, or the program of a process. */
  name?: string;
  user?: string;
  /** For PROCESS_ENDED_BY: the signal that ended it; none means any signal. */
  signal?: number;
  /** For PROCESS_NICE: the priority the process has. */
  nice?: number;
}

/** The most conditions an exercise keeps (the server's limit). */
export const MAX_CONDITIONS = 100;

/** A command of the user running on the machine, and one a signal ended (SPEC-029): they go along in the snapshot, only to be checked. */
export interface MachineProcess {
  pid: number;
  uid?: number;
  comando: string;
  estado: string;
  nice: number;
}
export interface EndedProcess {
  pid: number;
  comando: string;
  sinal: number;
}

/** The machine as the engine serializes it, with the accounts this file reads. */
type Machine = MachineTree & {
  contas: MachineTree["contas"] & { usuarios: { nome: string; uid: number; gid?: number }[]; grupos: { nome: string; gid: number; membros?: string[] }[] };
  processos?: MachineProcess[];
  encerrados?: EndedProcess[];
};

/** The name of the program of a command line, as ps shows it: no arguments, no folder, no login dash. */
export function programOf(command: string): string {
  const first = command.trim().replace(/^-/, "").split(/\s/)[0] ?? "";
  return first.slice(first.lastIndexOf("/") + 1);
}

const DEFAULT_MODE = { diretorio: "755", arquivo: "644", link: "777" } as const;

/** What changed in the machine between `before` and `after`, as conditions that hold at the end. */
export function deriveConditions(before: Machine, after: Machine): ExerciseCondition[] {
  const had = flattenTree(before);
  const has = flattenTree(after);
  const owners = (m: Machine) => ({ users: new Map(m.contas.usuarios.map((u) => [u.uid, u.nome])), groups: new Map(m.contas.grupos.map((g) => [g.gid, g.nome])) });
  const names = owners(after);
  const list: ExerciseCondition[] = [];

  // Accounts first: a file may belong to a user the exercise creates.
  const knownUsers = new Set(before.contas.usuarios.map((u) => u.nome));
  const knownGroups = new Set(before.contas.grupos.map((g) => g.nome));
  for (const user of after.contas.usuarios) if (!knownUsers.has(user.nome)) list.push({ kind: "USER_EXISTS", name: user.nome });
  for (const group of after.contas.grupos) if (!knownGroups.has(group.nome)) list.push({ kind: "GROUP_EXISTS", name: group.nome });
  for (const group of after.contas.grupos) {
    const old = before.contas.grupos.find((g) => g.nome === group.nome);
    for (const member of group.membros ?? []) if (!(old?.membros ?? []).includes(member)) list.push({ kind: "USER_IN_GROUP", user: member, name: group.nome });
  }

  const removed: string[] = [];
  for (const path of [...had.keys()].sort()) {
    if (!has.has(path) && !removed.some((r) => path.startsWith(`${r}/`))) {
      removed.push(path);
      list.push({ kind: "PATH_ABSENT", path });
    }
  }

  for (const path of [...has.keys()].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))) {
    const node = has.get(path)!;
    const old = had.get(path);
    const fresh = !old || old.tipo !== node.tipo;
    if (node.tipo === "diretorio") {
      if (fresh) list.push({ kind: "DIR_EXISTS", path });
    } else if (node.tipo === "arquivo") {
      const text = node.conteudo ?? "";
      if (fresh) list.push({ kind: "FILE_EXISTS", path });
      if ((fresh || old?.conteudo !== text) && text !== "" && bytesOf(text) <= MAX_FILE_BYTES) list.push({ kind: "FILE_CONTENT", path, content: text, match: "equals" });
    } else if (node.tipo === "link") {
      if (fresh || old?.alvo !== node.alvo) list.push({ kind: "LINK", path, target: node.alvo ?? "" });
    } else {
      continue;
    }
    if (node.tipo !== "link") {
      const mode = fresh ? DEFAULT_MODE[node.tipo] : old!.permissoes;
      if (node.permissoes !== mode) list.push({ kind: "MODE", path, mode: node.permissoes });
    }
    const owner = fresh ? { dono: 0, grupo: 0 } : { dono: old!.dono, grupo: old!.grupo };
    if (node.dono !== owner.dono || node.grupo !== owner.grupo) {
      const user = names.users.get(node.dono);
      const group = names.groups.get(node.grupo);
      if (user) list.push({ kind: "OWNER", path, owner: user, ...(group ? { group } : {}) });
    }
  }
  list.push(...deriveProcessConditions(before, after));
  return list.slice(0, MAX_CONDITIONS);
}

/**
 * What changed in the processes between `before` and `after` (SPEC-029 RN-08): a program that is running or stopped now and was not, one that
 * is gone and was there (and the signal that ended it, when one did), and one whose priority changed. Programs, not PIDs: the next run has others.
 */
export function deriveProcessConditions(before: Machine, after: Machine): ExerciseCondition[] {
  const wasThere = new Map((before.processos ?? []).map((p) => [p.pid, p]));
  const isThere = new Map((after.processos ?? []).map((p) => [p.pid, p]));
  const list: ExerciseCondition[] = [];
  const add = (condition: ExerciseCondition) => {
    if (!list.some((c) => c.kind === condition.kind && c.name === condition.name && c.signal === condition.signal && c.nice === condition.nice)) list.push(condition);
  };

  for (const process of after.processos ?? []) {
    const name = programOf(process.comando);
    if (name === "") continue;
    const old = wasThere.get(process.pid);
    const stopped = process.estado.startsWith("T");
    const kind = stopped ? "PROCESS_STOPPED" : "PROCESS_RUNNING";
    // Already so at the start (another process of the program, in the same state): nothing changed, so there is nothing to ask.
    const alreadyBefore = (before.processos ?? []).some((p) => programOf(p.comando) === name && p.estado.startsWith("T") === stopped);
    if (!old && !alreadyBefore) add({ kind, name });
    else if (old && old.estado.startsWith("T") !== stopped && !alreadyBefore) add({ kind, name });
    if ((!old && process.nice !== 0) || (old && old.nice !== process.nice)) add({ kind: "PROCESS_NICE", name, nice: process.nice });
  }
  // One that was there and is not now: gone, and by which signal when a signal did it.
  const endedBefore = new Set((before.encerrados ?? []).map((e) => e.pid));
  for (const [pid, process] of wasThere) {
    if (isThere.has(pid)) continue;
    const name = programOf(process.comando);
    if (name === "") continue;
    const stillRunning = (after.processos ?? []).some((p) => programOf(p.comando) === name);
    if (!stillRunning) add({ kind: "PROCESS_ABSENT", name });
  }
  for (const e of after.encerrados ?? []) {
    if (endedBefore.has(e.pid)) continue;
    const name = programOf(e.comando);
    if (name === "") continue;
    // A program started and ended during the recording was never in the list before: it is gone, and the signal ended it.
    if (!(after.processos ?? []).some((p) => programOf(p.comando) === name)) add({ kind: "PROCESS_ABSENT", name });
    add({ kind: "PROCESS_ENDED_BY", name, signal: e.sinal });
  }
  return list;
}

// ---- checking

const trimEnd = (text: string) => text.replace(/[\r\n]+$/, "");
const octal = (mode: string) => Number.parseInt(mode, 8);

function nodeAt(machine: Machine, path: string) {
  let node: Machine["raiz"] | undefined = machine?.raiz;
  for (const part of path.split("/").filter(Boolean)) {
    node = node?.filhos?.find((n) => n.nome === part);
    if (!node) return undefined;
  }
  return node;
}

/** The processes of the machine that run a program. A machine with no processes (one that was saved, not one running) has none. */
const named = (machine: Machine, name: string | undefined) => (machine.processos ?? []).filter((p) => programOf(p.comando) === name);

/** Whether a condition holds in the machine. */
export function holds(condition: ExerciseCondition, machine: Machine): boolean {
  // A machine that is not a machine (nothing loaded yet) holds nothing.
  if (!machine?.contas) return false;
  const node = condition.path ? nodeAt(machine, condition.path) : undefined;
  switch (condition.kind) {
    case "DIR_EXISTS":
      return node?.tipo === "diretorio";
    case "FILE_EXISTS":
      return node !== undefined && node.tipo !== "diretorio";
    case "PATH_ABSENT":
      return node === undefined;
    case "FILE_CONTENT": {
      if (node?.tipo !== "arquivo") return false;
      const text = trimEnd(node.conteudo ?? "");
      const wanted = trimEnd(condition.content ?? "");
      return condition.match === "contains" ? text.includes(wanted) : text === wanted;
    }
    case "MODE":
      return node !== undefined && node.tipo !== "link" && octal(node.permissoes) === octal(condition.mode ?? "");
    case "OWNER": {
      if (!node) return false;
      const user = machine.contas.usuarios.find((u) => u.uid === node.dono)?.nome;
      const group = machine.contas.grupos.find((g) => g.gid === node.grupo)?.nome;
      return user === condition.owner && (condition.group === undefined || condition.group === "" || group === condition.group);
    }
    case "LINK":
      return node?.tipo === "link" && node.alvo === condition.target;
    case "USER_EXISTS":
      return machine.contas.usuarios.some((u) => u.nome === condition.name);
    case "GROUP_EXISTS":
      return machine.contas.grupos.some((g) => g.nome === condition.name);
    case "USER_IN_GROUP": {
      const group = machine.contas.grupos.find((g) => g.nome === condition.name);
      const user = machine.contas.usuarios.find((u) => u.nome === condition.user);
      return Boolean(group && user && ((group.membros ?? []).includes(user.nome) || user.gid === group.gid));
    }
    case "PROCESS_RUNNING":
      return named(machine, condition.name).some((p) => !p.estado.startsWith("T"));
    case "PROCESS_ABSENT":
      return named(machine, condition.name).length === 0;
    case "PROCESS_STOPPED":
      return named(machine, condition.name).some((p) => p.estado.startsWith("T"));
    case "PROCESS_ENDED_BY":
      return (machine.encerrados ?? []).some((e) => programOf(e.comando) === condition.name && (condition.signal === undefined || e.sinal === condition.signal));
    case "PROCESS_NICE":
      return named(machine, condition.name).some((p) => p.nice === condition.nice);
    default:
      return false;
  }
}

/** A condition in words, for the teacher's list and for what the student is missing. */
export function describeCondition(c: ExerciseCondition): string {
  switch (c.kind) {
    case "DIR_EXISTS":
      return `A pasta ${c.path} existe`;
    case "FILE_EXISTS":
      return `O arquivo ${c.path} existe`;
    case "PATH_ABSENT":
      return `${c.path} não existe mais`;
    case "FILE_CONTENT":
      return c.match === "contains" ? `O arquivo ${c.path} contém o texto esperado` : `O arquivo ${c.path} tem o texto esperado`;
    case "MODE":
      return `${c.path} tem a permissão ${c.mode}`;
    case "OWNER":
      return `${c.path} pertence a ${c.owner}${c.group ? `:${c.group}` : ""}`;
    case "LINK":
      return `${c.path} é um link para ${c.target}`;
    case "USER_EXISTS":
      return `O usuário ${c.name} existe`;
    case "GROUP_EXISTS":
      return `O grupo ${c.name} existe`;
    case "USER_IN_GROUP":
      return `${c.user} está no grupo ${c.name}`;
    case "PROCESS_RUNNING":
      return `O programa ${c.name} está rodando`;
    case "PROCESS_ABSENT":
      return `O programa ${c.name} não está mais rodando`;
    case "PROCESS_STOPPED":
      return `O programa ${c.name} está parado`;
    case "PROCESS_ENDED_BY":
      return c.signal === undefined ? `O programa ${c.name} foi encerrado por um sinal` : `O programa ${c.name} foi encerrado pelo sinal ${c.signal}`;
    case "PROCESS_NICE":
      return `O programa ${c.name} tem a prioridade (nice) ${c.nice}`;
    default:
      return "";
  }
}

export interface ConditionsResult {
  /** Every condition holds. */
  done: boolean;
  missing: ExerciseCondition[];
}

/** Checks the conditions of an exercise on the machine of the student: only how it ended counts, not how. */
export function checkConditions(conditions: ExerciseCondition[], machine: unknown): ConditionsResult {
  const missing = conditions.filter((c) => !holds(c, machine as Machine));
  return { done: conditions.length > 0 && missing.length === 0, missing };
}
