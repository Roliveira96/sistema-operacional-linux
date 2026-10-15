import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalStep } from "@/engine/terminalWindow";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { MirroredModuleView } from "./MirroredModuleView";

vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

type Run = (step: TerminalStep) => Promise<number | null>;
interface FakeWindow {
  setSpeed: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn<Run>>;
  isBusy: ReturnType<typeof vi.fn<(terminal: number) => boolean>>;
}
const windows: FakeWindow[] = [];

function fakeWindow(): FakeWindow {
  const w: FakeWindow = { setSpeed: vi.fn(), destroy: vi.fn(), run: vi.fn<Run>(async () => 0), isBusy: vi.fn(() => false) };
  windows.push(w);
  return w;
}

beforeEach(() => {
  windows.length = 0;
  vi.mocked(mountTerminalWindow).mockImplementation(async () => fakeWindow() as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const empty: LiveTerminal = { screen: null };
const step: TerminalStep = { command: "uname -o" };

/** Mounts the teacher's terminal and gives the way to run a step that it told, once its window is open. */
async function mountTeacher(onRunner = vi.fn<(run: Run | null) => void>()) {
  const view = render(<MirroredModuleView role="teacher" terminal={empty} onRunner={onRunner} />);
  await waitFor(() => expect(onRunner).toHaveBeenCalled());
  const runner = () => onRunner.mock.calls.map(([run]) => run).filter((run): run is Run => run !== null).at(-1)!;
  return { view, onRunner, runner };
}

// SPEC-060 CA-01: the terminal of the teacher lets the screen run a step in it, and what it runs goes to the class through the picture
describe("MirroredModuleView: running a step in the terminal of the teacher", () => {
  it("tells the screen how to run a step as soon as its window is open, and not before", async () => {
    const onRunner = vi.fn();
    let open!: (window: never) => void;
    vi.mocked(mountTerminalWindow).mockImplementationOnce(() => new Promise((resolve) => (open = resolve as never)));
    render(<MirroredModuleView role="teacher" terminal={empty} onRunner={onRunner} />);
    await act(async () => undefined);
    expect(onRunner).not.toHaveBeenCalled();
    await act(async () => open(fakeWindow() as never));
    expect(onRunner).toHaveBeenCalledTimes(1);
    expect(onRunner.mock.calls[0]![0]).toBeTypeOf("function");
  });

  it("runs the step in the window of the class and gives the exit status", async () => {
    const { runner } = await mountTeacher();
    windows[0]!.run.mockResolvedValueOnce(2);
    expect(await runner()({ command: "ls /nada", terminal: 2, login: { user: "ricardo", password: "123" } })).toBe(2);
    expect(windows[0]!.run).toHaveBeenCalledWith({ command: "ls /nada", terminal: 2, login: { user: "ricardo", password: "123" } });
    expect(await runner()(step)).toBe(0);
  });

  it("gives null when the window did not run it", async () => {
    const { runner } = await mountTeacher();
    windows[0]!.run.mockResolvedValueOnce(null);
    expect(await runner()(step)).toBeNull();
  });

  it("gives null at once, without waiting for it, when the terminal that the step asks for is busy", async () => {
    const { runner } = await mountTeacher();
    windows[0]!.isBusy.mockImplementation((terminal) => terminal === 2);
    expect(await runner()({ command: "whoami", terminal: 2 })).toBeNull();
    expect(windows[0]!.run).not.toHaveBeenCalled();
    expect(windows[0]!.isBusy).toHaveBeenCalledWith(2);
    // The one a step does not name is terminal 1, which is the one it asks about.
    expect(await runner()(step)).toBe(0);
    expect(windows[0]!.isBusy).toHaveBeenLastCalledWith(1);
  });

  it("runs the step at the speed of the window, which is the normal one: the terminal is not asked to go faster", async () => {
    const { runner } = await mountTeacher();
    await runner()(step);
    expect(windows[0]!.setSpeed).not.toHaveBeenCalled();
  });

  it("says that it can no longer run steps when the window goes away", async () => {
    const { view, onRunner } = await mountTeacher();
    await act(async () => undefined);
    view.unmount();
    expect(onRunner).toHaveBeenLastCalledWith(null);
    expect(windows[0]!.destroy).toHaveBeenCalled();
  });

  it("says it when the view becomes the student's", async () => {
    const { view, onRunner } = await mountTeacher();
    await act(async () => undefined);
    view.rerender(<MirroredModuleView role="student" terminal={empty} onRunner={onRunner} />);
    expect(onRunner).toHaveBeenLastCalledWith(null);
  });

  it("tells the latest handler, and works with no handler", async () => {
    const { view, onRunner: first } = await mountTeacher();
    await act(async () => undefined);
    const second = vi.fn();
    view.rerender(<MirroredModuleView role="teacher" terminal={empty} onRunner={second} />);
    view.unmount();
    expect(first).not.toHaveBeenLastCalledWith(null);
    expect(second).toHaveBeenCalledWith(null);

    const bare = render(<MirroredModuleView role="teacher" terminal={empty} />);
    await waitFor(() => expect(windows).toHaveLength(2));
    await act(async () => undefined);
    expect(() => bare.unmount()).not.toThrow();
  });

  it("tells nothing when the window cannot be opened, so the screen knows there is no terminal to run in", async () => {
    vi.mocked(mountTerminalWindow).mockRejectedValueOnce(new Error("falhou"));
    const onRunner = vi.fn();
    render(<MirroredModuleView role="teacher" terminal={empty} onRunner={onRunner} />);
    await act(async () => undefined);
    expect(onRunner).not.toHaveBeenCalledWith(expect.any(Function));
  });

  it("tells nothing about a window that was opened after the view was gone", async () => {
    const onRunner = vi.fn();
    let open!: (window: never) => void;
    vi.mocked(mountTerminalWindow).mockImplementationOnce(() => new Promise((resolve) => (open = resolve as never)));
    const view = render(<MirroredModuleView role="teacher" terminal={empty} onRunner={onRunner} />);
    view.unmount();
    onRunner.mockClear();
    await act(async () => open(fakeWindow() as never));
    expect(onRunner).not.toHaveBeenCalledWith(expect.any(Function));
    expect(windows[0]!.destroy).toHaveBeenCalled();
  });

  // CA-04 of SPEC-056 and CA-02 of this one: the student's copy never runs anything
  it("gives the student's copy no way to run anything, and never tells", async () => {
    const onRunner = vi.fn();
    render(<MirroredModuleView role="student" terminal={empty} onRunner={onRunner} />);
    await act(async () => undefined);
    expect(mountTerminalWindow).not.toHaveBeenCalled();
    expect(onRunner).not.toHaveBeenCalledWith(expect.any(Function));
  });
});
