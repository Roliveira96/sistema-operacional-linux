import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "../terminalWindow";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 120_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

async function terminal() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  win = await mountTerminalWindow(host, null, { onCommand: () => {} });
  win.setSpeed(100);
  return win;
}
const run = async (t: TerminalWindow, command: string, terminalNumber = 1) => {
  // The terminals 2 and 3 are logins: the tests enter as an ordinary user, like a student does.
  const r = await t.execute({ command, terminal: terminalNumber, ...(terminalNumber > 1 ? { login: { user: "ricardo", password: "123" } } : {}) });
  return { status: r.status, output: r.output };
};

// Covers SPEC-029 CA-01, CA-02, CA-04, CA-07 on the real terminal: the commands are found in the PATH and work between terminals.
describe("process control commands on the real terminal", () => {
  it("finds nice, renice, yes and watch in the PATH, and answers --help with the help of each (SPEC-027)", async () => {
    const t = await terminal();
    for (const name of ["nice", "renice", "yes", "watch"]) {
      expect((await run(t, `which ${name}`)).output.trim(), name).toMatch(new RegExp(`/${name}$`));
      const help = await run(t, `${name} --help`);
      expect(help.status, name).toBe(0);
      expect(help.output, name).toContain(`Uso: ${name}`);
    }
  });

  it("starts nice in the background in one terminal and renices it from another, within the rules of a user", async () => {
    const t = await terminal();
    const started = await run(t, "nice -n 10 sleep 60 &", 2);
    const pid = Number(/\[1\]\s+(\d+)/.exec(started.output)?.[1]);
    expect(pid).toBeGreaterThan(0);
    const renice = await run(t, `renice 15 -p ${pid}`, 3);
    expect(renice.status).toBe(0);
    expect(renice.output).toContain(`${pid} (ID do processo) prioridade antiga 10, nova prioridade 15`);
    // A user cannot lower the niceness of its own process, nor touch the system.
    expect((await run(t, `renice 5 -p ${pid}`, 3)).status).toBe(1);
    expect((await run(t, "renice 5 -p 1", 3)).status).toBe(1);
    expect((await run(t, `kill ${pid}`, 3)).status).toBe(0);
  });

  it("ends a foreground yes started in one terminal when another terminal kills it, and gives the prompt back", async () => {
    const t = await terminal();
    await run(t, "true", 3);
    const running = run(t, "yes sim > /dev/null", 2);
    // The login of the terminal takes a while: wait until the yes is there.
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await new Promise((r) => setTimeout(r, 150));
      found = (await run(t, "pgrep yes", 3)).status === 0;
    }
    expect(found).toBe(true);
    await run(t, "pkill yes", 3);
    const ended = await running;
    expect(ended.status).not.toBe(0);
    expect((await run(t, "pgrep yes", 3)).status).not.toBe(0);
  });

  it("prints yes in a pipe without hanging", async () => {
    const t = await terminal();
    const r = await run(t, "yes ola | head -n 3");
    expect(r.output.trim().split(String.fromCharCode(10))).toEqual(["ola", "ola", "ola"]);
  });

  it("repeats watch until another terminal kills it", async () => {
    const t = await terminal();
    await run(t, "true", 3);
    const running = run(t, "watch -n 0.2 echo ping", 2);
    await new Promise((r) => setTimeout(r, 800));
    await run(t, "pkill watch", 3);
    const ended = await running;
    expect(ended.output).toContain("A cada 0,2s: echo ping");
    expect(ended.output).toContain("ping");
  });
});

// Covers SPEC-029 CA-02, CA-06: the complete kill on the real terminal.
describe("kill with every signal on the real terminal", () => {
  it("lists the 64 signals and converts between number and name", async () => {
    const t = await terminal();
    const all = await run(t, "kill -l");
    expect(all.status).toBe(0);
    expect(all.output).toContain("SIGHUP");
    expect(all.output).toContain("SIGRTMAX");
    expect(all.output).toContain("SIGUSR1");
    expect((await run(t, "kill -l 9")).output.trim()).toBe("KILL");
    expect((await run(t, "kill -l SIGTERM")).output.trim()).toBe("15");
    expect((await run(t, "kill -l 137")).output.trim()).toBe("KILL");
    expect((await run(t, "kill -l 99")).status).toBe(1);
  });

  it("ends a process of another terminal with SIGUSR1, which the engine did not know, and refuses what is not the user's", async () => {
    const t = await terminal();
    const started = await run(t, "sleep 60 &", 2);
    const pid = Number(/\[1\]\s+(\d+)/.exec(started.output)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect((await run(t, `kill -USR1 ${pid}`, 3)).status).toBe(0);
    // The process is gone from the table.
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      await new Promise((r) => setTimeout(r, 150));
      gone = (await run(t, `ps -p ${pid}`, 3)).output.trim().split(String.fromCharCode(10)).length < 2;
    }
    expect(gone).toBe(true);
    // The processes of the system are not the user's.
    expect((await run(t, "kill -USR1 1", 3)).status).not.toBe(0);
    expect((await run(t, "kill -FOO 1", 3)).output).toContain("especificação de sinal inválida");
  });
});

// Covers SPEC-029 CA-04, CA-05: ps with the niceness and the tree, on the real terminal.
describe("ps on the real terminal", () => {
  it("shows the priority and the niceness of a process started with nice, and what renice changed", async () => {
    const t = await terminal();
    const started = await run(t, "nice -n 10 sleep 60 &", 2);
    const pid = Number(/\[1\]\s+(\d+)/.exec(started.output)?.[1]);
    const long = await run(t, "ps -l", 2);
    const row = long.output.split(String.fromCharCode(10)).find((r) => r.endsWith(" sleep"))!;
    expect(row).toMatch(/\s+90\s+10 -/);
    expect(long.output).toContain("PRI  NI");
    await run(t, `renice 15 -p ${pid}`, 3);
    const custom = await run(t, `ps -o pid,ppid,ni,stat,comm -p ${pid}`, 3);
    const rows = custom.output.split(String.fromCharCode(10)).filter(Boolean);
    expect(rows[0]).toContain("NI");
    const fields = rows[1]!.split(" ").filter(Boolean);
    expect([fields[0], fields[2], fields[4]]).toEqual([String(pid), "15", "sleep"]);
    await run(t, `kill ${pid}`, 3);
  });

  it("draws the tree of the processes with --forest, with the shell above the command it started", async () => {
    const t = await terminal();
    await run(t, "sleep 60 &", 2);
    const tree = await run(t, "ps --forest", 2);

    const rows = tree.output.split(String.fromCharCode(10)).filter(Boolean);
    const shell = rows.findIndex((r) => r.endsWith("bash"));
    const child = rows.findIndex((r) => r.includes("\_ sleep"));
    expect(shell).toBeGreaterThan(0);
    expect(child).toBeGreaterThan(shell);
    // The engine's own ps keeps working.
    expect((await run(t, "ps aux", 2)).output).toContain("USER");
    await run(t, "pkill sleep", 3);
  });
});
