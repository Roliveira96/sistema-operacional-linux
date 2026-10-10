import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import { checkConditions, deriveConditions, type ExerciseCondition } from "./exerciseConditions";
import type { MachineTree } from "./machineDiff";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 120_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

async function machineAfter(commands: { command: string; answers?: string[] }[]): Promise<{ before: MachineTree; after: MachineTree }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  win = await mountTerminalWindow(host, null, { onCommand: () => {} });
  win.setSpeed(100);
  const before = win.snapshot() as MachineTree;
  for (const step of commands) expect((await win.execute(step)).status).toBe(0);
  const after = win.snapshot() as MachineTree;
  win.destroy();
  win = null;
  return { before, after };
}

// An exercise can be done in many ways; what matters is how it ends (SPEC-022).
describe("conditions of finalization against the real terminal", () => {
  it("accepts the exercise done another way, and refuses one that ends differently", async () => {
    // The teacher: makes the folder, writes the file with the editor, restricts it and creates a user.
    const teacher = await machineAfter([
      { command: "mkdir -p /home/ricardo/financeiro" },
      { command: "vim /home/ricardo/financeiro/teste.txt", answers: ["1. Cluster UTFPR com IA"] },
      { command: "chmod 640 /home/ricardo/financeiro/teste.txt" },
      { command: "useradd ana" },
    ]);
    const conditions = deriveConditions(teacher.before, teacher.after);
    const kinds = conditions.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["DIR_EXISTS", "FILE_EXISTS", "FILE_CONTENT", "MODE", "USER_EXISTS"]));
    expect(conditions.find((c) => c.kind === "FILE_CONTENT")).toMatchObject({ content: "1. Cluster UTFPR com IA" + String.fromCharCode(10), match: "equals" });

    // Student A: a different way (echo and a redirect instead of an editor, the user first).
    const studentA = await machineAfter([
      { command: "useradd ana" },
      { command: "mkdir /home/ricardo/financeiro" },
      { command: "echo '1. Cluster UTFPR com IA' > /home/ricardo/financeiro/teste.txt" },
      { command: "chmod 640 /home/ricardo/financeiro/teste.txt" },
    ]);
    expect(checkConditions(conditions, studentA.after)).toEqual({ done: true, missing: [] });

    // Student B: forgot the permission and wrote another text.
    const studentB = await machineAfter([{ command: "useradd ana" }, { command: "mkdir -p /home/ricardo/financeiro" }, { command: "echo outro texto > /home/ricardo/financeiro/teste.txt" }]);
    const result = checkConditions(conditions, studentB.after);
    expect(result.done).toBe(false);
    const missing = result.missing as ExerciseCondition[];
    expect(missing.map((c) => c.kind).sort()).toEqual(["FILE_CONTENT", "MODE"]);
  });
});
