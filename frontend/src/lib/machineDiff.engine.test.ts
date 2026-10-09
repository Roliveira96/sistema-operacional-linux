import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import { reconcile, type MachineTree } from "./machineDiff";
import { replayMachine } from "./machineReplay";
import type { SetupLayer, SetupStep } from "./setup";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 120_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

const layer = (steps: SetupStep[]): SetupLayer[] => [{ id: "own", kind: "card", label: "Ambiente", setup: { summary: "", steps } }];

// The module snapshot must be exact: the student gets the machine the teacher left, files with their text included.
describe("reconcile against the real terminal", () => {
  it("makes the replay of the typed commands equal to the machine the teacher built, with the text typed in the editor", async () => {
    // The teacher's machine: what was typed, and what was written inside the editor and around it.
    const host = document.createElement("div");
    document.body.appendChild(host);
    win = await mountTerminalWindow(host, null, { onCommand: () => {} });
    win.setSpeed(100);
    const typed: SetupStep[] = [
      { command: "mkdir /home/ricardo/financeiro" },
      { command: "cd /home/ricardo/financeiro/" },
      { command: "vim teste.txt" },
      { command: "chmod 640 teste.txt" },
      { command: "mkdir -p docs/2026" },
      { command: "touch docs/2026/vazio.txt" },
      { command: "useradd ana" },
      { command: "chown ana teste.txt" },
    ];
    for (const step of typed) {
      // The editor gets the text the teacher typed in it; the list only has "vim teste.txt".
      expect((await win.execute({ ...step, answers: step.command === "vim teste.txt" ? ["1. Cluster UTFPR com IA"] : undefined })).status).toBe(0);
    }
    const recorded = win.snapshot() as MachineTree;
    win.destroy();
    win = null;

    // The student's machine from the typed commands alone: the file is there but empty.
    const replayed = (await replayMachine(null, layer(typed))) as MachineTree;
    const diff = reconcile(recorded, replayed);
    expect(diff.inexact).toEqual([]);
    expect(diff.steps.map((s) => s.command)).toEqual([String.raw`printf '%s\n' '1. Cluster UTFPR com IA' > '/home/ricardo/financeiro/teste.txt'`]);

    // With those commands added, the machine is the same as the teacher's: nothing left to fix.
    const exact = (await replayMachine(null, layer([...typed, ...diff.steps]))) as MachineTree;
    expect(reconcile(recorded, exact)).toEqual({ steps: [], inexact: [] });
  });

  it("brings back a file the commands cannot rebuild, with its owner and permissions", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    win = await mountTerminalWindow(host, null, { onCommand: () => {} });
    win.setSpeed(100);
    // Something typed in another terminal, or in a way the list does not hold: only the machine knows it.
    for (const command of ["mkdir -p /srv/app/conf", "useradd bruno", "printf '%s\\n' 'porta=8080' 'modo=prod' > /srv/app/conf/app.ini", "chown bruno /srv/app/conf/app.ini", "chmod 600 /srv/app/conf/app.ini"]) {
      expect((await win.execute({ command })).status).toBe(0);
    }
    const recorded = win.snapshot() as MachineTree;
    win.destroy();
    win = null;

    const replayed = (await replayMachine(null, layer([{ command: "useradd bruno" }]))) as MachineTree;
    const diff = reconcile(recorded, replayed);
    expect(diff.inexact).toEqual([]);
    const exact = (await replayMachine(null, layer([{ command: "useradd bruno" }, ...diff.steps]))) as MachineTree;
    expect(reconcile(recorded, exact)).toEqual({ steps: [], inexact: [] });
  });
});
