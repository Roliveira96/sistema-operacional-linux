import { readFileSync } from "node:fs";
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
const locator = { offsetOf: () => 0, terminalOf: () => 1 };
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
    callbacks!.onScreen!(picture, locator);
    expect(onScreen).toHaveBeenCalledWith(picture);
  });

  it("tells the picture to the latest handler, and not to the one of the first render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<MirroredModuleView role="teacher" terminal={empty} onScreen={first} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    view.rerender(<MirroredModuleView role="teacher" terminal={empty} onScreen={second} />);
    callbacks!.onScreen!(tree("pwd"), locator);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  // SPEC-057 CA-20: with each picture the window gives the locator of its text, so the teacher's selection can be told over that text
  it("passes on the locator that comes with the picture, apart from the picture", async () => {
    const onScreen = vi.fn();
    const onLocator = vi.fn();
    render(<MirroredModuleView role="teacher" terminal={empty} onScreen={onScreen} onLocator={onLocator} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    const picture = tree("ls");
    (callbacks!.onScreen as (tree: ScreenElement, locator: unknown) => void)(picture, locator);
    expect(onScreen).toHaveBeenCalledWith(picture);
    expect(onLocator).toHaveBeenCalledWith(locator);
  });

  it("tells the locator to the latest handler, and works with no handler for it", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<MirroredModuleView role="teacher" terminal={empty} onScreen={vi.fn()} onLocator={first} />);
    await waitFor(() => expect(windows).toHaveLength(1));
    view.rerender(<MirroredModuleView role="teacher" terminal={empty} onScreen={vi.fn()} onLocator={second} />);
    (callbacks!.onScreen as (tree: ScreenElement, locator: unknown) => void)(tree("a"), locator);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(locator);
    view.rerender(<MirroredModuleView role="teacher" terminal={empty} />);
    expect(() => (callbacks!.onScreen as (tree: ScreenElement, locator: unknown) => void)(tree("b"), locator)).not.toThrow();
  });

  // CA-20, CA-21: the student marks the stretch the teacher selected on the copy of the terminal
  it("marks on the student's copy the stretch of the terminal that the teacher selected, and not one of the material", () => {
    const registry = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { ...CSS, highlights: registry });
    vi.stubGlobal("Highlight", class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } });
    try {
      const picked = { pane: "terminal" as const, terminal: 1, start: 0, end: 3 };
      const view = render(<MirroredModuleView role="student" terminal={{ screen: tree("tela do professor") }} selection={picked} />);
      expect(registry.get("teacher-terminal")!.ranges[0]!.toString()).toBe("tel");
      view.rerender(<MirroredModuleView role="student" terminal={{ screen: tree("tela do professor") }} selection={{ pane: "material", start: { block: "b", offset: 0 }, end: { block: "b", offset: 2 } }} />);
      expect(registry.has("teacher-terminal")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
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
    // It is read only, with no keyboard, and it does not say so on the screen (SPEC-057 CA-22).
    expect(screen.queryByText("Você acompanha o terminal do professor. O teclado fica travado.")).toBeNull();
    expect(screen.getByTestId("terminal-mirror").hasAttribute("inert")).toBe(true);
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

  // SPEC-057 CA-22: nothing of the stage is only the student's, so the terminal of the student is drawn as the teacher's is
  describe("the same place for the teacher and for the student", () => {
    const file = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
    const teacherStyle = file("./MirroredModuleView.module.scss");
    const studentStyle = file("../TerminalMirror/TerminalMirror.module.scss");
    /** What a rule of the style says, as a list: without the comments, and without what is only about the selection and the look of the copy. */
    const rule = (css: string, name: string) => {
      const start = css.indexOf(`.${name} {`);
      return css
        .slice(start, css.indexOf("}", start))
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/\/\/.*$/, "").trim())
        .filter((line) => line && !line.startsWith("user-select"))
        .sort();
    };

    it("has the same view, window and note in the style of the two, so they take the same room", () => {
      for (const name of ["view", "window", "note"]) expect(rule(studentStyle, name)).toEqual(rule(teacherStyle, name));
    });

    it("keeps what the terminal says about itself over the window, not in the flow, for the teacher as well", () => {
      expect(rule(teacherStyle, "note").join(" ")).toMatch(/position: absolute/);
      expect(rule(teacherStyle, "error").join(" ")).toMatch(/position: absolute/);
      expect(rule(teacherStyle, "view").join(" ")).toMatch(/position: relative/);
    });

    it("has the window first in the flow of the teacher's terminal, with the loading and the error over it", async () => {
      const view = render(<MirroredModuleView role="teacher" terminal={empty} />);
      const section = view.container.firstElementChild!;
      expect(section.firstElementChild!.className).toContain("window");
      expect(section.lastElementChild!.getAttribute("role")).toBe("status");
      await waitFor(() => expect(windows).toHaveLength(1));
      await act(async () => {});
      expect(section.children).toHaveLength(1);
      expect(section.firstElementChild!.className).toContain("window");
    });

    it("has the window first in the flow of the student's copy, with the loading over it", () => {
      const view = render(<MirroredModuleView role="student" terminal={empty} />);
      const section = view.container.firstElementChild!;
      expect(section.firstElementChild!.getAttribute("data-testid")).toBe("terminal-mirror");
      expect(section.lastElementChild!.getAttribute("role")).toBe("status");
    });
  });

  // SPEC-057 CA-23: the scroll of the history of each terminal is the teacher's, and the student's copy follows it
  describe("the scroll of the terminals", () => {
    const windowOfTwo = '<div class="janela"><div class="janela-corpo dividida"><div class="term"><div class="term-tela"></div></div><div class="term"><div class="term-tela"></div></div></div></div>';

    async function mountTeacher(props: Partial<Parameters<typeof MirroredModuleView>[0]> = {}) {
      vi.mocked(mountTerminalWindow).mockImplementationOnce(async (container, _snapshot, cb) => {
        callbacks = cb;
        container.innerHTML = windowOfTwo;
        return fakeWindow() as never;
      });
      const view = render(<MirroredModuleView role="teacher" terminal={empty} {...props} />);
      await waitFor(() => expect(windows).toHaveLength(1));
      await act(async () => {});
      const telas = [...view.container.querySelectorAll<HTMLElement>(".term-tela")];
      return { view, telas };
    }
    /** Scrolls a screen of the terminal as the teacher would, with the sizes the browser would compute. */
    function scroll(tela: HTMLElement, top: number, content = 1000, view = 400) {
      Object.defineProperty(tela, "scrollHeight", { configurable: true, value: content });
      Object.defineProperty(tela, "clientHeight", { configurable: true, value: view });
      tela.scrollTop = top;
      // A scroll does not bubble, which is why the window listens at the capture.
      tela.dispatchEvent(new Event("scroll"));
    }

    it("tells the number of the terminal and the place, as a fraction of what can be scrolled, when the teacher scrolls it", async () => {
      const onTerminalScroll = vi.fn();
      const { telas } = await mountTeacher({ onTerminalScroll });
      scroll(telas[1]!, 300);
      expect(onTerminalScroll).toHaveBeenLastCalledWith(2, 0.5);
      scroll(telas[0]!, 150);
      expect(onTerminalScroll).toHaveBeenLastCalledWith(1, 0.25);
    });

    it("tells that the teacher is at the end when he is, and when there is nothing to scroll", async () => {
      const onTerminalScroll = vi.fn();
      const { telas } = await mountTeacher({ onTerminalScroll });
      scroll(telas[0]!, 600);
      expect(onTerminalScroll).toHaveBeenLastCalledWith(1, 1);
      scroll(telas[1]!, 0, 300, 400);
      expect(onTerminalScroll).toHaveBeenLastCalledWith(2, 1);
    });

    it("tells a place that is a little past the end as the end", async () => {
      const onTerminalScroll = vi.fn();
      const { telas } = await mountTeacher({ onTerminalScroll });
      scroll(telas[0]!, 640);
      expect(onTerminalScroll).toHaveBeenLastCalledWith(1, 1);
    });

    it("tells nothing about what scrolls and is not a screen of a terminal", async () => {
      const onTerminalScroll = vi.fn();
      const { view } = await mountTeacher({ onTerminalScroll });
      view.container.querySelector(".janela-corpo")!.dispatchEvent(new Event("scroll"));
      expect(onTerminalScroll).not.toHaveBeenCalled();
    });

    it("tells the place to the latest handler, and works with no handler", async () => {
      const first = vi.fn();
      const second = vi.fn();
      const { view, telas } = await mountTeacher({ onTerminalScroll: first });
      view.rerender(<MirroredModuleView role="teacher" terminal={empty} onTerminalScroll={second} />);
      scroll(telas[0]!, 300);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(1, 0.5);
      view.rerender(<MirroredModuleView role="teacher" terminal={empty} />);
      expect(() => scroll(telas[0]!, 100)).not.toThrow();
    });

    it("stops listening when the window goes away", async () => {
      const onTerminalScroll = vi.fn();
      const { view, telas } = await mountTeacher({ onTerminalScroll });
      const [tela] = telas;
      view.unmount();
      scroll(tela!, 300);
      expect(onTerminalScroll).not.toHaveBeenCalled();
    });

    it("puts each terminal of the student's copy where the teacher has it", () => {
      const tela = (text: string) => ({ tag: "div", attrs: { class: "term visivel" }, children: [{ tag: "div", attrs: { class: "term-tela" }, children: [text] }] });
      const picture: ScreenElement = { tag: "div", attrs: { class: "janela" }, children: [{ tag: "div", attrs: { class: "janela-corpo" }, children: [tela("um"), tela("dois")] }] };
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1000);
      vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(400);
      try {
        render(<MirroredModuleView role="student" terminal={{ screen: picture }} terminalScroll={{ "2": 0.5 }} />);
        const tops = [...screen.getByTestId("terminal-mirror").querySelectorAll<HTMLElement>(".term-tela")].map((el) => el.scrollTop);
        expect(tops).toEqual([1000, 300]);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
