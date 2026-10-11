import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "./testkit";
import type { TerminalWindow } from "./terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
});
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

// Covers SPEC-030 CA-23, RN-16: swapping the machine keeps what is on the screen, and the new machine starts clean.
describe("swapMachine on the real engine", () => {
  it("keeps the screen with every command and its output, marks the swap, and gives the terminal a clean session on the fresh machine", async () => {
    const snapshot = win.snapshot();
    await win.execute({ command: "echo primeiro-comando > marca.txt" });
    await win.execute({ command: "export VARIAVEL=1" });
    await win.execute({ command: "alias meualias='ls -l'" });
    await win.execute({ command: "echo escrito-na-tela" });

    await win.swapMachine(snapshot, "# comando teste");

    const screen = document.body.textContent ?? "";
    expect(screen).toContain("echo escrito-na-tela");
    expect(screen).toContain("escrito-na-tela");
    expect(screen).toContain("# comando teste");

    // The machine is the one of the snapshot (the file is gone), and the session has no variables, aliases or history of the other.
    expect((await win.execute({ command: "cat marca.txt" })).status).not.toBe(0);
    expect((await win.execute({ command: "echo [$VARIAVEL]" })).output).toContain("[]");
    expect((await win.execute({ command: "meualias" })).status).toBe(127);
    expect((await win.execute({ command: "history" })).output).not.toContain("escrito-na-tela");
    // And the commands typed after still go to the same screen.
    expect(document.body.textContent).toContain("echo [$VARIAVEL]");
  });

  it("rebuilds the window when the terminal was closed by exit, so the next commands still run", async () => {
    const snapshot = win.snapshot();
    const closed = await win.execute({ command: "exit" });
    expect(closed.status).toBeNull();
    await win.swapMachine(snapshot);
    expect((await win.execute({ command: "echo volta" })).output).toContain("volta");
  });
});
