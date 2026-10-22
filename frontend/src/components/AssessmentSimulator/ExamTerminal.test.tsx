import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalMount } from "@/test/fakeTerminal";
import { ExamTerminal } from "./ExamTerminal";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

let terminal: ReturnType<typeof terminalMount>;
beforeEach(() => {
  terminal = terminalMount();
  mount.mockImplementation(terminal.mount);
});
afterEach(() => {
  cleanup();
  mount.mockReset();
});

const scenarios: Record<string, unknown> = { "q-1": { name: "um" }, "q-2": { name: "dois" }, "q-null": null };
const load = () => vi.fn((id: string) => Promise.resolve(scenarios[id]));

function open(props: Partial<ComponentProps<typeof ExamTerminal>> = {}) {
  const loadScenario = load();
  const view = render(<ExamTerminal questionId="q-1" loadScenario={loadScenario} {...props} />);
  return { ...view, loadScenario, again: (next: Partial<ComponentProps<typeof ExamTerminal>>) => view.rerender(<ExamTerminal questionId="q-1" loadScenario={loadScenario} {...next} />) };
}
const ready = () => waitFor(() => expect(terminal.windows).toHaveLength(1));
const resetButton = () => screen.getByRole("button", { name: /Reset Máquina/ }) as HTMLButtonElement;

// SPEC-084 CA-03 to CA-08, D-01 to D-04: the terminal of the exam, one window for the whole exam, with the machine of the open question.
describe("ExamTerminal", () => {
  it("opens one window and starts it from the scenario of the question", async () => {
    const { loadScenario } = open();
    await ready();
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ name: "um" }));
    expect(loadScenario).toHaveBeenCalledWith("q-1");
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("starts the default machine when the question has no scenario", async () => {
    open({ questionId: "q-null" });
    await ready();
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith(null));
  });

  it("keeps the window and changes the machine with the question, and gives back what the student left in a question that is visited again", async () => {
    const { loadScenario, again } = open();
    await ready();
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(1));
    terminal.callbacks[0]!.onCommand({ name: "um", typed: "mkdir /a" });

    again({ questionId: "q-2" });
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenLastCalledWith({ name: "dois" }));
    again({ questionId: "q-1" });
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenLastCalledWith({ name: "um", typed: "mkdir /a" }));
    expect(loadScenario).toHaveBeenCalledTimes(2);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("formats the machine of the open question, from its scenario, after the confirmation, and leaves the others alone", async () => {
    const { again } = open();
    await ready();
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(1));
    again({ questionId: "q-2" });
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(2));

    fireEvent.click(resetButton());
    const dialog = screen.getByRole("dialog", { name: "Reiniciar a máquina?" });
    expect(within(dialog).getByText(/serão permanentemente perdidos/)).toBeDefined();
    expect(terminal.windows[0]!.resetAnimated).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Formatar a máquina" }));
    await waitFor(() => expect(terminal.windows[0]!.resetAnimated).toHaveBeenCalledWith({ name: "dois" }));
    expect(terminal.windows[0]!.resetAnimated).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does nothing when the confirmation is refused", async () => {
    open();
    await ready();
    fireEvent.click(resetButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Voltar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(terminal.windows[0]!.resetAnimated).not.toHaveBeenCalled();
  });

  it("locks the terminal on a question that does not use it, with the reason, and does not read any scenario", async () => {
    const { loadScenario, container } = open({ questionId: null });
    await ready();
    expect(screen.getByText("Esta questão não usa o terminal.")).toBeDefined();
    expect(resetButton().disabled).toBe(true);
    expect(container.querySelector("[inert]")).not.toBeNull();
    expect(loadScenario).not.toHaveBeenCalled();
  });

  it("unlocks the terminal when a question that uses it opens", async () => {
    const { again, container } = open({ questionId: null });
    await ready();
    again({ questionId: "q-1" });
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ name: "um" }));
    expect(screen.queryByText("Esta questão não usa o terminal.")).toBeNull();
    expect(resetButton().disabled).toBe(false);
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("says the machine of the question did not load, and tries again", async () => {
    const loadScenario = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue({ name: "um" });
    render(<ExamTerminal questionId="q-1" loadScenario={loadScenario} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar a máquina desta questão.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ name: "um" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loadScenario).toHaveBeenCalledTimes(2);
  });

  it("keeps the footer of the passwords and the shortcuts and has nothing of the study screen", async () => {
    open();
    await ready();
    expect(screen.getByText(/senhas:/)).toBeDefined();
    expect(screen.getByText("Tab", { selector: "kbd" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Cola|Som|Mudo|Painel de processos|Salvar|Abrir/ })).toBeNull();
  });

  it("says when the terminal cannot be opened", async () => {
    mount.mockRejectedValue(new Error("no engine"));
    open();
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível abrir o terminal.");
  });

  it("closes the window when it goes away", async () => {
    const { unmount } = open();
    await ready();
    unmount();
    expect(terminal.windows[0]!.destroy).toHaveBeenCalledTimes(1);
  });
});

// SPEC-085 CA-05, CA-08: the terminal tells the exam which question each command was typed in, with the machine, and which question had its machine
// formatted.
describe("ExamTerminal, what it tells the exam", () => {
  it("gives each command with the question it was typed in and the machine it left", async () => {
    const onCommand = vi.fn();
    const { again } = open({ onCommand });
    await ready();
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(1));
    terminal.callbacks[0]!.onCommand({ typed: "ls" });
    expect(onCommand).toHaveBeenLastCalledWith("q-1", { typed: "ls" });

    again({ questionId: "q-2", onCommand });
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(2));
    terminal.callbacks[0]!.onCommand({ typed: "pwd" });
    expect(onCommand).toHaveBeenLastCalledWith("q-2", { typed: "pwd" });
  });

  it("tells that the machine of the question was formatted once it was", async () => {
    const onFormat = vi.fn();
    open({ onFormat });
    await ready();
    fireEvent.click(resetButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Formatar a máquina" }));
    await waitFor(() => expect(onFormat).toHaveBeenCalledWith("q-1"));
    expect(terminal.windows[0]!.resetAnimated).toHaveBeenCalledTimes(1);
  });

  it("does not tell anything when the confirmation is refused", async () => {
    const onFormat = vi.fn();
    open({ onFormat });
    await ready();
    fireEvent.click(resetButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Voltar" }));
    expect(onFormat).not.toHaveBeenCalled();
  });
});

// SPEC-085 CA-05: the engine tells the exam about the machine every time it changes, also when the exam itself loads or formats it; those are not
// commands, so the question is not checked for them (a machine that was just loaded is not checked, only a command that ran).
describe("ExamTerminal, the machine that the exam itself loads", () => {
  /** A window like the real one: loading and formatting a machine tell the callback, as the engine does. */
  function noisyWindow() {
    mount.mockImplementation(async (_container: HTMLElement, _snapshot: unknown, callbacks: { onCommand(snapshot: unknown): void }) => {
      const noisy = {
        reset: vi.fn((snapshot: unknown) => callbacks.onCommand(snapshot)),
        resetAnimated: vi.fn(async (snapshot: unknown) => callbacks.onCommand(snapshot)),
        destroy: vi.fn(),
      };
      terminal.windows.push(noisy);
      terminal.callbacks.push(callbacks);
      return noisy;
    });
  }

  it("does not tell the exam about a machine it loaded or restored, only about the commands typed in it", async () => {
    noisyWindow();
    const onCommand = vi.fn();
    const { again } = open({ onCommand });
    await ready();
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ name: "um" }));
    again({ questionId: "q-2", onCommand });
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(2));
    again({ questionId: "q-1", onCommand });
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(3));
    expect(onCommand).not.toHaveBeenCalled();

    terminal.callbacks[0]!.onCommand({ typed: "ls" });
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("does not tell the exam about the machine of the format, and tells at once that the question was formatted", async () => {
    noisyWindow();
    const onCommand = vi.fn();
    const onFormat = vi.fn();
    open({ onCommand, onFormat });
    await ready();
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(1));
    fireEvent.click(resetButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Formatar a máquina" }));
    await waitFor(() => expect(terminal.windows[0]!.resetAnimated).toHaveBeenCalledTimes(1));
    expect(onFormat).toHaveBeenCalledWith("q-1");
    expect(onCommand).not.toHaveBeenCalled();
  });
});
