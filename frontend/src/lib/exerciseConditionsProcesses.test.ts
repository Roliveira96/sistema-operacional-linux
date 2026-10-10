import { describe, expect, it } from "vitest";
import { checkConditions, deriveConditions, describeCondition, holds, programOf, type ExerciseCondition } from "./exerciseConditions";
import { parseCondition } from "./exercises";
import type { TreeNode } from "./machineDiff";

const dir = (nome: string, filhos: TreeNode[] = []): TreeNode => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos });
const machine = (home: TreeNode[] = []) => ({
  raiz: dir("", [dir("home", [dir("ricardo", home)])]),
  contas: {
    usuarios: [{ nome: "root", uid: 0, gid: 0 }, { nome: "ricardo", uid: 1000, gid: 1000 }],
    grupos: [{ nome: "root", gid: 0, membros: [] }, { nome: "ricardo", gid: 1000, membros: [] }],
  },
});
const proc = (pid: number, comando: string, estado = "S", nice = 0) => ({ pid, uid: 1000, comando, estado, nice });
const withProcesses = (m: ReturnType<typeof machine>, processos: ReturnType<typeof proc>[], encerrados: { pid: number; comando: string; sinal: number }[] = []) => ({ ...m, processos, encerrados });
const kinds = (list: ExerciseCondition[]) => list.map((c) => [c.kind, c.path ?? c.name ?? c.user].join(" "));

// SPEC-029: the processes of the machine in the conditions of finalization.

// Covers CA-09: how a process ended up is worked out from what the teacher did, by the name of the program.
describe("deriveConditions, the processes", () => {
  it("says nothing when the processes did not change", () => {
    const a = withProcesses(machine(), [proc(2451, "sleep 300")]);
    expect(deriveConditions(a, withProcesses(machine(), [proc(2451, "sleep 300")]))).toEqual([]);
  });

  it("turns a program that is running now, and a stopped one, into conditions about the program, not the PID", () => {
    const after = withProcesses(machine(), [proc(2451, "sleep 300"), proc(2460, "/usr/bin/ping -c 100 localhost", "T"), proc(2470, "-bash")]);
    expect(deriveConditions(machine(), after)).toEqual([
      { kind: "PROCESS_RUNNING", name: "sleep" },
      { kind: "PROCESS_STOPPED", name: "ping" },
      { kind: "PROCESS_RUNNING", name: "bash" },
    ]);
  });

  it("says a program is gone when it was there and is not, and by which signal when a signal ended it (CA-10)", () => {
    const before = withProcesses(machine(), [proc(2451, "sleep 300")]);
    const after = withProcesses(machine(), [], [{ pid: 2451, comando: "sleep 300", sinal: 15 }]);
    expect(deriveConditions(before, after)).toEqual([
      { kind: "PROCESS_ABSENT", name: "sleep" },
      { kind: "PROCESS_ENDED_BY", name: "sleep", signal: 15 },
    ]);
    // Started and ended while recording: it was never in the list before, and it is gone all the same.
    expect(deriveConditions(machine(), after)).toEqual([
      { kind: "PROCESS_ABSENT", name: "sleep" },
      { kind: "PROCESS_ENDED_BY", name: "sleep", signal: 15 },
    ]);
    // What ended before the recording is not part of it, and neither is a program that is still running under another PID.
    const old = withProcesses(machine(), [], [{ pid: 2300, comando: "yes", sinal: 9 }]);
    expect(deriveConditions(old, withProcesses(machine(), [], [{ pid: 2300, comando: "yes", sinal: 9 }]))).toEqual([]);
    const again = withProcesses(machine(), [proc(2500, "sleep 300")]);
    expect(deriveConditions(before, again)).toEqual([]);
  });

  it("notices a stop, a resume and a changed priority", () => {
    const running = withProcesses(machine(), [proc(2451, "sleep 300")]);
    const stopped = withProcesses(machine(), [proc(2451, "sleep 300", "T")]);
    expect(deriveConditions(running, stopped)).toEqual([{ kind: "PROCESS_STOPPED", name: "sleep" }]);
    expect(deriveConditions(stopped, running)).toEqual([{ kind: "PROCESS_RUNNING", name: "sleep" }]);
    const reniced = withProcesses(machine(), [proc(2451, "sleep 300", "S", 15)]);
    expect(deriveConditions(running, reniced)).toEqual([{ kind: "PROCESS_NICE", name: "sleep", nice: 15 }]);
    // Started with nice: it is running, and has its priority.
    expect(deriveConditions(machine(), withProcesses(machine(), [proc(2460, "sleep 60", "S", 10)]))).toEqual([
      { kind: "PROCESS_RUNNING", name: "sleep" },
      { kind: "PROCESS_NICE", name: "sleep", nice: 10 },
    ]);
  });

  it("works with a machine that has no processes at all, and keeps the conditions of the files first", () => {
    expect(deriveConditions(machine(), machine())).toEqual([]);
    const after = withProcesses(machine([dir("lab")]), [proc(1, "sleep 5")]);
    expect(kinds(deriveConditions(machine(), after))).toEqual(["DIR_EXISTS /home/ricardo/lab", "PROCESS_RUNNING sleep"]);
  });

  it("does not repeat a condition for two processes of the same program", () => {
    const after = withProcesses(machine(), [proc(1, "sleep 1"), proc(2, "sleep 2")]);
    expect(deriveConditions(machine(), after)).toEqual([{ kind: "PROCESS_RUNNING", name: "sleep" }]);
  });
});

describe("checkConditions, the processes of the machine of the student", () => {
  const m = withProcesses(machine(), [proc(2451, "sleep 300", "T"), proc(2460, "/usr/bin/ping localhost", "S", 10)], [{ pid: 2440, comando: "yes sim", sinal: 15 }]);
  const holdsOn = (condition: ExerciseCondition) => holds(condition, m as never);

  it("holds for each kind, by the name of the program", () => {
    expect(holdsOn({ kind: "PROCESS_RUNNING", name: "ping" })).toBe(true);
    expect(holdsOn({ kind: "PROCESS_RUNNING", name: "sleep" })).toBe(false); // stopped is not running
    expect(holdsOn({ kind: "PROCESS_STOPPED", name: "sleep" })).toBe(true);
    expect(holdsOn({ kind: "PROCESS_STOPPED", name: "ping" })).toBe(false);
    expect(holdsOn({ kind: "PROCESS_ABSENT", name: "top" })).toBe(true);
    expect(holdsOn({ kind: "PROCESS_ABSENT", name: "ping" })).toBe(false);
    expect(holdsOn({ kind: "PROCESS_ENDED_BY", name: "yes", signal: 15 })).toBe(true);
    expect(holdsOn({ kind: "PROCESS_ENDED_BY", name: "yes", signal: 9 })).toBe(false);
    expect(holdsOn({ kind: "PROCESS_ENDED_BY", name: "yes" })).toBe(true);
    expect(holdsOn({ kind: "PROCESS_ENDED_BY", name: "ping" })).toBe(false);
    expect(holdsOn({ kind: "PROCESS_NICE", name: "ping", nice: 10 })).toBe(true);
    expect(holdsOn({ kind: "PROCESS_NICE", name: "ping", nice: 0 })).toBe(false);
  });

  it("a machine with no processes (one that was saved) has none running: everything is absent and nothing runs", () => {
    const saved = machine();
    expect(holds({ kind: "PROCESS_ABSENT", name: "sleep" }, saved as never)).toBe(true);
    expect(holds({ kind: "PROCESS_RUNNING", name: "sleep" }, saved as never)).toBe(false);
    expect(holds({ kind: "PROCESS_ENDED_BY", name: "sleep" }, saved as never)).toBe(false);
  });

  it("is done when the files and the processes both ended as the exercise asks, and says which is missing", () => {
    const conditions: ExerciseCondition[] = [{ kind: "DIR_EXISTS", path: "/home/ricardo" }, { kind: "PROCESS_ABSENT", name: "sleep" }, { kind: "PROCESS_ENDED_BY", name: "yes", signal: 15 }];
    const result = checkConditions(conditions, m);
    expect(result.done).toBe(false);
    expect(result.missing.map((c) => c.kind)).toEqual(["PROCESS_ABSENT"]);
    const done = withProcesses(machine(), [], [{ pid: 1, comando: "yes", sinal: 15 }]);
    expect(checkConditions(conditions, done).done).toBe(true);
  });

  it("describes each kind in words", () => {
    expect(describeCondition({ kind: "PROCESS_RUNNING", name: "ping" })).toBe("O programa ping está rodando");
    expect(describeCondition({ kind: "PROCESS_ABSENT", name: "sleep" })).toBe("O programa sleep não está mais rodando");
    expect(describeCondition({ kind: "PROCESS_STOPPED", name: "sleep" })).toBe("O programa sleep está parado");
    expect(describeCondition({ kind: "PROCESS_ENDED_BY", name: "yes", signal: 9 })).toBe("O programa yes foi encerrado pelo sinal 9");
    expect(describeCondition({ kind: "PROCESS_ENDED_BY", name: "yes" })).toBe("O programa yes foi encerrado por um sinal");
    expect(describeCondition({ kind: "PROCESS_NICE", name: "ping", nice: 10 })).toBe("O programa ping tem a prioridade (nice) 10");
  });
});

describe("programOf and the stored form", () => {
  it("is the program of a command line, as ps shows it", () => {
    expect(["sleep 300", "/usr/bin/ping -c 3 host", "-bash", "  yes   sim", ""].map(programOf)).toEqual(["sleep", "ping", "bash", "yes", ""]);
  });

  it("reads the signal and the nice that come with a condition from the server, and drops what is not a number", () => {
    expect(parseCondition({ kind: "PROCESS_ENDED_BY", name: "yes", signal: 15 })).toEqual({ kind: "PROCESS_ENDED_BY", name: "yes", signal: 15 });
    expect(parseCondition({ kind: "PROCESS_NICE", name: "ping", nice: -5 })).toEqual({ kind: "PROCESS_NICE", name: "ping", nice: -5 });
    expect(parseCondition({ kind: "PROCESS_ENDED_BY", name: "yes", signal: "15" })).toEqual({ kind: "PROCESS_ENDED_BY", name: "yes" });
    expect(parseCondition({ kind: "PROCESS_NICE", name: "ping", nice: Number.NaN })).toEqual({ kind: "PROCESS_NICE", name: "ping" });
  });
});
