import "@/test/domMatchers";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import { ProcessPanel } from "./ProcessPanel";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 180_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  cleanup();
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

const run = async (t: TerminalWindow, command: string, terminal = 1) => {
  const r = await t.execute({ command, terminal, ...(terminal > 1 ? { login: { user: "ricardo", password: "123" } } : {}) });
  return r.output;
};

// Covers SPEC-029 CA-03, CA-08, RN-06 on the real terminal: the panel shows what ps shows, alive, as another terminal stops, resumes and ends a program.
describe("the panel of processes on the real terminal", () => {
  it("follows a program that another terminal stops, resumes and ends, and says which signal ended it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    win = await mountTerminalWindow(host, null, { onCommand: () => {} });
    win.setSpeed(100);
    render(<ProcessPanel source={win} intervalMs={100} />);
    expect(screen.getByText(/Nenhum programa do usuário rodando/)).toBeDefined();

    const started = await run(win, "nice -n 3 sleep 300 &", 2);
    const pid = Number(/\[1\]\s+(\d+)/.exec(started.toString())?.[1]);
    const row = async () => (await screen.findByText("sleep 300")).closest("tr")!;
    expect(within(await row()).getByText(/Dormindo/)).toBeDefined();
    expect(within(await row()).getAllByRole("cell")[4]!.textContent).toBe("3");
    expect(within(await row()).getAllByRole("cell")[0]!.textContent).toBe(String(pid));
    // The same state ps shows.
    expect((await run(win, `ps -o pid,stat,ni -p ${pid}`, 3)).split("\n")[1]!.trim().split(/\s+/)).toEqual([String(pid), "S", "3"]);

    await run(win, `kill -STOP ${pid}`, 3);
    await waitFor(async () => expect(within(await row()).getByText(/Parado/)).toBeDefined());
    expect((await run(win, `ps -o pid,stat -p ${pid}`, 3)).split("\n")[1]!.trim().split(/\s+/)[1]).toBe("T");

    await run(win, `kill -CONT ${pid}`, 3);
    await waitFor(async () => expect(within(await row()).getByText(/Dormindo/)).toBeDefined());

    await run(win, `kill ${pid}`, 3);
    expect(await screen.findByText("Encerrado pelo sinal 15 (TERM)")).toBeDefined();
    expect(screen.queryByText(/Dormindo/)).toBeNull();
  });
});
