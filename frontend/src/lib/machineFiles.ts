// Puts the files of a snapshot into a serialized machine, as they are. A file kept as data can be as large as a
// log or a page, which no command typed in the terminal could carry (SPEC-021 RN-12).

import type { SetupFile } from "./setup";

/** The parts of a serialized machine this file reads and writes. */
interface Node {
  nome: string;
  tipo: string;
  dono: number;
  grupo: number;
  permissoes: string;
  modificadoEm?: string;
  conteudo?: string;
  filhos?: Node[];
  [key: string]: unknown;
}

export interface MachineJson {
  raiz: Node;
  contas: { usuarios: { nome: string; uid: number }[]; grupos: { nome: string; gid: number }[] };
  [key: string]: unknown;
}

/** A copy of the machine with the files written, the folders in their way created, and their mode and owner set. */
export function overlayFiles(machine: MachineJson, files: SetupFile[], now: Date = new Date()): MachineJson {
  const next = JSON.parse(JSON.stringify(machine)) as MachineJson;
  const stamp = now.toISOString();
  const uid = (name: string) => {
    const found = next.contas.usuarios.find((u) => u.nome === name);
    if (!found) throw new Error(`o usuário ${name} não existe na máquina`);
    return found.uid;
  };
  const gid = (name: string) => {
    const found = next.contas.grupos.find((g) => g.nome === name);
    if (!found) throw new Error(`o grupo ${name} não existe na máquina`);
    return found.gid;
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`${file.path} não é um arquivo`);
    let folder = next.raiz;
    for (const part of parts) {
      let child = (folder.filhos ??= []).find((n) => n.nome === part);
      if (!child) {
        child = { nome: part, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", modificadoEm: stamp, filhos: [] };
        folder.filhos.push(child);
      } else if (child.tipo !== "diretorio") {
        throw new Error(`${part} é um arquivo, não uma pasta (${file.path})`);
      }
      folder = child;
    }

    const siblings = (folder.filhos ??= []);
    const at = siblings.findIndex((n) => n.nome === name);
    if (at >= 0 && siblings[at]!.tipo === "diretorio") throw new Error(`${file.path} é uma pasta`);
    // An existing file keeps its mode and owner unless the snapshot says otherwise.
    const old = at >= 0 && siblings[at]!.tipo === "arquivo" ? siblings[at] : undefined;
    const node: Node = {
      nome: name,
      tipo: "arquivo",
      dono: file.owner ? uid(file.owner) : (old?.dono ?? 0),
      grupo: file.group ? gid(file.group) : (old?.grupo ?? 0),
      permissoes: file.mode ?? old?.permissoes ?? "644",
      modificadoEm: stamp,
      conteudo: file.content,
    };
    if (at >= 0) siblings[at] = node;
    else siblings.push(node);
  }
  return next;
}
