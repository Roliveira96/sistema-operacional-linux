import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import { printfSteps } from "./setupContent";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 60_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

// Covers the files with content of a snapshot: what the printf steps write is what the author typed.
describe("printfSteps in the terminal of the application", () => {
  it("recreates the text of a file, in the folders the author made, in as many lines as it has", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    win = await mountTerminalWindow(host, null, { onCommand: () => {} });
    win.setSpeed(100);
    const run = async (command: string) => win!.execute({ command });

    expect((await run("mkdir -p /home/ricardo/utfpr/teste/{docs,src}")).status).toBe(0);
    const text = ["linha 1", "", "com 'aspas' e $HOME", "ultima"].join("\n");
    for (const step of printfSteps("/home/ricardo/utfpr/teste/docs/ricardo.txt", text)) expect((await run(step.command)).status).toBe(0);
    const read = await run("cat /home/ricardo/utfpr/teste/docs/ricardo.txt");
    expect(read.status).toBe(0);
    expect(read.output).toBe(text);

    // A long text goes in more than one step and still comes back whole.
    const long = Array.from({ length: 60 }, (_, i) => `linha numero ${i} com algum texto`).join("\n");
    for (const step of printfSteps("/home/ricardo/utfpr/teste/src/long.txt", long)) expect((await run(step.command)).status).toBe(0);
    expect((await run("cat /home/ricardo/utfpr/teste/src/long.txt")).output).toBe(long);
    expect((await run("ls /home/ricardo/utfpr/teste")).output).toBe("docs  src");
  });
});
