import { describe, expect, it } from "vitest";
import { reconcile, type MachineTree, type TreeNode } from "./machineDiff";

const dir = (nome: string, filhos: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos, ...extra });
const file = (nome: string, conteudo: string, extra: Partial<TreeNode> = {}): TreeNode => ({ nome, tipo: "arquivo", dono: 0, grupo: 0, permissoes: "644", conteudo, ...extra });
const machine = (...home: TreeNode[]): MachineTree => ({
  raiz: dir("", [dir("home", [dir("ricardo", home)]), dir("var", [dir("log", [file("syslog", "ruido")])])]),
  contas: { usuarios: [{ nome: "root", uid: 0 }, { nome: "ricardo", uid: 1000 }], grupos: [{ nome: "root", gid: 0 }, { nome: "ricardo", gid: 1000 }] },
});
const commands = (r: ReturnType<typeof reconcile>) => r.steps.map((s) => s.command);

// Covers the exactness of the snapshot of a module (SPEC-021): what the replay lacks is added as commands.
describe("reconcile", () => {
  it("needs nothing when the replayed machine is the same, whatever the clock or the history say", () => {
    const a = machine(dir("financeiro", [file("a.txt", "x\n")]), file(".bash_history", "ls\ncat a\n"));
    const b = machine(dir("financeiro", [file("a.txt", "x\n")]), file(".bash_history", "ls\n"));
    expect(reconcile(a, b)).toEqual({ steps: [], inexact: [] });
  });

  it("writes the file with the text typed in an editor, which the command alone leaves empty", () => {
    const recorded = machine(dir("financeiro", [file("teste.txt", "1. Cluster UTFPR com IA\n2. Scripts de automação em bash\n3. Infraestrutura em nuvem\n")]));
    const replayed = machine(dir("financeiro", [file("teste.txt", "")]));
    const r = reconcile(recorded, replayed);
    expect(commands(r)).toEqual([String.raw`printf '%s\n' '1. Cluster UTFPR com IA' '2. Scripts de automação em bash' '3. Infraestrutura em nuvem' > '/home/ricardo/financeiro/teste.txt'`]);
    expect(r.inexact).toEqual([]);
  });

  it("creates what is missing, parents first, with the permissions and the owner the author gave", () => {
    const recorded = machine(dir("proj", [dir("sub", [file("x.txt", "oi\n", { permissoes: "600", dono: 1000, grupo: 1000 })], { permissoes: "700" })]));
    const r = reconcile(recorded, machine());
    expect(commands(r)).toEqual([
      "mkdir -p '/home/ricardo/proj'",
      "mkdir -p '/home/ricardo/proj/sub'",
      "chmod 700 '/home/ricardo/proj/sub'",
      String.raw`printf '%s\n' 'oi' > '/home/ricardo/proj/sub/x.txt'`,
      "chmod 600 '/home/ricardo/proj/sub/x.txt'",
      "chown ricardo:ricardo '/home/ricardo/proj/sub/x.txt'",
    ]);
  });

  it("changes the permissions and the owner of what already exists, without rewriting it", () => {
    const recorded = machine(file("a.txt", "x\n", { permissoes: "600", dono: 1000, grupo: 0 }));
    const r = reconcile(recorded, machine(file("a.txt", "x\n")));
    expect(commands(r)).toEqual(["chmod 600 '/home/ricardo/a.txt'", "chown ricardo:root '/home/ricardo/a.txt'"]);
  });

  it("removes what the replay made and the author did not have, and replaces what changed its kind", () => {
    const recorded = machine(file("igual", "a\n"), dir("virou"));
    const replayed = machine(file("igual", "a\n"), file("sobrou.txt", "x\n"), dir("lixo", [file("dentro", "y\n")]), file("virou", "z\n"));
    const r = reconcile(recorded, replayed);
    expect(commands(r)).toEqual(["rm -rf '/home/ricardo/lixo'", "rm -rf '/home/ricardo/sobrou.txt'", "rm -rf '/home/ricardo/virou'", "mkdir -p '/home/ricardo/virou'"]);
  });

  it("recreates a link that points somewhere else", () => {
    const recorded = machine({ nome: "atalho", tipo: "link", dono: 0, grupo: 0, permissoes: "777", alvo: "/srv/novo" });
    const replayed = machine({ nome: "atalho", tipo: "link", dono: 0, grupo: 0, permissoes: "777", alvo: "/srv/velho" });
    expect(commands(reconcile(recorded, replayed))).toEqual(["rm -f '/home/ricardo/atalho'", "ln -s '/srv/novo' '/home/ricardo/atalho'"]);
  });

  it("says what no command can reproduce, instead of hiding it", () => {
    const backslash = file("b.txt", "a" + String.fromCharCode(92) + "nb" + String.fromCharCode(10));
    const noNewline = file("c.txt", "sem quebra");
    const binary: TreeNode = { nome: "bin", tipo: "binario", dono: 0, grupo: 0, permissoes: "755" };
    const orphan = file("d.txt", "x" + String.fromCharCode(10), { dono: 4242 });
    const r = reconcile(machine(backslash, noNewline, binary, orphan), machine());
    expect(r.inexact).toHaveLength(4);
    expect(r.inexact.join("|")).toContain("barra invertida");
    expect(r.inexact.join("|")).toContain("não termina com quebra de linha");
    expect(r.inexact.join("|")).toContain('"binario"');
    expect(r.inexact.join("|")).toContain("não tem nome");
  });

  it("warns about an account the commands do not create", () => {
    const recorded = machine();
    recorded.contas.usuarios.push({ nome: "ana", uid: 1001 });
    expect(reconcile(recorded, machine()).inexact).toEqual(["Usuário ana: existe no terminal e não é criado pelos comandos."]);
  });
});
