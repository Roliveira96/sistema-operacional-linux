import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
