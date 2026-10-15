import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalStep } from "@/engine/terminalWindow";
import type { LiveModuleContent } from "@/services/classroomService";
import { LiveTopicScreen, type TopicLive } from "./LiveTopicScreen";

type Run = (step: TerminalStep) => Promise<number | null>;
type MirroredProps = { role: string; onRunner?: (run: Run | null) => void };

const mirrored = vi.fn<(props: MirroredProps) => void>();
vi.mock("@/components/Classroom/MirroredModuleView/MirroredModuleView", async () => {
  const React = await import("react");
  return {
    MirroredModuleView: (p: MirroredProps) => {
      mirrored(p);
      return React.createElement("div", { "data-testid": "terminal", "data-role": p.role });
    },
  };
});

const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { title: "Sistema", command: "uname", html: "<p>Sobre o sistema</p>" } },
    { id: "b-2", type: "COMMAND", position: 1, payload: { steps: [{ command: "uname -o" }, { command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } }] } },
    { id: "b-3", type: "COMMAND", position: 2, payload: { steps: [{ command: "pwd" }, { command: "passwd", answers: ["nova", "nova"] }] } },
  ],
};
const other: LiveModuleContent = {
  moduleId: "m-2",
  title: "Processos",
  scenario: { n: 2 },
  blocks: [
    { id: "c-1", type: "TEXT", position: 0, payload: { title: "Lista", command: "ps", html: "<p>Lista</p>" } },
    { id: "c-2", type: "COMMAND", position: 1, payload: { steps: [{ command: "ps aux" }] } },
  ],
};

const run = vi.fn<Run>();
/** Ends the run that is waiting, the way the terminal would. */
let finish: (status: number | null) => void = () => undefined;
const holdRun = () =>
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );

const lastProps = () => mirrored.mock.lastCall![0];
/** The terminal of the class tells the screen that it can run steps. */
const openTerminal = () => act(() => lastProps().onRunner!(run));
const closeTerminal = () => act(() => lastProps().onRunner!(null));

function screenOf(over: Partial<TopicLive> = {}): TopicLive {
  return { module: module_, role: "teacher", terminal: { screen: null }, focusBlockId: null, ...over };
}
function teacher(over: Partial<TopicLive> = {}) {
  const live = screenOf({ onRunFailed: vi.fn(), ...over });
  const view = render(<LiveTopicScreen live={live} />);
  return { view, live };
}

const buttons = () => screen.getAllByRole("button", { name: /Executar no terminal/ }) as HTMLButtonElement[];
const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const row = (step: number) => document.querySelector(`[data-step="${step}"]`) as HTMLElement;
const off = () => buttons().map((b) => b.disabled);

beforeEach(() => {
  mirrored.mockClear();
  run.mockReset();
  run.mockResolvedValue(0);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-060 CA-01: the click on the run button of an example runs it in the terminal of the class
describe("the examples of the material in the live class: running one", () => {
  it("draws the run button of every command example for the teacher", () => {
    teacher();
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Executar no terminal 1: uname -o",
      "Executar no terminal 2: whoami",
      "Executar no terminal 1: pwd",
      "Executar no terminal 1: passwd",
    ]);
    expect(off()).toEqual([false, false, false, false]);
  });

  it("tells the terminal of the class to run the step of the example, as the script has it", async () => {
    teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0, command: "uname -o" }));
  });

  it("keeps the terminal, the login and the answers of the step, which the terminal needs to run it as the study screen does", async () => {
    teacher();
    openTerminal();
    fireEvent.click(button(/whoami/));
    await act(async () => undefined);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1, command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } }));
    fireEvent.click(button(/passwd/));
    await act(async () => undefined);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ index: 3, command: "passwd", answers: ["nova", "nova"] }));
  });

  it("runs the steps one after the other when the teacher clicks the second example when the first is over", async () => {
    teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    fireEvent.click(button(/pwd/));
    await act(async () => undefined);
    expect(run.mock.calls.map(([step]) => step.command)).toEqual(["uname -o", "pwd"]);
  });

  it("does what the study screen does not need: no player, so no next, no back, no play all, no marks of done", async () => {
    teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(row(0).classList.contains("done")).toBe(false);
    expect(screen.queryByText(/Rodar este card/)).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  // The student sees the same buttons, off: the teacher is who runs
  it("gives the student the same buttons, off and out of the tab order, and runs nothing for him", async () => {
    render(<LiveTopicScreen live={screenOf({ role: "student" })} />);
    expect(buttons()).toHaveLength(4);
    expect(off()).toEqual([true, true, true, true]);
    expect(buttons().map((b) => b.tabIndex)).toEqual([-1, -1, -1, -1]);
    for (const b of buttons()) fireEvent.click(b);
    await act(async () => undefined);
    expect(run).not.toHaveBeenCalled();
  });

  it("gives the student's terminal no way to run anything", () => {
    render(<LiveTopicScreen live={screenOf({ role: "student" })} />);
    expect(lastProps().role).toBe("student");
    expect(lastProps().onRunner).toBeUndefined();
  });

  it("gives the teacher's terminal the way to tell that it can run steps", () => {
    teacher();
    expect(lastProps().role).toBe("teacher");
    expect(lastProps().onRunner).toBeTypeOf("function");
  });
});

// CA-03: one at a time, with the state in the button
describe("the state of the example that runs", () => {
  it("shows the state in the example and turns off the buttons of all the others while it runs", async () => {
    holdRun();
    teacher();
    openTerminal();
    fireEvent.click(button(/whoami/));
    await act(async () => undefined);
    expect(row(1).classList.contains("running")).toBe(true);
    expect(row(0).classList.contains("running")).toBe(false);
    expect(off()).toEqual([true, true, true, true]);
    await act(async () => finish(0));
  });

  it("turns the buttons on again and takes the state away when it ends", async () => {
    holdRun();
    teacher();
    openTerminal();
    fireEvent.click(button(/whoami/));
    await act(async () => undefined);
    await act(async () => finish(0));
    expect(row(1).classList.contains("running")).toBe(false);
    expect(off()).toEqual([false, false, false, false]);
  });

  it("runs one at a time: a click on another example while one runs does nothing", async () => {
    holdRun();
    teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    fireEvent.click(button(/pwd/));
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => finish(0));
  });

  it("runs another example once the first is over", async () => {
    holdRun();
    teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    await act(async () => finish(0));
    fireEvent.click(button(/pwd/));
    await act(async () => undefined);
    expect(run).toHaveBeenCalledTimes(2);
    expect(row(2).classList.contains("running")).toBe(true);
    await act(async () => finish(0));
  });

  it("does not take it as a failure when the command itself ended with an error: it ran, as the student would see", async () => {
    run.mockResolvedValue(1);
    const { live } = teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(live.onRunFailed).not.toHaveBeenCalled();
    expect(off()).toEqual([false, false, false, false]);
  });

  it("does not show the state to the student, whose buttons stay as they are", async () => {
    render(<LiveTopicScreen live={screenOf({ role: "student" })} />);
    expect(buttons().every((b) => b.className === "run")).toBe(true);
    expect(document.querySelector(".running")).toBeNull();
  });
});

// CA-04: when it cannot run, the button goes back and the window of the presentation is told
describe("the example that cannot run", () => {
  it("tells the window of the presentation, and gives the buttons back, when the terminal did not run the step", async () => {
    run.mockResolvedValue(null);
    const { live } = teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(live.onRunFailed).toHaveBeenCalledTimes(1);
    expect(off()).toEqual([false, false, false, false]);
    expect(row(0).classList.contains("running")).toBe(false);
  });

  it("tells it too when the terminal fails while it runs it", async () => {
    run.mockRejectedValue(new Error("falhou"));
    const { live } = teacher();
    openTerminal();
    fireEvent.click(button(/pwd/));
    await act(async () => undefined);
    expect(live.onRunFailed).toHaveBeenCalledTimes(1);
    expect(off()).toEqual([false, false, false, false]);
  });

  it("tells it when the terminal is not open yet, without running anything, and with no state in the button", async () => {
    const { live } = teacher();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(run).not.toHaveBeenCalled();
    expect(live.onRunFailed).toHaveBeenCalledTimes(1);
    expect(off()).toEqual([false, false, false, false]);
    expect(document.querySelector(".running")).toBeNull();
  });

  it("tells it when the terminal was closed after it was open", async () => {
    const { live } = teacher();
    openTerminal();
    closeTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(run).not.toHaveBeenCalled();
    expect(live.onRunFailed).toHaveBeenCalledTimes(1);
  });

  it("can run again after a failure", async () => {
    run.mockResolvedValueOnce(null);
    const { live } = teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(run).toHaveBeenCalledTimes(2);
    expect(live.onRunFailed).toHaveBeenCalledTimes(1);
  });

  it("tells the latest handler, and works with no handler", async () => {
    run.mockResolvedValue(null);
    const first = vi.fn();
    const second = vi.fn();
    const { view, live } = teacher({ onRunFailed: first });
    openTerminal();
    view.rerender(<LiveTopicScreen live={{ ...live, onRunFailed: second }} />);
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    view.rerender(<LiveTopicScreen live={{ ...live, onRunFailed: undefined }} />);
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

// The module of the room changes while an example runs: the buttons of the new module are not stuck, and the old run says nothing
describe("a module that is replaced while an example runs", () => {
  it("gives the buttons of the new module, which are not held by the run of the old one", async () => {
    holdRun();
    const { view, live } = teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    expect(off()).toEqual([true, true, true, true]);
    view.rerender(<LiveTopicScreen live={{ ...live, module: other }} />);
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Executar no terminal 1: ps aux"]);
    expect(off()).toEqual([false]);
    expect(document.querySelector(".running")).toBeNull();
    await act(async () => finish(0));
  });

  it("does not tell a failure of the run of the old module, which is no longer on the screen", async () => {
    holdRun();
    const { view, live } = teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    view.rerender(<LiveTopicScreen live={{ ...live, module: other }} />);
    await act(async () => finish(null));
    expect(live.onRunFailed).not.toHaveBeenCalled();
    expect(off()).toEqual([false]);
  });

  it("runs the example of the new module as soon as its terminal is open", async () => {
    holdRun();
    const { view, live } = teacher();
    openTerminal();
    fireEvent.click(button(/uname -o/));
    await act(async () => undefined);
    view.rerender(<LiveTopicScreen live={{ ...live, module: other }} />);
    run.mockResolvedValue(0);
    openTerminal();
    fireEvent.click(button(/ps aux/));
    await act(async () => undefined);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ command: "ps aux" }));
    await act(async () => finish(0));
  });
});
