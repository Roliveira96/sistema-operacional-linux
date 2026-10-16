import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/domMatchers";
import { TerminalPane } from "./TerminalPane";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

afterEach(() => {
  cleanup();
  mount.mockReset();
});

const fakeWindow = () => ({ destroy: vi.fn() });

// Covers SPEC-016 CA-01: the window opens ready; until then the pane says so.
describe("TerminalPane", () => {
  it("shows the loading state, then hands the window to the screen", async () => {
    const terminal = fakeWindow();
    mount.mockResolvedValue(terminal);
    const onReady = vi.fn();
    render(<TerminalPane snapshot={{ a: 1 }} onReady={onReady} onCommand={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Preparando o terminal");
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(terminal));
    expect(screen.queryByRole("status")).toBeNull();
    expect(mount.mock.calls[0]?.[1]).toEqual({ a: 1 });
  });

  it("forwards each command of the terminal with the machine state", async () => {
    mount.mockImplementation(async (_container, _snapshot, callbacks) => {
      callbacks.onCommand({ n: 2 });
      return fakeWindow();
    });
    const onCommand = vi.fn();
    render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={onCommand} />);
    await waitFor(() => expect(onCommand).toHaveBeenCalledWith({ n: 2 }));
  });

  it("says so when the terminal cannot be opened", async () => {
    mount.mockRejectedValue(new Error("no engine"));
    render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível abrir o terminal");
  });

  it("destroys the window on unmount, and also when it opens after the unmount", async () => {
    const early = fakeWindow();
    mount.mockResolvedValue(early);
    const first = render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    await waitFor(() => expect(mount).toHaveBeenCalled());
    await Promise.resolve();
    first.unmount();
    expect(early.destroy).toHaveBeenCalled();

    let finish: (value: unknown) => void = () => {};
    const late = fakeWindow();
    mount.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const second = render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    second.unmount();
    finish(late);
    await waitFor(() => expect(late.destroy).toHaveBeenCalled());
  });
});

// Covers SPEC-029 entrega B: the button that turns the panel of processes on and off, and remembers it in this browser.
describe("TerminalPane, the panel of processes", () => {
  const withProcesses = () => ({
    destroy: vi.fn(),
    processes: vi.fn(() => ({
      processos: [{ pid: 2451, ppid: 2408, uid: 1000, usuario: "ricardo", tty: "pts/1", comando: "sleep 300", estado: "S", nice: 0 }],
      encerrados: [],
    })),
  });
  const panelButton = () => screen.findByRole("button", { name: /Painel de processos/ });

  afterEach(() => localStorage.clear());

  it("starts off, shows the processes of the terminal when turned on, and hides them when turned off", async () => {
    mount.mockResolvedValue(withProcesses());
    render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    const button = await panelButton();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("region", { name: "Processos" })).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByRole("region", { name: "Processos" })).toBeDefined();
    expect(await screen.findByText("sleep 300")).toBeDefined();

    fireEvent.click(button);
    expect(screen.queryByRole("region", { name: "Processos" })).toBeNull();
  });

  it("remembers the choice in this browser, and starts with the panel on when it was left on", async () => {
    mount.mockResolvedValue(withProcesses());
    const first = render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    fireEvent.click(await panelButton());
    expect(localStorage.getItem("terminal-process-panel")).toBe("on");
    first.unmount();

    mount.mockResolvedValue(withProcesses());
    render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    expect(await screen.findByRole("region", { name: "Processos" })).toBeDefined();
    fireEvent.click(await panelButton());
    expect(localStorage.getItem("terminal-process-panel")).toBe("off");
  });

  it("has no button before the terminal is ready, and works when the browser keeps nothing", async () => {
    mount.mockResolvedValue(withProcesses());
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Painel de processos/ })).toBeNull();
    fireEvent.click(await panelButton());
    expect(await screen.findByRole("region", { name: "Processos" })).toBeDefined();
    get.mockRestore();
    set.mockRestore();
  });
});

// Covers SPEC-015 CA-03: under the window of the terminal, the footer says how to use it: the keys and what each one does.
describe("TerminalPane, the footer of shortcuts", () => {
  it("lists Tab, the up arrow, Ctrl+C and Ctrl+L, each with what it does", async () => {
    mount.mockResolvedValue(fakeWindow());
    const { container } = render(<TerminalPane snapshot={null} onReady={vi.fn()} onCommand={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    const footer = container.querySelector("p:last-of-type") as HTMLElement;
    expect([...footer.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual(["Tab", "↑", "Ctrl+C", "Ctrl+L"]);
    for (const text of ["completa", "histórico", "cancela", "limpa"]) expect(footer.textContent).toContain(text);
  });
});
