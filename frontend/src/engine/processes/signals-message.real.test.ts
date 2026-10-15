import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "../terminalWindow";

// The first mount loads the whole engine, which is slow when the machine is busy.
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
// The terminals 2 and 3 are logins: the tests enter as an ordinary user, like a student does.
const run = (t: TerminalWindow, command: string, terminalNumber = 1) =>
  t.execute({ command, terminal: terminalNumber, ...(terminalNumber > 1 ? { login: { user: "ricardo", password: "123" } } : {}) });

/** Starts `command` in the foreground of terminal 2, waits until it is running, runs `signal` from terminal 3, and gives what terminal 2 showed. */
async function endedBy(t: TerminalWindow, command: string, program: string, signal: string) {
  await run(t, "true", 3);
  const running = run(t, command, 2);
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await new Promise((r) => setTimeout(r, 150));
    found = (await run(t, `pgrep ${program}`, 3)).status === 0;
  }
  expect(found).toBe(true);
  expect((await run(t, signal, 3)).status).toBe(0);
  return running;
}

// Covers SPEC-029 CA-02 on the real terminal: a signal sent from another terminal ends the process, the terminal of the process says so with the
// message of the shell for that signal, and the prompt comes back. The shell only has the message for 15 and 9 (the limit of the engine, in the spec).
describe("the message of the shell when another terminal ends the process", () => {
  it("says Terminado for SIGTERM, from kill and from pkill", async () => {
    const t = await terminal();
    const byPkill = await endedBy(t, "sleep 300", "sleep", "pkill sleep");
    expect(byPkill.status).not.toBe(0);
    expect(byPkill.output).toContain("Terminado");
    const byKill = await endedBy(t, "sleep 301", "sleep", "kill $(pgrep sleep)");
    expect(byKill.output).toContain("Terminado");
  });

  it("says Morto for SIGKILL", async () => {
    const t = await terminal();
    const ended = await endedBy(t, "sleep 302", "sleep", "kill -9 $(pgrep sleep)");
    expect(ended.status).not.toBe(0);
    expect(ended.output).toContain("Morto");
  });

  it("gives the prompt back: the terminal takes another command after it", async () => {
    const t = await terminal();
    await endedBy(t, "sleep 303", "sleep", "pkill sleep");
    const next = await run(t, "echo volta", 2);
    expect(next.status).toBe(0);
    expect(next.output).toContain("volta");
  });
});

// Covers SPEC-029 CA-01 on the real terminal: a program that never ends (tail -f) stays alive in its terminal, the other terminals go on working, and it
// ends only when it is told to.
describe("tail -f stays alive without holding the other terminals", () => {
  it("follows the file in one terminal while another one works, until it is ended", async () => {
    const t = await terminal();
    expect((await run(t, "echo um > /tmp/seguir.log", 3)).status).toBe(0);
    const following = run(t, "tail -f /tmp/seguir.log", 2);
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await new Promise((r) => setTimeout(r, 150));
      found = (await run(t, "pgrep tail", 3)).status === 0;
    }
    expect(found, "tail -f is running").toBe(true);

    // The other terminal is free while tail -f runs, and what it writes is what tail -f follows.
    const other = await run(t, "echo dois >> /tmp/seguir.log && echo livre", 3);
    expect(other.status).toBe(0);
    expect(other.output).toContain("livre");
    await new Promise((r) => setTimeout(r, 1200));
    expect((await run(t, "pgrep tail", 3)).status, "still alive").toBe(0);

    await run(t, "pkill tail", 3);
    const ended = await following;
    expect(ended.output).toContain("um");
    expect(ended.output).toContain("dois");
    expect((await run(t, "pgrep tail", 3)).status).not.toBe(0);
  });
});
