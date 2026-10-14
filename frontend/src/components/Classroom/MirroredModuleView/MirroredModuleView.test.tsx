import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindowCallbacks } from "@/engine/terminalWindow";
import type { ScreenElement } from "@/engine/terminalScreen";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { MirroredModuleView } from "./MirroredModuleView";

vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

type FakeWindow = Record<"setSpeed" | "destroy", ReturnType<typeof vi.fn>>;
const windows: FakeWindow[] = [];
let callbacks: TerminalWindowCallbacks | null = null;

function fakeWindow(): FakeWindow {
  const w: FakeWindow = { setSpeed: vi.fn(), destroy: vi.fn() };
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

const empty: LiveTerminal = { screen: null };
const tree = (text: string): ScreenElement => ({
  tag: "div",
  attrs: { class: "janela" },
  children: [{ tag: "div", attrs: { class: "term-tela" }, children: [{ tag: "div", attrs: { class: "term-linha" }, children: [text] }] }],
});

// SPEC-056 CA-01 to CA-05: the teacher has the real terminal and tells its screen; the student only draws the screen it receives
describe("MirroredModuleView", () => {
  it("gives the teacher the real terminal and passes on the picture of its screen", async () => {
    const onScreen = vi.fn();
    render(<MirroredModuleView role="teacher" terminal={empty} onScreen={onScreen} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    expect(callbacks!.onScreen).toBeTypeOf("function");
    const picture = tree("ls");
    callbacks!.onScreen!(picture);
    expect(onScreen).toHaveBeenCalledWith(picture);
  });

  it("tells the picture to the latest handler, and not to the one of the first render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<MirroredModuleView role="teacher" terminal={empty} onScreen={first} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    view.rerender(<MirroredModuleView role="teacher" terminal={empty} onScreen={second} />);
    callbacks!.onScreen!(tree("pwd"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not ask the teacher's terminal for what was typed or run, which is no longer sent", async () => {
    render(<MirroredModuleView role="teacher" terminal={empty} onScreen={vi.fn()} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    expect(callbacks).not.toHaveProperty("onInput");
    expect(callbacks).not.toHaveProperty("onCommandDone");
    expect(screen.queryByText("Você acompanha o terminal do professor. O teclado fica travado.")).toBeNull();
  });

  // CA-04: the student never mounts the engine
  it("gives the student a copy that does not mount the terminal engine", async () => {
    render(<MirroredModuleView role="student" terminal={{ screen: tree("ola") }} />);
    await act(async () => {});
    expect(mountTerminalWindow).not.toHaveBeenCalled();
    expect(callbacks).toBeNull();
    expect(screen.getByText("Você acompanha o terminal do professor. O teclado fica travado.")).toBeDefined();
  });

  // CA-05: who comes in the middle gets the current screen from the snapshot, with no new change
  it("shows to the student the screen that was already there when he came in", () => {
    render(<MirroredModuleView role="student" terminal={{ screen: tree("tela atual do professor") }} />);
    expect(screen.getByText("tela atual do professor")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says it is loading until the first screen arrives, and follows each new one", () => {
    const view = render(<MirroredModuleView role="student" terminal={empty} />);
    expect(screen.getByRole("status").textContent).toBe("Carregando o terminal…");
    view.rerender(<MirroredModuleView role="student" terminal={{ screen: tree("primeira") }} />);
    expect(screen.getByText("primeira")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<MirroredModuleView role="student" terminal={{ screen: tree("segunda") }} />);
    expect(screen.queryByText("primeira")).toBeNull();
    expect(screen.getByText("segunda")).toBeDefined();
  });

  it("says so when the terminal of the teacher cannot be opened", async () => {
    vi.mocked(mountTerminalWindow).mockRejectedValueOnce(new Error("falhou"));
    render(<MirroredModuleView role="teacher" terminal={empty} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível abrir o terminal.");
  });

  it("frees the window when it goes away", async () => {
    const view = render(<MirroredModuleView role="teacher" terminal={empty} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    await act(async () => {});
    view.unmount();
    expect(windows[0]!.destroy).toHaveBeenCalled();
  });

  it("frees the window of the teacher when the view becomes the student's", async () => {
    const view = render(<MirroredModuleView role="teacher" terminal={empty} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    await act(async () => {});
    view.rerender(<MirroredModuleView role="student" terminal={empty} />);
    expect(windows[0]!.destroy).toHaveBeenCalled();
  });

  // SPEC-054 CA-11: the terminal of the teacher starts on the machine of the module
  it("mounts the terminal on the machine of the module when it is given", async () => {
    const machine = { formato: "exame-so/maquina", n: 7 };
    render(<MirroredModuleView role="teacher" terminal={empty} initialState={machine} />);
    await waitFor(() => expect(mountTerminalWindow).toHaveBeenCalledTimes(1));
    expect(vi.mocked(mountTerminalWindow).mock.calls[0]![1]).toBe(machine);
  });

  it("mounts the default machine when there is none", async () => {
    render(<MirroredModuleView role="teacher" terminal={empty} />);
    await waitFor(() => expect(mountTerminalWindow).toHaveBeenCalledTimes(1));
    expect(vi.mocked(mountTerminalWindow).mock.calls[0]![1]).toBeNull();
  });
});
