import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "./setup";
import { reconcile, type MachineTree, type TreeNode } from "./machineDiff";

const NL = String.fromCharCode(10);
const dir = (nome: string, filhos: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos, ...extra });
const file = (nome: string, conteudo: string, extra: Partial<TreeNode> = {}): TreeNode => ({ nome, tipo: "arquivo", dono: 0, grupo: 0, permissoes: "644", conteudo, ...extra });
const machine = (...home: TreeNode[]): MachineTree => ({
  raiz: dir("", [dir("home", [dir("ricardo", home)]), dir("var", [dir("log", [file("syslog", "ruido")])])]),
  contas: { usuarios: [{ nome: "root", uid: 0 }, { nome: "ricardo", uid: 1000 }], grupos: [{ nome: "root", gid: 0 }, { nome: "ricardo", gid: 1000 }] },
});
const commands = (r: ReturnType<typeof reconcile>) => r.steps.map((s) => s.command);

// Covers the exactness of the snapshot of a module (SPEC-021): what the replay lacks is added, files as data.
describe("reconcile", () => {
  it("needs nothing when the replayed machine is the same, whatever the clock or the history say", () => {
    const a = machine(dir("financeiro", [file("a.txt", "x" + NL)]), file(".bash_history", "ls" + NL + "cat a" + NL));
    const b = machine(dir("financeiro", [file("a.txt", "x" + NL)]), file(".bash_history", "ls" + NL));
    expect(reconcile(a, b)).toEqual({ steps: [], files: [], inexact: [] });
  });

  it("keeps the file with the text typed in an editor, which the command alone leaves empty, as a file", () => {
    const text = ["1. Cluster UTFPR com IA", "2. Scripts de automação em bash", "3. Infraestrutura em nuvem"].join(NL) + NL;
    const recorded = machine(dir("financeiro", [file("teste.txt", text)]));
    const replayed = machine(dir("financeiro", [file("teste.txt", "")]));
    expect(reconcile(recorded, replayed)).toEqual({ steps: [], files: [{ path: "/home/ricardo/financeiro/teste.txt", content: text, mode: "644", owner: "root", group: "root" }], inexact: [] });
  });

  it("keeps any text as it is: backslashes, no line break at the end, blank lines, markup", () => {
    const tricky = "a" + String.fromCharCode(92) + "nb" + NL + NL + "<h1>ação</h1>  ";
    const r = reconcile(machine(file("p.html", tricky)), machine());
    expect(r.inexact).toEqual([]);
    expect(r.files[0]!.content).toBe(tricky);
  });

  it("takes a large file whole", () => {
    const log = ("192.168.0.10 GET /index.html 200" + NL).repeat(25000);
    const r = reconcile(machine(dir("logs", [file("access.log", log)])), machine());
    expect(r.inexact).toEqual([]);
    expect(r.files[0]!.content).toBe(log);
  });

  it("creates what is missing, parents first, the files with the permissions and the owner the author gave", () => {
    const recorded = machine(dir("proj", [dir("sub", [file("x.txt", "oi" + NL, { permissoes: "600", dono: 1000, grupo: 1000 })], { permissoes: "700" })]));
    const r = reconcile(recorded, machine());
    expect(commands(r)).toEqual(["mkdir -p '/home/ricardo/proj'", "mkdir -p '/home/ricardo/proj/sub'", "chmod 700 '/home/ricardo/proj/sub'"]);
    expect(r.files).toEqual([{ path: "/home/ricardo/proj/sub/x.txt", content: "oi" + NL, mode: "600", owner: "ricardo", group: "ricardo" }]);
  });

  it("changes the permissions and the owner of what already exists, without rewriting it", () => {
    const recorded = machine(file("a.txt", "x" + NL, { permissoes: "600", dono: 1000, grupo: 0 }));
    const r = reconcile(recorded, machine(file("a.txt", "x" + NL)));
    expect(commands(r)).toEqual(["chmod 600 '/home/ricardo/a.txt'", "chown ricardo:root '/home/ricardo/a.txt'"]);
    expect(r.files).toEqual([]);
  });

  it("removes what the replay made and the author did not have, and replaces what changed its kind", () => {
    const recorded = machine(file("igual", "a" + NL), dir("virou"));
    const replayed = machine(file("igual", "a" + NL), file("sobrou.txt", "x" + NL), dir("lixo", [file("dentro", "y" + NL)]), file("virou", "z" + NL));
    expect(commands(reconcile(recorded, replayed))).toEqual(["rm -rf '/home/ricardo/lixo'", "rm -rf '/home/ricardo/sobrou.txt'", "rm -rf '/home/ricardo/virou'", "mkdir -p '/home/ricardo/virou'"]);
  });

  it("recreates a link that points somewhere else", () => {
    const recorded = machine({ nome: "atalho", tipo: "link", dono: 0, grupo: 0, permissoes: "777", alvo: "/srv/novo" });
    const replayed = machine({ nome: "atalho", tipo: "link", dono: 0, grupo: 0, permissoes: "777", alvo: "/srv/velho" });
    expect(commands(reconcile(recorded, replayed))).toEqual(["rm -f '/home/ricardo/atalho'", "ln -s '/srv/novo' '/home/ricardo/atalho'"]);
  });

  it("says what no snapshot can reproduce, instead of hiding it", () => {
    const binary: TreeNode = { nome: "bin", tipo: "binario", dono: 0, grupo: 0, permissoes: "755" };
    const orphan = file("d.txt", "x" + NL, { dono: 4242 });
    const huge = file("enorme.log", "a".repeat(MAX_FILE_BYTES + 1));
    const r = reconcile(machine(binary, orphan, huge), machine());
    expect(r.files).toEqual([]);
    expect(r.inexact).toHaveLength(3);
    expect(r.inexact.join("|")).toContain('"binario"');
    expect(r.inexact.join("|")).toContain("não tem nome");
    expect(r.inexact.join("|")).toContain("o limite é de 1 MB por arquivo");
  });

  it("stays within the total of files of a snapshot", () => {
    const chunk = "b".repeat(MAX_FILE_BYTES - 10);
    const recorded = machine(...["a", "b", "c", "d", "e"].map((n) => file(`${n}.log`, chunk)));
    const r = reconcile(recorded, machine());
    expect(r.files).toHaveLength(4);
    expect(r.inexact).toEqual(["/home/ricardo/e.log: passaria do limite de 4 MB de arquivos no ambiente."]);
  });

  it("warns about an account the commands do not create", () => {
    const recorded = machine();
    recorded.contas.usuarios.push({ nome: "ana", uid: 1001 });
    expect(reconcile(recorded, machine()).inexact).toEqual(["Usuário ana: existe no terminal e não é criado pelos comandos."]);
  });
});
