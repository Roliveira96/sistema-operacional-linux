import { installBinaries } from "./binaries";
import { yesCommand, watchCommand } from "./loops";
import { makeKill } from "./kill";
import { niceCommand, reniceCommand } from "./nice";
import { makePs, setProcessLister, type ProcessLine } from "./ps";
import { setNotTerminalOutputs } from "./output";
import type { EngineCommand } from "./types";

/** What the catalog of commands of the engine lets a command be added to. */
interface Registry {
  registrar(...commands: never[]): void;
  obter(name: string): unknown;
}

/** The commands the process control adds on its own (SPEC-029 entrega A). */
export const processCommands: EngineCommand[] = [yesCommand, watchCommand, niceCommand, reniceCommand];

const done = new WeakSet<object>();

/**
 * Adds the commands of the process control to the catalog of the engine. The legacy code is only read: a command that extends one of
 * the engine (ps, kill) wraps the original and hands it what is not new. Safe to call at every mount: it registers once per catalog.
 */
export async function registerProcessCommands(registry: Registry): Promise<void> {
  if (done.has(registry)) return;
  done.add(registry);
  const { SaidaEmTexto, SaidaParaArquivo } = await import("@legacy-engine/shell/Saida");
  setNotTerminalOutputs([SaidaEmTexto, SaidaParaArquivo]);
  registry.registrar(...(processCommands as unknown as never[]));
  // The commands that extend one of the engine wrap the original, which keeps what it already does.
  const kill = registry.obter("kill") as EngineCommand | undefined;
  if (kill) registry.registrar(makeKill(kill) as unknown as never);
  const { listarProcessos } = await import("@legacy-engine/shell/comandos/Processos");
  setProcessLister(listarProcessos as unknown as (machine: unknown) => ProcessLine[]);
  const ps = registry.obter("ps") as EngineCommand | undefined;
  if (ps) registry.registrar(makePs(ps) as unknown as never);
}

/** Gives the machine a binary for each command of the process control, so the shell finds them in the PATH (the engine runs only what exists there). */
export function addProcessBinaries(machine: Parameters<typeof installBinaries>[0]): void {
  installBinaries(machine, processCommands.map((command) => command.nome));
}
