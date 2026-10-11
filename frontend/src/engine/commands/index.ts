import { installEngineBinaries } from "./binaries";
import { createOpenssl } from "./crypto/openssl";
import { sshCommands } from "./crypto/ssh";
import { withVersion } from "./curl";
import { diskCommands } from "./disk";
import { encodingCommands } from "./encoding";
import { networkCommands } from "./network";
import { processCommands } from "./process";
import { setRegistry } from "./registry";
import { systemCommands } from "./system";
import { textCommands } from "./text";
import type { CommandRegistry, EngineCommand } from "./types";

/** The commands SPEC-028 adds to the engine, and the du that replaces the one of the engine (RN-13). */
export const newCommands: EngineCommand[] = [...textCommands, ...systemCommands, ...processCommands, ...networkCommands, ...diskCommands, ...encodingCommands, ...sshCommands];

/** Gives the machine a binary for each new command, so the shell finds them in the PATH. */
export function addEngineBinaries(machine: Parameters<typeof installEngineBinaries>[0]): void {
  installEngineBinaries(machine, newCommands.map((command) => command.nome));
}

const registered = new WeakSet<CommandRegistry>();

/** Registers the new commands in the catalog of the engine, once per catalog (RN-01). */
export function registerEngineCommands(registry: CommandRegistry): void {
  setRegistry(registry);
  if (registered.has(registry)) return;
  registered.add(registry);
  const curl = registry.obter("curl");
  registry.registrar(...newCommands);
  if (curl) registry.registrar(withVersion(curl));
  const openssl = registry.obter("openssl");
  if (openssl) registry.registrar(createOpenssl(openssl));
}
