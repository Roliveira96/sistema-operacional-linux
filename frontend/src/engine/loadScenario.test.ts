import { afterEach, describe, expect, it, vi } from "vitest";
import { runLayers } from "@/lib/setupRunner";
import { mountTerminalWindow, type TerminalWindow } from "./terminalWindow";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 120_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

// The files of a snapshot go in by loading the machine again; the terminal must stay where the commands left it.
describe("loadScenario keeps the terminal where it was", () => {
  it("keeps the folder, the variables and the history after the files of a snapshot go in", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    win = await mountTerminalWindow(host, null, { onCommand: () => {} });
    win.setSpeed(100);
    const results = await runLayers(win, [
      {
        id: "own",
        kind: "module",
        label: "Módulo",
        setup: { summary: "", steps: [{ command: "mkdir -p /home/ricardo/financeiro" }, { command: "cd /home/ricardo/financeiro" }, { command: "export TURMA=sistemas" }], files: [{ path: "/home/ricardo/financeiro/teste.sh", content: "echo oi" + String.fromCharCode(10), mode: "755" }] },
      },
    ]);
    expect(results.every((r) => r.status === 0)).toBe(true);

    expect((await win.execute({ command: "pwd" })).output).toBe("/home/ricardo/financeiro");
    expect((await win.execute({ command: "ls" })).output).toBe("teste.sh");
    expect((await win.execute({ command: "echo $TURMA" })).output).toBe("sistemas");
    expect((await win.execute({ command: "./teste.sh" })).output).toContain("oi");
    expect(win.history()).toEqual(expect.arrayContaining(["mkdir -p /home/ricardo/financeiro", "cd /home/ricardo/financeiro"]));
  });

  it("goes to the home folder when the folder it was in does not exist on the new machine", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    win = await mountTerminalWindow(host, null, { onCommand: () => {} });
    win.setSpeed(100);
    await win.execute({ command: "mkdir /tmp/some" });
    await win.execute({ command: "cd /tmp/some" });
    // A machine without that folder.
    await mountTerminalWindow(document.createElement("div"), null, { onCommand: () => {} }).then((other) => {
      const fresh = other.snapshot();
      other.destroy();
      return win!.loadScenario(fresh);
    });
    expect((await win.execute({ command: "pwd" })).output).toBe("/root");
  });
});
