import { describe, expect, it } from "vitest";
import { overlayFiles, type MachineJson } from "./machineFiles";

const dir = (nome: string, filhos: MachineJson["raiz"][] = []) => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos });
const file = (nome: string, conteudo: string, extra: object = {}) => ({ nome, tipo: "arquivo", dono: 0, grupo: 0, permissoes: "644", conteudo, ...extra });
const machine = (...root: MachineJson["raiz"][]): MachineJson => ({
  raiz: dir("", root),
  contas: { usuarios: [{ nome: "root", uid: 0 }, { nome: "ana", uid: 1001 }], grupos: [{ nome: "root", gid: 0 }, { nome: "adm", gid: 4 }] },
});
const find = (m: MachineJson, ...path: string[]) => path.reduce<MachineJson["raiz"] | undefined>((node, name) => node?.filhos?.find((n) => n.nome === name), m.raiz);

// Covers SPEC-021 RN-12: the files of a snapshot go into the machine exactly as they are.
describe("overlayFiles", () => {
  it("writes a file with the text untouched, creating the folders in its way", () => {
    const text = ["2026-10-09 ERROR \"falha\"", "", "  com espaços no fim  ", "barra \\ n", "<h1>ação</h1>"].join(String.fromCharCode(10)) + String.fromCharCode(10);
    const next = overlayFiles(machine(), [{ path: "/var/log/app/app.log", content: text }]);
    const node = find(next, "var", "log", "app", "app.log");
    expect(node?.conteudo).toBe(text);
    expect([node?.permissoes, node?.dono, node?.grupo]).toEqual(["644", 0, 0]);
    expect(find(next, "var", "log", "app")?.tipo).toBe("diretorio");
  });

  it("sets the mode and the owner by name, and does not touch the machine it was given", () => {
    const original = machine(dir("srv"));
    const before = JSON.stringify(original);
    const next = overlayFiles(original, [{ path: "/srv/a.txt", content: "x", mode: "600", owner: "ana", group: "adm" }]);
    const node = find(next, "srv", "a.txt");
    expect([node?.permissoes, node?.dono, node?.grupo]).toEqual(["600", 1001, 4]);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("replaces the text of a file that exists, keeping its mode and owner unless told otherwise", () => {
    const base = machine(dir("srv", [file("a.txt", "velho", { permissoes: "640", dono: 1001, grupo: 4 })]));
    const kept = find(overlayFiles(base, [{ path: "/srv/a.txt", content: "novo" }]), "srv", "a.txt");
    expect([kept?.conteudo, kept?.permissoes, kept?.dono, kept?.grupo]).toEqual(["novo", "640", 1001, 4]);
    const changed = find(overlayFiles(base, [{ path: "/srv/a.txt", content: "novo", mode: "600" }]), "srv", "a.txt");
    expect(changed?.permissoes).toBe("600");
  });

  it("takes a large file whole", () => {
    const line = "192.168.0.10 - - [09/Oct/2026:12:00:00] \"GET /index.html HTTP/1.1\" 200 512" + String.fromCharCode(10);
    const text = line.repeat(Math.floor((900 * 1024) / line.length));
    expect(find(overlayFiles(machine(), [{ path: "/var/log/nginx/access.log", content: text }]), "var", "log", "nginx", "access.log")?.conteudo).toBe(text);
  });

  it("refuses what cannot be a file there", () => {
    expect(() => overlayFiles(machine(dir("srv")), [{ path: "/srv", content: "x" }])).toThrow("é uma pasta");
    expect(() => overlayFiles(machine(file("srv", "x")), [{ path: "/srv/a.txt", content: "x" }])).toThrow("é um arquivo, não uma pasta");
    expect(() => overlayFiles(machine(), [{ path: "/a", content: "x", owner: "ninguem" }])).toThrow("o usuário ninguem não existe");
    expect(() => overlayFiles(machine(), [{ path: "/a", content: "x", group: "nada" }])).toThrow("o grupo nada não existe");
  });
});
