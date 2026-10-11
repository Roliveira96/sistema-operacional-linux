import "@/test/domMatchers";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndedEntry, ProcessEntry } from "@/engine/processes/snapshot";
import { ProcessPanel } from "./ProcessPanel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const entry = (pid: number, comando: string, extra: Partial<ProcessEntry> = {}): ProcessEntry => ({ pid, ppid: 2408, uid: 1000, usuario: "ricardo", tty: "pts/1", comando, estado: "S", nice: 0, ...extra });

/** A source the test changes between the polls, as the machine changes while the student types. */
function source(initial: { processos: ProcessEntry[]; encerrados: EndedEntry[] }) {
  const state = { ...initial };
  return { state, processes: () => ({ processos: [...state.processos], encerrados: [...state.encerrados] }) };
}

const tick = (ms = 500) => act(() => void vi.advanceTimersByTime(ms));
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

// Covers SPEC-029 CA-08, RN-06 (entrega B): the panel shows what ps and top show, alive.
describe("ProcessPanel", () => {
  it("says there is nothing yet, and how to start something, when no program is running", async () => {
    render(<ProcessPanel source={source({ processos: [], encerrados: [] })} />);
    await tick(0);
    expect(screen.getByText(/Nenhum programa do usuário rodando/)).toBeDefined();
    expect(screen.getByText("0 programas")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the programs with the pid, the parent, the user, the state, the priority and the command", async () => {
    render(<ProcessPanel source={source({ processos: [entry(2451, "sleep 300", { nice: 10 }), entry(2460, "ping localhost", { estado: "T" })], encerrados: [] })} />);
    await tick(0);
    expect(screen.getByText("2 programas")).toBeDefined();
    const [sleep, ping] = rows();
    expect(within(sleep!).getAllByRole("cell").map((c) => c.textContent?.replace(/^[^\p{L}\p{N}]+/u, ""))).toEqual(["2451", "2408", "ricardo", "Dormindo (S)", "10", "sleep 300"]);
    expect(within(ping!).getByText(/Parado \(T\)/)).toBeDefined();
    expect(sleep!.getAttribute("data-state")).toBe("S");
    expect(ping!.getAttribute("data-state")).toBe("T");
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText(/S: dormindo, esperando; T: parado/)).toBeDefined();
  });

  it("puts each program under its parent, in a tree, with the parents that are not on the list first", async () => {
    const list = [entry(2470, "sleep 5", { ppid: 2460 }), entry(2460, "bash script.sh", { ppid: 2408 }), entry(2500, "top", { ppid: 2408 }), entry(2480, "ls", { ppid: 2470 })];
    render(<ProcessPanel source={source({ processos: list, encerrados: [] })} />);
    await tick(0);
    expect(rows().map((r) => within(r).getAllByRole("cell").at(-1)!.textContent)).toEqual(["bash script.sh", "└─ sleep 5", "  └─ ls", "top"]);
  });

  it("follows the machine: a program that stops, resumes, is renamed by nice, or is gone changes the panel (CA-03)", async () => {
    const s = source({ processos: [entry(2451, "sleep 300")], encerrados: [] });
    render(<ProcessPanel source={s} intervalMs={500} />);
    await tick(0);
    expect(within(rows()[0]!).getByText(/Dormindo/)).toBeDefined();
    s.state.processos = [entry(2451, "sleep 300", { estado: "T", nice: 5 })];
    await tick();
    expect(within(rows()[0]!).getByText(/Parado/)).toBeDefined();
    expect(within(rows()[0]!).getAllByRole("cell")[4]!.textContent).toBe("5");
    s.state.processos = [entry(2451, "sleep 300")];
    await tick();
    expect(within(rows()[0]!).getByText(/Dormindo/)).toBeDefined();
  });

  it("shows a program a signal has just ended, with the signal, and takes it off the panel after a while", async () => {
    const s = source({ processos: [entry(2451, "sleep 300")], encerrados: [] });
    render(<ProcessPanel source={s} />);
    await tick(0);
    s.state.processos = [];
    s.state.encerrados = [{ pid: 2451, comando: "sleep 300", sinal: 15 }];
    await tick();
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText("Encerrado pelo sinal 15 (TERM)")).toBeDefined();
    expect(rows()[0]!.getAttribute("data-state")).toBe("ended");
    // Another one ended by another signal: both are there.
    s.state.encerrados = [...s.state.encerrados, { pid: 2460, comando: "yes", sinal: 9 }];
    await tick();
    expect(rows()).toHaveLength(2);
    expect(screen.getByText("Encerrado pelo sinal 9 (KILL)")).toBeDefined();
    // After a while the effect is no longer news.
    await tick(13_000);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/Nenhum programa do usuário rodando/)).toBeDefined();
  });

  it("does not show as news what had already ended when the panel was opened", async () => {
    render(<ProcessPanel source={source({ processos: [], encerrados: [{ pid: 2300, comando: "top", sinal: 15 }] })} />);
    await tick(1000);
    expect(screen.queryByText(/Encerrado pelo sinal/)).toBeNull();
  });

  it("names the signals it knows and shows a ? for the ones it does not", async () => {
    const s = source({ processos: [], encerrados: [] });
    render(<ProcessPanel source={s} />);
    await tick(0);
    s.state.encerrados = [{ pid: 1, comando: "a", sinal: 10 }, { pid: 2, comando: "b", sinal: 99 }];
    await tick();
    expect(screen.getByText("Encerrado pelo sinal 10 (USR1)")).toBeDefined();
    expect(screen.getByText("Encerrado pelo sinal 99 (?)")).toBeDefined();
  });

  it("stops reading the machine when it is closed, and does nothing with a terminal that has no processes to tell", async () => {
    const s = source({ processos: [entry(1, "sleep 1")], encerrados: [] });
    const spy = vi.spyOn(s, "processes");
    const { unmount } = render(<ProcessPanel source={s} />);
    await tick(0);
    const calls = spy.mock.calls.length;
    unmount();
    await tick(3000);
    expect(spy.mock.calls.length).toBe(calls);

    cleanup();
    render(<ProcessPanel source={{}} />);
    await tick(1000);
    expect(screen.getByText(/Nenhum programa do usuário rodando/)).toBeDefined();
    cleanup();
    render(<ProcessPanel source={null} />);
    expect(screen.getByText("0 programas")).toBeDefined();
  });

  it("says one program in the singular", async () => {
    render(<ProcessPanel source={source({ processos: [entry(1, "sleep 1")], encerrados: [] })} />);
    await tick(0);
    expect(screen.getByText("1 programa")).toBeDefined();
  });
});
