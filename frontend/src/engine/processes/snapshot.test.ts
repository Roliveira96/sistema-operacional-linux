import { describe, expect, it } from "vitest";
import { makeProcess } from "./fakes";
import { setNice } from "./priority";
import { MAX_ENTRIES, processSnapshot, watchEnded } from "./snapshot";
import type { EngineProcess } from "./types";

/** A table of processes like the one of the engine: the list, and the removal that the engine calls when a command ends. */
function table(initial: EngineProcess[] = []) {
  const list = [...initial];
  return {
    listar: () => list.slice(),
    remover(process: EngineProcess) {
      const i = list.indexOf(process);
      if (i >= 0) list.splice(i, 1);
    },
  };
}
const machineOf = (t: ReturnType<typeof table>) => ({ processos: t, contas: { nomeDoUsuario: (uid: number) => (uid === 0 ? "root" : "ana") } });

// Covers SPEC-029 CA-09, CA-11: the processes that go along in the snapshot of the machine, only to be checked.
describe("process snapshot", () => {
  it("lists the commands running, with the priority and whether they are stopped, and leaves out the ones a signal already ended", () => {
    const sleeper = makeProcess(2451, 1000);
    sleeper.comando = "sleep 300";
    setNice(sleeper, 10);
    const stopped = makeProcess(2460, 1000);
    stopped.comando = "ping localhost";
    stopped.receber(19);
    const dead = makeProcess(2470, 0);
    dead.receber(9);
    expect(processSnapshot(machineOf(table([sleeper, stopped, dead])))).toEqual({
      processos: [
        { pid: 2451, ppid: 1, uid: 1000, usuario: "ana", tty: "pts/0", comando: "sleep 300", estado: "S", nice: 10 },
        { pid: 2460, ppid: 1, uid: 1000, usuario: "ana", tty: "pts/0", comando: "ping localhost", estado: "T", nice: 0 },
      ],
      encerrados: [],
    });
  });

  it("remembers the commands a signal ends, and not the ones that end by themselves", () => {
    const t = table();
    const machine = machineOf(t);
    watchEnded(machine);
    const killed = makeProcess(2451, 1000);
    killed.comando = "sleep 300";
    const finished = makeProcess(2452, 1000);
    t.listar();
    killed.receber(15);
    t.remover(killed);
    t.remover(finished);
    expect(processSnapshot(machine).encerrados).toEqual([{ pid: 2451, comando: "sleep 300", sinal: 15 }]);
    // Asking again gives the same list, and a copy: changing it does not change what the machine remembers.
    const first = processSnapshot(machine);
    first.encerrados.pop();
    expect(processSnapshot(machine).encerrados).toHaveLength(1);
  });

  it("watches a machine once, so the list does not double when it is asked twice", () => {
    const t = table();
    const machine = machineOf(t);
    watchEnded(machine);
    watchEnded(machine);
    const p = makeProcess(1, 0);
    p.receber(9);
    t.remover(p);
    expect(processSnapshot(machine).encerrados).toHaveLength(1);
  });

  it("keeps the most recent ones when more than the limit have ended", () => {
    const t = table();
    const machine = machineOf(t);
    watchEnded(machine);
    for (let pid = 1; pid <= MAX_ENTRIES + 3; pid++) {
      const p = makeProcess(pid, 0);
      p.receber(15);
      t.remover(p);
    }
    const ended = processSnapshot(machine).encerrados;
    expect(ended).toHaveLength(MAX_ENTRIES);
    expect(ended[0]!.pid).toBe(4);
    expect(ended.at(-1)!.pid).toBe(MAX_ENTRIES + 3);
  });

  it("has nothing for a machine that is not one of the engine", () => {
    expect(processSnapshot({})).toEqual({ processos: [], encerrados: [] });
    expect(() => watchEnded({})).not.toThrow();
    expect(() => watchEnded(null as never)).toThrow();
  });
});
