import type { EngineNode } from "./types";

/** Commands that live in /usr/sbin on Ubuntu; the others live in /usr/bin. */
const SBIN = new Set(["ufw", "swapon", "ifconfig", "ip"]);

export const binaryFolder = (name: string): string => (SBIN.has(name) ? "/usr/sbin" : "/usr/bin");

/**
 * The engine runs a program only if a binary with its name exists in a folder of the PATH. The commands of the
 * catalog that come from this adapter get their binary here, copied from an existing one, so `ls /usr/bin`, `which`
 * and the shell see them like any other. Only the missing ones are added (RN-01).
 */
export function installEngineBinaries(machine: { fs: { obter(path: string): EngineNode | null } }, names: string[]): void {
  const template = machine.fs.obter("/usr/bin/ls");
  if (!template?.clonar) return;
  for (const name of names) {
    const folder = binaryFolder(name);
    const directory = machine.fs.obter(folder);
    if (!directory?.obter || !directory.adicionar || directory.obter(name)) continue;
    const copy = template.clonar();
    copy.nome = name;
    directory.adicionar(copy);
  }
}
