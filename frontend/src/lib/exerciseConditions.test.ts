import { describe, expect, it } from "vitest";
import { checkConditions, deriveConditions, describeCondition, holds, MAX_CONDITIONS, type ExerciseCondition } from "./exerciseConditions";
import type { TreeNode } from "./machineDiff";

const NL = String.fromCharCode(10);
const dir = (nome: string, filhos: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos, ...extra });
const file = (nome: string, conteudo: string, extra: Partial<TreeNode> = {}): TreeNode => ({ nome, tipo: "arquivo", dono: 0, grupo: 0, permissoes: "644", conteudo, ...extra });
const machine = (home: TreeNode[] = [], extra: { users?: string[]; groups?: { nome: string; membros?: string[] }[] } = {}) => ({
  raiz: dir("", [dir("home", [dir("ricardo", home)]), dir("var", [dir("log", [file("syslog", "ruido")])])]),
  contas: {
    usuarios: [{ nome: "root", uid: 0, gid: 0 }, { nome: "ricardo", uid: 1000, gid: 1000 }, ...(extra.users ?? []).map((nome, i) => ({ nome, uid: 1001 + i, gid: 1001 + i }))],
    grupos: [{ nome: "root", gid: 0, membros: [] }, { nome: "ricardo", gid: 1000, membros: [] }, ...(extra.groups ?? []).map((g, i) => ({ nome: g.nome, gid: 2000 + i, membros: g.membros ?? [] }))],
  },
});
const kinds = (list: ExerciseCondition[]) => list.map((c) => [c.kind, c.path ?? c.name ?? c.user].join(" "));

// Covers SPEC-022 RN-11 and RN-12: how an exercise ends, worked out from what the teacher did and checked on the student's machine.
describe("deriveConditions", () => {
  it("says nothing when nothing changed, whatever the machine does by itself", () => {
    const a = machine([file(".bash_history", "ls" + NL)]);
    const b = machine([file(".bash_history", "ls" + NL + "pwd" + NL)]);
    expect(deriveConditions(a, b)).toEqual([]);
  });

  it("turns what the teacher created into conditions: folders, files with their text, permissions and owners", () => {
    const before = machine();
    const after = machine([dir("financeiro", [file("teste.txt", "123" + NL, { permissoes: "600", dono: 1000, grupo: 1000 }), file("vazio.txt", "")])]);
    const list = deriveConditions(before, after);
    expect(kinds(list)).toEqual([
      "DIR_EXISTS /home/ricardo/financeiro",
      "FILE_EXISTS /home/ricardo/financeiro/teste.txt",
      "FILE_CONTENT /home/ricardo/financeiro/teste.txt",
      "MODE /home/ricardo/financeiro/teste.txt",
      "OWNER /home/ricardo/financeiro/teste.txt",
      "FILE_EXISTS /home/ricardo/financeiro/vazio.txt",
    ]);
    expect(list[2]).toMatchObject({ content: "123" + NL, match: "equals" });
    expect(list[3]).toMatchObject({ mode: "600" });
    expect(list[4]).toMatchObject({ owner: "ricardo", group: "ricardo" });
  });

  it("notices a changed text, a removed path and a link", () => {
    const before = machine([file("a.txt", "velho" + NL), dir("lixo", [file("x", "y")])]);
    const after = machine([file("a.txt", "novo" + NL), { nome: "atalho", tipo: "link", dono: 0, grupo: 0, permissoes: "777", alvo: "/srv/x" }]);
    expect(kinds(deriveConditions(before, after))).toEqual(["PATH_ABSENT /home/ricardo/lixo", "FILE_CONTENT /home/ricardo/a.txt", "LINK /home/ricardo/atalho"]);
  });

  it("notices users, groups and who belongs to them", () => {
    const before = machine([], { users: [], groups: [{ nome: "contabil" }] });
    const after = machine([], { users: ["ana"], groups: [{ nome: "contabil", membros: ["ana"] }, { nome: "ti" }] });
    expect(kinds(deriveConditions(before, after))).toEqual(["USER_EXISTS ana", "GROUP_EXISTS ti", "USER_IN_GROUP contabil"]);
    expect(deriveConditions(before, after).at(-1)).toMatchObject({ user: "ana", name: "contabil" });
  });

  it("keeps at most what the server takes, and leaves the text of a huge file out", () => {
    const many = Array.from({ length: MAX_CONDITIONS + 20 }, (_, i) => dir(`d${String(i).padStart(3, "0")}`));
    expect(deriveConditions(machine(), machine(many))).toHaveLength(MAX_CONDITIONS);
    const huge = file("enorme.log", "a".repeat(1048577));
    expect(kinds(deriveConditions(machine(), machine([huge])))).toEqual(["FILE_EXISTS /home/ricardo/enorme.log"]);
  });
});

describe("checkConditions, the student's machine", () => {
  const end = machine(
    [dir("financeiro", [file("teste.txt", "123" + NL, { permissoes: "600", dono: 1001, grupo: 2000 })]), { nome: "atalho", tipo: "link", dono: 0, grupo: 0, permissoes: "777", alvo: "/srv/x" }],
    { users: ["ana"], groups: [{ nome: "contabil", membros: ["ana"] }] },
  );

  it("is done when every condition holds, whatever way the machine got there", () => {
    const conditions: ExerciseCondition[] = [
      { kind: "DIR_EXISTS", path: "/home/ricardo/financeiro" },
      { kind: "FILE_EXISTS", path: "/home/ricardo/financeiro/teste.txt" },
      { kind: "FILE_CONTENT", path: "/home/ricardo/financeiro/teste.txt", content: "123", match: "equals" },
      { kind: "MODE", path: "/home/ricardo/financeiro/teste.txt", mode: "0600" },
      { kind: "OWNER", path: "/home/ricardo/financeiro/teste.txt", owner: "ana", group: "contabil" },
      { kind: "OWNER", path: "/home/ricardo/financeiro/teste.txt", owner: "ana" },
      { kind: "LINK", path: "/home/ricardo/atalho", target: "/srv/x" },
      { kind: "PATH_ABSENT", path: "/home/ricardo/nao-existe" },
      { kind: "USER_EXISTS", name: "ana" },
      { kind: "GROUP_EXISTS", name: "contabil" },
      { kind: "USER_IN_GROUP", user: "ana", name: "contabil" },
    ];
    expect(checkConditions(conditions, end)).toEqual({ done: true, missing: [] });
  });

  it("compares a text without caring about the line break at the end, and 'contains' only needs the text to be there", () => {
    const text = (match: "equals" | "contains", content: string) => ({ kind: "FILE_CONTENT" as const, path: "/home/ricardo/financeiro/teste.txt", content, match });
    expect(holds(text("equals", "123"), end)).toBe(true);
    expect(holds(text("equals", "12"), end)).toBe(false);
    expect(holds(text("contains", "12"), end)).toBe(true);
    expect(holds(text("contains", "99"), end)).toBe(false);
  });

  it("says what is still missing", () => {
    const conditions: ExerciseCondition[] = [{ kind: "DIR_EXISTS", path: "/home/ricardo/outra" }, { kind: "USER_EXISTS", name: "bruno" }, { kind: "DIR_EXISTS", path: "/home/ricardo/financeiro" }];
    const result = checkConditions(conditions, end);
    expect(result.done).toBe(false);
    expect(result.missing.map(describeCondition)).toEqual(["A pasta /home/ricardo/outra existe", "O usuário bruno existe"]);
  });

  it("never counts a lack of conditions or of a machine as done", () => {
    expect(checkConditions([], end).done).toBe(false);
    expect(checkConditions([{ kind: "DIR_EXISTS", path: "/home" }], { formato: "x" }).done).toBe(false);
    expect(holds({ kind: "FILE_EXISTS", path: "/home/ricardo/financeiro" }, end)).toBe(false);
    expect(holds({ kind: "SOMETHING" as never }, end)).toBe(false);
  });

  it("describes every kind in words", () => {
    const all: ExerciseCondition[] = [
      { kind: "DIR_EXISTS", path: "/a" },
      { kind: "FILE_EXISTS", path: "/a" },
      { kind: "PATH_ABSENT", path: "/a" },
      { kind: "FILE_CONTENT", path: "/a", match: "equals" },
      { kind: "FILE_CONTENT", path: "/a", match: "contains" },
      { kind: "MODE", path: "/a", mode: "644" },
      { kind: "OWNER", path: "/a", owner: "ana", group: "adm" },
      { kind: "LINK", path: "/a", target: "/b" },
      { kind: "USER_EXISTS", name: "ana" },
      { kind: "GROUP_EXISTS", name: "adm" },
      { kind: "USER_IN_GROUP", user: "ana", name: "adm" },
    ];
    expect(all.map(describeCondition).every((text) => text.length > 0)).toBe(true);
    expect(describeCondition(all[6]!)).toBe("/a pertence a ana:adm");
  });
});
