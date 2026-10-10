import { afterEach, describe, expect, it, vi } from "vitest";
import { checkConditions, deriveConditions, type ExerciseCondition } from "@/lib/exerciseConditions";
import type { MachineTree } from "@/lib/machineDiff";
import { mountTerminalWindow, type TerminalWindow } from "../terminalWindow";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 180_000 });

const wins: TerminalWindow[] = [];
afterEach(() => {
  for (const w of wins.splice(0)) w.destroy();
  document.body.innerHTML = "";
});

async function terminal() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const t = await mountTerminalWindow(host, null, { onCommand: () => {} });
  t.setSpeed(100);
  wins.push(t);
  return t;
}
const run = async (t: TerminalWindow, command: string, terminalNumber = 1) => {
  const r = await t.execute({ command, terminal: terminalNumber, ...(terminalNumber > 1 ? { login: { user: "ricardo", password: "123" } } : {}) });
  return { status: r.status, output: r.output };
};
const pidOf = (output: string) => Number(/\[1\]\s+(\d+)/.exec(output)?.[1]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snapshot = MachineTree & { processos?: unknown[]; encerrados?: unknown[] };

/** What the teacher does: starts a program in one terminal and ends it from another. Returns the conditions worked out from it. */
async function teacherKillsASleep(signal = ""): Promise<{ conditions: ExerciseCondition[]; before: Snapshot; after: Snapshot }> {
  const t = await terminal();
  const before = t.snapshot() as Snapshot;
  const started = await run(t, "sleep 300 &", 2);
  const pid = pidOf(started.output);
  expect(await run(t, `kill ${signal} ${pid}`.replace("  ", " "), 3)).toMatchObject({ status: 0 });
  // The engine drops the process a moment after the signal.
  for (let i = 0; i < 40 && ((t.snapshot() as Snapshot).encerrados ?? []).length === 0; i++) await wait(100);
  const after = t.snapshot() as Snapshot;
  return { conditions: deriveConditions(before as never, after as never), before, after };
}

// Covers SPEC-029 CA-09, CA-10, CA-11 on the real terminal: the snapshot carries the processes, and the exercise is derived and checked from them.
describe("the conditions of the processes, on the real terminal", () => {
  it("carries the commands running and the ones a signal ended in the snapshot of the machine, and a machine can be reset from it", async () => {
    const t = await terminal();
    const idle = t.snapshot() as Snapshot;
    expect(idle.processos).toEqual([]);
    expect(idle.encerrados).toEqual([]);
    const started = await run(t, "nice -n 7 sleep 200 &", 2);
    const running = (t.snapshot() as Snapshot).processos as { comando: string; estado: string; nice: number }[];
    expect(running.map((p) => [p.comando, p.estado, p.nice])).toEqual([["sleep 200", "S", 7]]);
    await run(t, `kill -STOP ${pidOf(started.output)}`, 3);
    expect(((t.snapshot() as Snapshot).processos as { estado: string }[])[0]!.estado).toBe("T");
    // The snapshot, with the processes, loads back as a machine: the engine ignores what it does not keep.
    expect(() => t.reset(t.snapshot())).not.toThrow();
    expect((t.snapshot() as Snapshot).processos).toEqual([]);
  });

  it("works out that the program was ended by the signal that ended it, and that it is gone", async () => {
    const { conditions } = await teacherKillsASleep();
    expect(conditions).toEqual([
      { kind: "PROCESS_ABSENT", name: "sleep" },
      { kind: "PROCESS_ENDED_BY", name: "sleep", signal: 15 },
    ]);
  });

  it("accepts the student who does it again, in other terminals and with another PID, and says what is missing from one who does not", async () => {
    const { conditions } = await teacherKillsASleep();

    // Another machine, another PID: the same steps end the same way.
    const student = await terminal();
    expect(checkConditions(conditions, student.snapshot()).done).toBe(false);
    const started = await run(student, "sleep 300 &", 2);
    // Started and not yet ended: the program is there, so it is not done, and what is missing is it being gone and ended.
    const early = checkConditions(conditions, student.snapshot());
    expect(early.done).toBe(false);
    await run(student, `kill ${pidOf(started.output)}`, 3);
    for (let i = 0; i < 40 && !checkConditions(conditions, student.snapshot()).done; i++) await wait(100);
    expect(checkConditions(conditions, student.snapshot()).done).toBe(true);

    // Another way to end it with another signal: it is gone, but the signal is not the one asked (the teacher may take that condition out).
    const other = await terminal();
    const second = await run(other, "sleep 300 &", 2);
    await run(other, `kill -9 ${pidOf(second.output)}`, 3);
    for (let i = 0; i < 40 && ((other.snapshot() as Snapshot).encerrados ?? []).length === 0; i++) await wait(100);
    const result = checkConditions(conditions, other.snapshot());
    expect(result.done).toBe(false);
    expect(result.missing.map((c) => c.kind)).toEqual(["PROCESS_ENDED_BY"]);
    expect(checkConditions(conditions.filter((c) => c.kind === "PROCESS_ABSENT"), other.snapshot()).done).toBe(true);
  });

  it("works out that a program is left running and stopped, and checks it", async () => {
    const t = await terminal();
    const before = t.snapshot();
    const started = await run(t, "nice -n 5 sleep 400 &", 2);
    const pid = pidOf(started.output);
    await run(t, `kill -STOP ${pid}`, 3);
    const conditions = deriveConditions(before as never, t.snapshot() as never);
    expect(conditions).toEqual([
      { kind: "PROCESS_STOPPED", name: "sleep" },
      { kind: "PROCESS_NICE", name: "sleep", nice: 5 },
    ]);
    expect(checkConditions(conditions, t.snapshot()).done).toBe(true);
    // Continued, it is not stopped any more.
    await run(t, `kill -CONT ${pid}`, 3);
    expect(checkConditions(conditions, t.snapshot()).missing.map((c) => c.kind)).toEqual(["PROCESS_STOPPED"]);
    await run(t, `kill ${pid}`, 3);
  });
});
