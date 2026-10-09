import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import { reconcile, type MachineTree } from "./machineDiff";
import { replayMachine } from "./machineReplay";
import type { Setup, SetupLayer, SetupStep } from "./setup";
import { runLayers } from "./setupRunner";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 120_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

const layer = (setup: Partial<Setup>): SetupLayer[] => [{ id: "own", kind: "card", label: "Ambiente", setup: { summary: "", steps: [], ...setup } }];

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  win = await mountTerminalWindow(host, null, { onCommand: () => {} });
  win.setSpeed(100);
  return win;
}

// The module snapshot must be exact: the student gets the machine the teacher left, files with their text included.
describe("reconcile against the real terminal", () => {
  it("makes the replay of the typed commands equal to the machine the teacher built, with the text typed in the editor", async () => {
    const teacher = await mount();
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
      expect((await teacher.execute({ ...step, answers: step.command === "vim teste.txt" ? ["1. Cluster UTFPR com IA"] : undefined })).status).toBe(0);
    }
    const recorded = teacher.snapshot() as MachineTree;
    teacher.destroy();
    win = null;

    // The student's machine from the typed commands alone: the file is there but empty.
    const replayed = (await replayMachine(null, layer({ steps: typed }))) as MachineTree;
    const diff = reconcile(recorded, replayed);
    expect(diff.inexact).toEqual([]);
    expect(diff.steps).toEqual([]);
    expect(diff.files).toEqual([{ path: "/home/ricardo/financeiro/teste.txt", content: "1. Cluster UTFPR com IA" + String.fromCharCode(10), mode: "640", owner: "ana", group: "root" }]);

    // With that file added, the machine is the same as the teacher's: nothing left to fix.
    const exact = (await replayMachine(null, layer({ steps: typed, files: diff.files }))) as MachineTree;
    expect(reconcile(recorded, exact)).toEqual({ steps: [], files: [], inexact: [] });
  });

  it("brings back a file and the folders around it, with owner and permissions, when the list has no command for them", async () => {
    const teacher = await mount();
    for (const command of ["mkdir -p /srv/app/conf", "useradd bruno", "printf '%s\\n' 'porta=8080' 'modo=prod' > /srv/app/conf/app.ini", "chown bruno /srv/app/conf/app.ini", "chmod 600 /srv/app/conf/app.ini"]) {
      expect((await teacher.execute({ command })).status).toBe(0);
    }
    const recorded = teacher.snapshot() as MachineTree;
    teacher.destroy();
    win = null;

    const replayed = (await replayMachine(null, layer({ steps: [{ command: "useradd bruno" }] }))) as MachineTree;
    const diff = reconcile(recorded, replayed);
    expect(diff.inexact).toEqual([]);
    expect(diff.steps.map((s) => s.command)).toEqual(["mkdir -p '/srv/app'", "mkdir -p '/srv/app/conf'"]);
    const exact = (await replayMachine(null, layer({ steps: [{ command: "useradd bruno" }, ...diff.steps], files: diff.files }))) as MachineTree;
    expect(reconcile(recorded, exact)).toEqual({ steps: [], files: [], inexact: [] });
  });

  it("gives the student a large log and a page, as the teacher had them, readable with the usual commands (RN-12)", async () => {
    const line = "192.168.0.10 - - [09/Oct/2026:12:00:00 -0300] \"GET /index.html HTTP/1.1\" 200 512" + String.fromCharCode(10);
    const log = line.repeat(Math.floor((900 * 1024) / line.length));
    const page = "<!doctype html>" + String.fromCharCode(10) + "<h1>Olá, \"mundo\" & cia</h1>" + String.fromCharCode(10);
    const student = await mount();
    const results = await runLayers(student, layer({ steps: [{ command: "mkdir -p /var/www/html" }], files: [{ path: "/var/log/app/access.log", content: log, mode: "640" }, { path: "/var/www/html/index.html", content: page }] }));
    expect(results.every((r) => r.status === 0)).toBe(true);

    const count = await student.execute({ command: "wc -l /var/log/app/access.log" });
    expect(count.status).toBe(0);
    expect(count.output).toContain(`${log.split(String.fromCharCode(10)).length - 1} /var/log/app/access.log`);
    expect((await student.execute({ command: "head -n 1 /var/log/app/access.log" })).output).toBe(line.trimEnd());
    expect((await student.execute({ command: "cat /var/www/html/index.html" })).output).toBe(page.trimEnd());
    expect((await student.execute({ command: "ls -l /var/log/app/access.log" })).output).toContain("-rw-r-----");
    expect((await student.execute({ command: "grep -c 200 /var/log/app/access.log" })).status).toBe(0);
  });
});
