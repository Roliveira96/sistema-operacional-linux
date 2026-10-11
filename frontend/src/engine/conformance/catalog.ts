import type { ItemKind } from "./types";

export interface EngineCatalog {
  commands: string[];
  programs: string[];
}

interface FolderNode {
  filhos?: Map<string, unknown>;
}

const PATH_FOLDERS = ["/usr/bin", "/usr/sbin", "/bin", "/sbin", "/usr/local/bin"];

/**
 * What the engine really has (SPEC-030, section 3.3): the commands of its catalog, and the programs, which are the executables of the PATH of
 * a fresh machine and the ones the packages of the simulated apt give, when they are not commands.
 */
export async function engineCatalog(): Promise<EngineCatalog> {
  const [{ Shell }, { Maquina }, { CATALOGO }] = await Promise.all([
    import("@legacy-engine/shell/Shell"),
    import("@legacy-engine/linux/Maquina"),
    import("@legacy-engine/linux/Pacotes"),
  ]);
  const commands = Shell.obterRegistro()
    .listar()
    .map((command) => command.nome)
    .sort();
  const known = new Set(commands);
  const programs = new Set<string>();
  const machine = Maquina.criar();
  for (const path of PATH_FOLDERS) {
    const folder = machine.fs.obter(path) as unknown as FolderNode | null;
    for (const name of folder?.filhos?.keys() ?? []) if (!known.has(name)) programs.add(name);
  }
  for (const pack of CATALOGO) for (const program of pack.programas) {
    const name = program.split("/").pop()!;
    if (!known.has(name)) programs.add(name);
  }
  return { commands, programs: [...programs].sort() };
}

export function catalogNames(catalog: EngineCatalog): Array<{ name: string; kind: ItemKind }> {
  return [...catalog.commands.map((name) => ({ name, kind: "command" as const })), ...catalog.programs.map((name) => ({ name, kind: "program" as const }))];
}
