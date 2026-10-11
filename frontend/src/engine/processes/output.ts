import type { EngineContext } from "./types";

// A command that never ends (yes, watch) must know where it prints: on the terminal it runs until Ctrl+C, but in a pipe or into a file
// the engine collects everything before the next command starts, so it would never end.

type Kind = abstract new (...args: never[]) => object;
let notTerminal: Kind[] = [];

/** Told once, at registration, which classes of the engine stand for a pipe and a redirection. */
export function setNotTerminalOutputs(kinds: Kind[]): void {
  notTerminal = kinds;
}

export function printsOnTerminal(context: EngineContext): boolean {
  return !notTerminal.some((kind) => context.saida instanceof kind);
}

/**
 * Is the output the redirection to /dev/null? Nothing is kept there, so a command that never ends may keep running, as on Linux
 * (`yes > /dev/null &` is the classic way to leave a process alive to kill from another terminal).
 */
export function printsToNothing(context: EngineContext): boolean {
  // The redirection keeps the file it opened; the engine marks the field private, but it is there at run time.
  const file = (context.saida as { arquivo?: { nome?: string } }).arquivo;
  return file?.nome === "null";
}
