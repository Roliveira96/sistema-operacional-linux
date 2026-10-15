import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalCommandEvent, type TerminalWindowCallbacks } from "@/engine/terminalWindow";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { MirroredModuleView } from "./MirroredModuleView";

vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));

type FakeWindow = Record<"setSpeed" | "setReadOnly" | "showInput" | "printScreen" | "syncMachine" | "destroy", ReturnType<typeof vi.fn>>;
const windows: FakeWindow[] = [];
let callbacks: TerminalWindowCallbacks | null = null;

function fakeWindow(): FakeWindow {
  const w: FakeWindow = {
    setSpeed: vi.fn(),
    setReadOnly: vi.fn(),
    showInput: vi.fn().mockResolvedValue(undefined),
    printScreen: vi.fn().mockResolvedValue(undefined),
    syncMachine: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  };
  windows.push(w);
  return w;
}

beforeEach(() => {
  windows.length = 0;
  callbacks = null;
  vi.mocked(mountTerminalWindow).mockImplementation(async (_container, _snapshot, cb) => {
    callbacks = cb;
    return fakeWindow() as never;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const empty: LiveTerminal = { input: null, entries: [], state: null, revision: 0 };
const entry = (line: string, n: number): TerminalCommandEvent => ({
  terminal: 1,
  line,
  output: `saida ${n}`,
  status: 0,
  segments: [{ text: `root@x:~# ${line}\n` }, { text: `saida ${n}\n` }],
  user: "root",
  cwd: "/tmp",
  state: { n },
});

// SPEC-051 CA-07 and CA-08
describe("MirroredModuleView", () => {
  it("gives the teacher the real terminal and passes on what he types and runs", async () => {
    const onInput = vi.fn();
    const onSync = vi.fn();
    render(<MirroredModuleView role="teacher" terminal={empty} onInput={onInput} onSync={onSync} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    expect(windows[0]!.setReadOnly).not.toHaveBeenCalledWith(true);
    callbacks!.onInput!({ terminal: 1, line: "l" });
    expect(onInput).toHaveBeenCalledWith({ terminal: 1, line: "l" });
    const done = entry("ls", 1);
    callbacks!.onCommandDone!(done);
    expect(onSync).toHaveBeenCalledWith(done);
  });

  it("gives the student a read-only copy that reports nothing", async () => {
    render(<MirroredModuleView role="student" terminal={empty} />);
    await waitFor(() => expect(windows[0]?.setReadOnly).toHaveBeenCalledWith(true));
    expect(callbacks!.onInput).toBeUndefined();
    expect(callbacks!.onCommandDone).toBeUndefined();
    expect(screen.getByText("Você acompanha o terminal do professor. O teclado fica travado.")).toBeDefined();
  });

  it("shows what the teacher is typing", async () => {
    const view = render(<MirroredModuleView role="student" terminal={empty} />);
    await waitFor(() => expect(windows[0]?.setReadOnly).toHaveBeenCalled());
    view.rerender(<MirroredModuleView role="student" terminal={{ ...empty, input: { terminal: 1, line: "ls -l" } }} />);
    await waitFor(() => expect(windows[0]!.showInput).toHaveBeenCalledWith(1, "ls -l"));
  });

  it("prints each command with its output and applies the machine, once and in order", async () => {
    const view = render(<MirroredModuleView role="student" terminal={empty} />);
    await waitFor(() => expect(windows[0]?.setReadOnly).toHaveBeenCalled());
    const first = entry("ls", 1);
    view.rerender(<MirroredModuleView role="student" terminal={{ input: null, entries: [first], state: first.state, revision: 1 }} />);
    await waitFor(() => expect(windows[0]!.syncMachine).toHaveBeenCalledTimes(1));
    expect(windows[0]!.printScreen).toHaveBeenCalledWith(1, first.segments);
    expect(windows[0]!.syncMachine).toHaveBeenCalledWith(first.state, { terminal: 1, cwd: "/tmp" });

    const second = entry("pwd", 2);
    view.rerender(<MirroredModuleView role="student" terminal={{ input: null, entries: [first, second], state: second.state, revision: 2 }} />);
    await waitFor(() => expect(windows[0]!.syncMachine).toHaveBeenCalledTimes(2));
    expect(windows[0]!.printScreen).toHaveBeenCalledTimes(2);
    expect(windows[0]!.printScreen).toHaveBeenLastCalledWith(1, second.segments);
  });

  // CA-14: who comes in the middle of the class gets the recent commands and the last machine
  it("prints the history that was already there when the student comes in, and applies the last machine only", async () => {
    const entries = [entry("ls", 1), entry("pwd", 2), entry("date", 3)];
    render(<MirroredModuleView role="student" terminal={{ input: { terminal: 1, line: "cat" }, entries, state: entries[2]!.state, revision: 1 }} />);
    await waitFor(() => expect(windows[0]?.printScreen).toHaveBeenCalledTimes(3));
    expect(windows[0]!.syncMachine).toHaveBeenCalledTimes(1);
    expect(windows[0]!.syncMachine).toHaveBeenCalledWith(entries[2]!.state, { terminal: 1, cwd: "/tmp" });
    await waitFor(() => expect(windows[0]!.showInput).toHaveBeenCalledWith(1, "cat"));
  });

  it("says so when the terminal cannot be opened", async () => {
    vi.mocked(mountTerminalWindow).mockRejectedValueOnce(new Error("falhou"));
    render(<MirroredModuleView role="student" terminal={empty} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível abrir o terminal.");
  });

  it("frees the window when it goes away", async () => {
    const view = render(<MirroredModuleView role="teacher" terminal={empty} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    await act(async () => {});
    view.unmount();
    expect(windows[0]!.destroy).toHaveBeenCalled();
  });
});
