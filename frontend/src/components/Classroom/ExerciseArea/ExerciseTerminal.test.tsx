import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupLayer } from "@/lib/setup";
import { half, machine, none, picture, terminalHarness } from "@/test/exerciseFixtures";
import { ExerciseTerminal, type ExerciseTerminalProps } from "./ExerciseTerminal";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

const layer = (id: string, ...commands: string[]): SetupLayer => ({ id, kind: "card", label: id, setup: { summary: "", steps: commands.map((command) => ({ command })) } });

let h: ReturnType<typeof terminalHarness>;
const onChange = vi.fn();
const onScreen = vi.fn();

function terminal(over: Partial<ExerciseTerminalProps> = {}) {
  return <ExerciseTerminal initialState={{ base: 1 }} layers={[]} prepare={false} readOnly={false} onChange={onChange} onScreen={onScreen} {...over} />;
}
const ready = () => waitFor(() => expect(screen.queryByText("Carregando o terminal…")).toBeNull());

beforeEach(() => {
  h = terminalHarness(mount);
  h.set(none());
});
afterEach(() => {
  cleanup();
  mount.mockReset();
  onChange.mockReset();
  onScreen.mockReset();
});

// SPEC-065 CA-02: the terminal of the exercise is the real one of the engine, the student's own
describe("ExerciseTerminal", () => {
  it("says it is loading until the window is open, and then tells the machine it has", async () => {
    render(terminal());
    expect(screen.getByRole("status").textContent).toBe("Carregando o terminal…");
    await ready();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(none(), "", 0); // SPEC-071: and the commands of the student
  });

  it("opens the window on the machine it was given, once", async () => {
    const view = render(terminal({ initialState: { base: 1 } }));
    await ready();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(h.mounted!.snapshot).toEqual({ base: 1 });
    view.rerender(terminal({ initialState: { base: 2 } }));
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("prepares the machine by running the layers in order, at the normal speed after them", async () => {
    render(terminal({ prepare: true, layers: [layer("a", "mkdir /a", "touch /a/x"), layer("b", "touch /b")] }));
    await ready();
    expect(h.win.execute.mock.calls.map(([step]) => step.command)).toEqual(["mkdir /a", "touch /a/x", "touch /b"]);
    expect(h.win.setSpeed).toHaveBeenLastCalledWith(1);
  });

  it("does not prepare a machine that came back from the browser", async () => {
    render(terminal({ prepare: false, layers: [layer("a", "mkdir /a")] }));
    await ready();
    expect(h.win.execute).not.toHaveBeenCalled();
  });

  it("tells nothing of the commands of the preparation, and takes the commands typed after it as the student's", async () => {
    h.win.execute.mockImplementation(async (step) => {
      h.history.push(step.command);
      h.mounted!.callbacks.onCommand({});
      return { status: 0, output: "" };
    });
    render(terminal({ prepare: true, layers: [layer("a", "mkdir /a", "touch /a/x")] }));
    await ready();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(none(), "", 0);
    h.type("mkdir /dois", half());
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(half(), "mkdir /dois", 1); // the preparation is not counted
  });

  it("gives the whole machine, with its processes, as the window has it, and not what the command told", async () => {
    render(terminal());
    await ready();
    h.set({ ...machine(), processos: [{ pid: 1 }] });
    h.mounted!.callbacks.onCommand({ onlyTheMachine: true });
    expect(onChange).toHaveBeenLastCalledWith({ ...machine(), processos: [{ pid: 1 }] }, "", 0);
  });

  it("tells the picture of its window", async () => {
    render(terminal());
    await ready();
    h.show(picture("oi"));
    expect(onScreen).toHaveBeenCalledWith(picture("oi"));
  });

  it("says so when the window cannot be opened", async () => {
    mount.mockRejectedValue(new Error("no engine"));
    render(terminal());
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível abrir o terminal.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes the window when it goes away, also when it opens after that", async () => {
    const view = render(terminal());
    await ready();
    view.unmount();
    expect(h.win.destroy).toHaveBeenCalledTimes(1);

    let open: (value: unknown) => void = () => undefined;
    mount.mockReturnValue(new Promise((resolve) => (open = resolve)));
    const early = render(terminal());
    early.unmount();
    open(h.win);
    await waitFor(() => expect(h.win.destroy).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// SPEC-065 3.3: with the exercise done the terminal is only to read
describe("ExerciseTerminal, read only", () => {
  const keys = (target: HTMLElement, key: string) => fireEvent.keyDown(target, { key });

  it("lets the keys and the paste reach the window while the student works", async () => {
    render(terminal());
    await ready();
    keys(h.screen(), "a");
    fireEvent.paste(h.screen());
    expect(h.keys).toHaveBeenCalledWith("a");
    expect(h.pasted).toHaveBeenCalledTimes(1);
  });

  it("stops the keys and the paste before they reach the window, but lets the student leave it with Tab", async () => {
    render(terminal({ readOnly: true }));
    await ready();
    keys(h.screen(), "a");
    keys(h.screen(), "Enter");
    fireEvent.paste(h.screen());
    expect(h.keys).not.toHaveBeenCalledWith("a");
    expect(h.keys).not.toHaveBeenCalledWith("Enter");
    expect(h.pasted).not.toHaveBeenCalled();
    keys(h.screen(), "Tab");
    expect(h.keys).toHaveBeenCalledWith("Tab");
  });

  it("stops the keys from the moment it becomes read only, with the window already open", async () => {
    const view = render(terminal());
    await ready();
    view.rerender(terminal({ readOnly: true }));
    keys(h.screen(), "b");
    expect(h.keys).not.toHaveBeenCalled();
  });
});
