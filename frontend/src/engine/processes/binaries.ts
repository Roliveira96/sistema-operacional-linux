// The engine runs a program only if a binary with its name exists in a folder of the PATH. The commands of the process control that are new
// get theirs here, copied from an existing one, so `which`, `ls /usr/bin` and the shell find them like any other (the ones that are
// bash builtins, like kill, need none). Only the missing ones are added.

interface Node {
  nome: string;
  clonar?(): Node;
  obter?(name: string): Node | undefined;
  adicionar?(node: Node): void;
}

export function installBinaries(machine: { fs: { obter(path: string): Node | null } }, names: string[]): void {
  const template = machine.fs.obter("/usr/bin/ls");
  const folder = machine.fs.obter("/usr/bin");
  if (!template?.clonar || !folder?.obter || !folder.adicionar) return;
  for (const name of names) {
    if (folder.obter(name)) continue;
    const copy = template.clonar();
    copy.nome = name;
    folder.adicionar(copy);
  }
}
