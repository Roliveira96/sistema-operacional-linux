import { niceOf } from "./priority";
import type { EngineProcess } from "./types";

// The processes in the snapshot of the machine (SPEC-029 entrega C). The engine does not save them: they only go along when the machine is
// handed over to be checked (the teacher's derivation of how an exercise ends, the check on the screen, the one of the server).

/** A command of the user running on the machine. */
export interface ProcessEntry {
  pid: number;
  uid: number;
  comando: string;
  /** The letter of ps: S sleeping or T stopped (the engine has no other). */
  estado: string;
  nice: number;
}

/** A command a signal ended. */
export interface EndedEntry {
  pid: number;
  comando: string;
  sinal: number;
}

export interface ProcessSnapshot {
  processos: ProcessEntry[];
  encerrados: EndedEntry[];
}

/** The most entries a snapshot carries (the limit of the server): the oldest ended ones fall off. */
export const MAX_ENTRIES = 500;

interface Table {
  listar(): EngineProcess[];
  remover(process: EngineProcess): void;
}

const ended = new WeakMap<object, EndedEntry[]>();

/**
 * Makes the machine remember the commands a signal ends: the engine drops a process from its table when it ends and keeps nothing of how.
 * The table is wrapped on the instance (the legacy code is not changed); once per machine.
 */
export function watchEnded(machine: unknown): void {
  const table = (machine as { processos?: Table }).processos;
  if (!table || ended.has(table)) return;
  const list: EndedEntry[] = [];
  ended.set(table, list);
  const remove = table.remover;
  table.remover = function (this: Table, process: EngineProcess) {
    // A process that ended by itself has no signal; only the ones a signal ended count.
    if (process.sinal !== null && process.sinal !== undefined) {
      list.push({ pid: process.pid, comando: process.comando, sinal: process.sinal });
      if (list.length > MAX_ENTRIES) list.shift();
    }
    return remove.call(this, process);
  };
}

/** The commands running and the ones a signal ended, as the check reads them. A machine that is not one of the engine has none. */
export function processSnapshot(machine: unknown): ProcessSnapshot {
  const table = (machine as { processos?: Table }).processos;
  if (!table) return { processos: [], encerrados: [] };
  return {
    processos: table
      .listar()
      .filter((process) => !process.encerrado)
      .slice(0, MAX_ENTRIES)
      .map((process) => ({ pid: process.pid, uid: process.uid, comando: process.comando, estado: process.estaPausado() ? "T" : "S", nice: niceOf(process) })),
    encerrados: [...(ended.get(table) ?? [])],
  };
}
