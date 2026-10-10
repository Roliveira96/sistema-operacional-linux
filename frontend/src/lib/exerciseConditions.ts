// An exercise can be done in many ways; what matters is how it ends (SPEC-022). The conditions of finalization say what
// must hold in the machine at the end. They are worked out from what the teacher did in the terminal (the machine before
// and after) and checked on the machine of the student.

import { bytesOf, MAX_FILE_BYTES } from "./setup";
import { flattenTree, type MachineTree } from "./machineDiff";

export type ConditionKind = "DIR_EXISTS" | "FILE_EXISTS" | "PATH_ABSENT" | "FILE_CONTENT" | "MODE" | "OWNER" | "LINK" | "USER_EXISTS" | "GROUP_EXISTS" | "USER_IN_GROUP";

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
  /** A user, or a group when the kind is about one. */
  name?: string;
  user?: string;
}

/** The most conditions an exercise keeps (the server's limit). */
export const MAX_CONDITIONS = 100;

/** The machine as the engine serializes it, with the accounts this file reads. */
type Machine = MachineTree & {
  contas: MachineTree["contas"] & { usuarios: { nome: string; uid: number; gid?: number }[]; grupos: { nome: string; gid: number; membros?: string[] }[] };
};

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
  return list.slice(0, MAX_CONDITIONS);
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
