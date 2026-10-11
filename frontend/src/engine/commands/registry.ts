import type { CommandRegistry } from "./types";

// The catalog of the engine, kept so commands such as whatis can read the summary of the others.
let current: CommandRegistry | null = null;

export function setRegistry(registry: CommandRegistry): void {
  current = registry;
}

export function getRegistry(): CommandRegistry | null {
  return current;
}
