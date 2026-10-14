import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import type { LiveSession } from "@/services/classroomService";
import { PresenterStage } from "./PresenterStage";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = styleOf("./PresenterStage.module.scss");

vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
const slides = vi.fn();
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  type P = { slide: number; canControl: boolean; bare?: boolean; laser?: boolean; pen?: boolean; onSlide(n: number): void; onCursor(x: number, y: number, l: boolean): void; onDraw(p: Array<[number, number]>): void };
  return {
    SlidePresenter: (p: P) => {
      slides(p);
      return React.createElement(
        "div",
        { "data-testid": "slides", "data-slide": p.slide, "data-bare": String(p.bare), "data-laser": String(p.laser), "data-pen": String(p.pen) },
        React.createElement("button", { onClick: () => p.onCursor(1, 2, true) }, "mock-cursor"),
        React.createElement("button", { onClick: () => p.onDraw([[1, 1], [2, 2]]) }, "mock-draw"),
      );
    },
  };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  type P = { role: string; moduleFocusBlockId: string | null; onFocusBlock?: (id: string) => void; onScreen?: (tree: unknown) => void };
  return {
    ModuleStage: (p: P) =>
      React.createElement(
        "div",
        { "data-testid": "module", "data-role": p.role, "data-focus": p.moduleFocusBlockId ?? "" },
        React.createElement("button", { onClick: () => p.onScreen?.({ tag: "div", attrs: { class: "janela" } }) }, "mock-screen"),
        React.createElement("button", { onClick: () => p.onFocusBlock?.("b-9") }, "mock-read"),
      ),
  };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "x" };
const deck = { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" };

const actions = () => ({
  changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), switchMode: vi.fn(), sendTerminalScreen: vi.fn(),
  focusBlock: vi.fn(), setBlank: vi.fn(),
});

function live(over: Record<string, unknown> = {}, room: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: "m-1", moduleFocusBlockId: null, deck, strokes: [], cursor: null, online: 5, blank: false, ...room },
    terminal: { screen: null },
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    ...actions(),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value as ReturnType<typeof actions> & typeof value;
}

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key: k, ...init });

beforeEach(() => {
  localStorage.clear();
  slides.mockClear();
  vi.useFakeTimers();
  document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-055 CA-04, CA-05
describe("PresenterStage", () => {
  it("connects as the presenter window of the teacher", () => {
    live();
    render(<PresenterStage classId="c-1" session={session} />);
    expect(vi.mocked(useLiveClassroom).mock.calls[0]![0]).toMatchObject({ classId: "c-1", role: "teacher", view: "presenter" });
  });

  it("shows only the stage, with no menus nor administrative data", () => {
    live();
    render(<PresenterStage classId="c-1" session={session} />);
    expect(screen.getByTestId("slides").getAttribute("data-bare")).toBe("true");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText(/Conectados/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Encerrar aula" })).toBeNull();
    expect(screen.queryByText(/Sala de espera/)).toBeNull();
  });

  it("sends the laser and the pen straight to the class, without any switch", () => {
    const l = live();
    render(<PresenterStage classId="c-1" session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "mock-cursor" }));
    fireEvent.click(screen.getByRole("button", { name: "mock-draw" }));
    expect(l.moveCursor).toHaveBeenCalledWith(1, 2, true);
    expect(l.draw).toHaveBeenCalledTimes(1);
  });

  it("shows the module, in the study-screen style, with the screen of the terminal of the teacher going to the class at once", () => {
    const l = live({}, { mode: "MODULE", moduleFocusBlockId: "b-2" });
    render(<PresenterStage classId="c-1" session={session} />);
    const module_ = screen.getByTestId("module");
    expect(module_.getAttribute("data-role")).toBe("teacher");
    expect(module_.getAttribute("data-focus")).toBe("b-2");
    fireEvent.click(screen.getByRole("button", { name: "mock-screen" }));
    fireEvent.click(screen.getByRole("button", { name: "mock-read" }));
    expect(l.sendTerminalScreen).toHaveBeenCalledWith({ tag: "div", attrs: { class: "janela" } });
    expect(l.focusBlock).toHaveBeenCalledWith("b-9");
  });

  it("says when the class has no presentation, and tells how the connection is", () => {
    live({ connected: false }, { deck: null });
    render(<PresenterStage classId="c-1" session={session} />);
    expect(screen.getByText("Esta aula não tem apresentação.")).toBeDefined();
    expect(screen.getByRole("status", { name: "Conexão" }).textContent).toBe("Conexão perdida. Tentando de novo…");
  });

  it("has an indicator that is silent while the connection is good", () => {
    live();
    render(<PresenterStage classId="c-1" session={session} />);
    expect(screen.queryByRole("status", { name: "Conexão" })).toBeNull();
  });

  it("goes quiet when the class ends, or when another presentation window took the place", () => {
    live({ ended: true });
    const view = render(<PresenterStage classId="c-1" session={session} />);
    expect(screen.getByText("A aula foi encerrada.")).toBeDefined();
    live({ passive: true, canControl: false });
    view.rerender(<PresenterStage classId="c-1" session={session} />);
    expect(screen.getByText("Outra janela de apresentação assumiu. Esta só acompanha.")).toBeDefined();
  });

  // CA-16: the toolbar that shows and goes away
  describe("the toolbar", () => {
    it("shows when the mouse moves and goes away by itself", () => {
      live();
      render(<PresenterStage classId="c-1" session={session} />);
      act(() => void vi.advanceTimersByTime(4000));
      expect(screen.queryByRole("toolbar")).toBeNull();
      fireEvent.mouseMove(screen.getByTestId("presenter-stage"));
      expect(screen.getByRole("toolbar", { name: "Ferramentas da apresentação" })).toBeDefined();
      act(() => void vi.advanceTimersByTime(2000));
      expect(screen.getByRole("toolbar")).toBeDefined();
      act(() => void vi.advanceTimersByTime(2000));
      expect(screen.queryByRole("toolbar")).toBeNull();
    });

    it("has previous and next, laser, pen, clear, switch of the stage, full screen, blank screen and the list of shortcuts, each with its key", () => {
      const l = live();
      render(<PresenterStage classId="c-1" session={session} />);
      const bar = within(screen.getByRole("toolbar"));
      fireEvent.click(bar.getByRole("button", { name: "Próxima lâmina" }));
      expect(l.changeSlide).toHaveBeenLastCalledWith(3);
      fireEvent.click(bar.getByRole("button", { name: "Lâmina anterior" }));
      expect(l.changeSlide).toHaveBeenLastCalledWith(1);
      expect(bar.getByRole("button", { name: "Laser" }).getAttribute("title")).toBe("Laser (L)");
      expect(bar.getByRole("button", { name: "Caneta" }).getAttribute("title")).toBe("Caneta (P)");
      fireEvent.click(bar.getByRole("button", { name: "Apagar traços" }));
      expect(l.clearDrawings).toHaveBeenCalledTimes(1);
      fireEvent.click(bar.getByRole("button", { name: "Módulo" }));
      expect(l.switchMode).toHaveBeenLastCalledWith("MODULE", "m-1");
      fireEvent.click(bar.getByRole("button", { name: "Tela preta" }));
      expect(l.setBlank).toHaveBeenLastCalledWith(true);
      fireEvent.click(bar.getByRole("button", { name: "Tela cheia" }));
      expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
      fireEvent.click(bar.getByRole("button", { name: "Atalhos" }));
      expect(screen.getByRole("dialog", { name: "Atalhos do teclado" })).toBeDefined();
    });

    it("turns the laser and the pen on and off from the toolbar", () => {
      live();
      render(<PresenterStage classId="c-1" session={session} />);
      const laser = () => screen.getByRole("button", { name: "Laser" });
      expect(laser().getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(laser());
      expect(laser().getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("slides").getAttribute("data-laser")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Caneta" }));
      expect(screen.getByTestId("slides").getAttribute("data-pen")).toBe("true");
    });

    it("offers the way back to the slides while on the module, when the class has a presentation", () => {
      const l = live({}, { mode: "MODULE" });
      render(<PresenterStage classId="c-1" session={session} />);
      fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Lâminas" }));
      expect(l.switchMode).toHaveBeenLastCalledWith("SLIDES");
    });

    it("tells, instead of switching, when there is nothing to switch to", () => {
      const l = live({}, { moduleId: null });
      render(<PresenterStage classId="c-1" session={session} />);
      fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Módulo" }));
      expect(l.switchMode).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toBe("Esta aula não tem módulo. Escolha um no painel.");
    });
  });

  // CA-04 and CA-16: the keyboard
  describe("the shortcuts", () => {
    it("changes the slide with the arrows and the space bar", () => {
      const l = live();
      render(<PresenterStage classId="c-1" session={session} />);
      key("ArrowRight");
      expect(l.changeSlide).toHaveBeenLastCalledWith(3);
      key(" ");
      expect(l.changeSlide).toHaveBeenLastCalledWith(3);
      key("ArrowLeft");
      expect(l.changeSlide).toHaveBeenLastCalledWith(1);
    });

    it("does not go beyond the first and the last slide", () => {
      const l = live({}, { slide: 5 });
      const view = render(<PresenterStage classId="c-1" session={session} />);
      key("ArrowRight");
      expect(l.changeSlide).not.toHaveBeenCalled();
      const first = live({}, { slide: 1 });
      view.rerender(<PresenterStage classId="c-1" session={session} />);
      key("ArrowLeft");
      expect(first.changeSlide).not.toHaveBeenCalled();
    });

    it("turns the laser on with L, the pen with P, and clears the strokes with C", () => {
      const l = live();
      render(<PresenterStage classId="c-1" session={session} />);
      key("l");
      expect(screen.getByTestId("slides").getAttribute("data-laser")).toBe("true");
      key("L");
      expect(screen.getByTestId("slides").getAttribute("data-laser")).toBe("false");
      key("p");
      expect(screen.getByTestId("slides").getAttribute("data-pen")).toBe("true");
      key("c");
      expect(l.clearDrawings).toHaveBeenCalledTimes(1);
    });

    it("switches between the slides and the module with M, and goes full screen with F", () => {
      const l = live();
      render(<PresenterStage classId="c-1" session={session} />);
      key("m");
      expect(l.switchMode).toHaveBeenLastCalledWith("MODULE", "m-1");
      key("f");
      expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Aperte Esc para sair da tela cheia.")).toBeDefined();
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
      key("f");
      expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    });

    it("shows the list of shortcuts with ? and closes it with Esc", () => {
      live();
      render(<PresenterStage classId="c-1" session={session} />);
      key("?");
      const items = within(screen.getByRole("dialog", { name: "Atalhos do teclado" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent ?? "");
      for (const start of ["Setas e espaço", "L", "P", "C", "M", "F", "B", "?"]) expect(items.some((text) => text.startsWith(start))).toBe(true);
      key("Escape");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("leaves the keys alone while the teacher types in the terminal or in a field", () => {
      const l = live({}, { mode: "MODULE" });
      render(<PresenterStage classId="c-1" session={session} />);
      const term = document.createElement("div");
      term.className = "term";
      const input = document.createElement("input");
      term.appendChild(input);
      document.body.appendChild(term);
      for (const k of ["l", "b", "m", "f", "ArrowRight", "?"]) fireEvent.keyDown(input, { key: k });
      expect(l.switchMode).not.toHaveBeenCalled();
      expect(l.setBlank).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      term.remove();
    });

    it("ignores the keys with Ctrl, Alt or Meta, which belong to the browser", () => {
      const l = live();
      render(<PresenterStage classId="c-1" session={session} />);
      key("b", { ctrlKey: true });
      key("l", { altKey: true });
      key("m", { metaKey: true });
      expect(l.setBlank).not.toHaveBeenCalled();
      expect(l.switchMode).not.toHaveBeenCalled();
    });

    it("does not change slides with the arrows on the module, where they belong to the page", () => {
      const l = live({}, { mode: "MODULE" });
      render(<PresenterStage classId="c-1" session={session} />);
      key("ArrowRight");
      key(" ");
      expect(l.changeSlide).not.toHaveBeenCalled();
    });
  });

  // CA-17: the blank screen
  describe("the blank screen", () => {
    it("turns on and off with B, and with the button", () => {
      const l = live();
      const view = render(<PresenterStage classId="c-1" session={session} />);
      key("b");
      expect(l.setBlank).toHaveBeenLastCalledWith(true);
      live({}, { blank: true });
      view.rerender(<PresenterStage classId="c-1" session={session} />);
      key("B");
      expect(vi.mocked(useLiveClassroom).mock.results.at(-1)!.value.setBlank).toHaveBeenLastCalledWith(false);
    });

    it("covers the stage with black for the teacher too, with a discreet notice of how to come back", () => {
      live({}, { blank: true });
      render(<PresenterStage classId="c-1" session={session} />);
      expect(screen.getByRole("status", { name: "Tela preta" })).toBeDefined();
      expect(screen.getByText("Tela preta ligada. Aperte B para voltar.")).toBeDefined();
    });

    it("shows no cover while the screen is not blank", () => {
      live();
      render(<PresenterStage classId="c-1" session={session} />);
      expect(screen.queryByRole("status", { name: "Tela preta" })).toBeNull();
    });
  });

  // CA-16: the tip of the first time
  describe("the tip of the first time", () => {
    it("shows the main shortcuts the first time in the window, and not again after it is dismissed", () => {
      live();
      const view = render(<PresenterStage classId="c-1" session={session} />);
      const tip = screen.getByRole("note", { name: "Dica de atalhos" });
      expect(tip.textContent).toContain("? mostra todos os atalhos");
      fireEvent.click(within(tip).getByRole("button", { name: "Entendi" }));
      expect(screen.queryByRole("note")).toBeNull();
      view.unmount();
      render(<PresenterStage classId="c-1" session={session} />);
      expect(screen.queryByRole("note")).toBeNull();
    });

    it("does not break when the browser keeps no data", () => {
      live();
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      render(<PresenterStage classId="c-1" session={session} />);
      fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
      expect(screen.queryByRole("note")).toBeNull();
    });
  });

  it("uses only the color tokens", () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});
