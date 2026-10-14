import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { LiveClassroom } from "./LiveClassroom";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const liveClassroomStyles = styleOf("./LiveClassroom.module.scss");
const liveClassPanelStyles = styleOf("../LiveClassPanel/LiveClassPanel.module.scss");
const drawerStyles = styleOf("../LiveInteractionDrawer/LiveInteractionDrawer.module.scss");
const mirroredStyles = styleOf("../MirroredModuleView/MirroredModuleView.module.scss");
const slideStyles = styleOf("../SlidePresenter/SlidePresenter.module.scss");
const notesStyles = styleOf("../StudentNotesPanel/StudentNotesPanel.module.scss");

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  type P = {
    slide: number;
    canControl: boolean;
    strokes: unknown[];
    scroll?: number;
    scrollX?: number;
    bare?: boolean;
    onSlide(n: number): void;
    onCursor(x: number, y: number, laser: boolean): void;
    onDraw(path: Array<[number, number]>): void;
    onClear(): void;
  };
  return {
    SlidePresenter: (p: P) =>
      React.createElement(
        "div",
        { "data-testid": "slides", "data-slide": p.slide, "data-control": String(p.canControl), "data-strokes": p.strokes.length, "data-scroll": String(p.scroll), "data-scroll-x": String(p.scrollX), "data-bare": String(p.bare) },
        React.createElement("button", { onClick: () => p.onSlide(4) }, "mock-go-4"),
        React.createElement("button", { onClick: () => p.onCursor(1, 2, true) }, "mock-cursor"),
        React.createElement("button", { onClick: () => p.onDraw([[1, 1], [2, 2]]) }, "mock-draw"),
        React.createElement("button", { onClick: () => p.onClear() }, "mock-clear"),
      ),
  };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  type P = {
    role: string;
    moduleFocusBlockId: string | null;
    cursor?: { x: number; y: number } | null;
    stageView?: { materialScroll: number; split: number | null; selection?: unknown };
    onFocusBlock?: (id: string) => void;
    onScreen?: (e: unknown) => void;
    onCursor?: unknown;
    onMaterialScroll?: unknown;
    onSplit?: unknown;
  };
  return {
    ModuleStage: (p: P) =>
      React.createElement("div", {
        "data-testid": "module",
        "data-role": p.role,
        "data-focus": p.moduleFocusBlockId ?? "",
        "data-can-send": String(Boolean(p.onScreen || p.onFocusBlock)),
        "data-can-move": String(Boolean(p.onCursor || p.onMaterialScroll || p.onSplit)),
        "data-cursor": p.cursor ? `${p.cursor.x},${p.cursor.y}` : "",
        "data-material-scroll": String(p.stageView?.materialScroll),
        "data-split": String(p.stageView?.split),
        "data-selection": JSON.stringify(p.stageView?.selection ?? null),
        "data-terminal-scroll": JSON.stringify((p.stageView as { terminalScroll?: unknown } | undefined)?.terminalScroll ?? null),
      }),
  };
});
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }, React.createElement("textarea", { "aria-label": "caderno" })) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: new Date(Date.now() - 65 * 60_000).toISOString() };

const actions = () => ({
  changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), raiseHand: vi.fn(), lowerHand: vi.fn(), requestEntry: vi.fn(),
});

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, blank: false, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 },
    admission: "ADMITTED",
    terminal: { screen: null },
    stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {} },
    hands: [],
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

beforeEach(() => {
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-051 CA-12 and CA-13: the room of the student; the teacher has the panel and the presentation window (SPEC-055)
describe("LiveClassroom", () => {
  it("gives the student the bar with the title, the time, who is connected and the mode", () => {
    live({ canControl: false });
    render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.getByRole("heading", { name: "Permissões" })).toBeDefined();
    expect(screen.getByRole("timer", { name: "Tempo de aula" }).textContent).toMatch(/^1:0[5-6]:\d\d$/);
    expect(screen.getByText("Conectados: 5")).toBeDefined();
    expect(screen.getByText("Lâminas")).toBeDefined();
  });

  it("shows the module in the study-screen style, read only, with the block in focus, and sends nothing", () => {
    live({ canControl: false, room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: "b-2", blank: false, deck: null, strokes: [], cursor: null, online: 2 } });
    render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    const stage = screen.getByTestId("module");
    expect(stage.getAttribute("data-role")).toBe("student");
    expect(stage.getAttribute("data-focus")).toBe("b-2");
    expect(stage.getAttribute("data-can-send")).toBe("false");
    expect(screen.getByText("Módulo de Ensino")).toBeDefined();
    expect(screen.queryByTestId("slides")).toBeNull();
  });

  // SPEC-055 CA-17: the blank screen
  it("covers the stage with an empty screen while the teacher keeps it blank", () => {
    live({ canControl: false, room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, blank: true, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 } });
    const view = render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.getByRole("status", { name: "Tela preta" })).toBeDefined();
    live({ canControl: false });
    view.rerender(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.queryByRole("status", { name: "Tela preta" })).toBeNull();
    expect(screen.getByTestId("slides")).toBeDefined();
  });

  it("says when the class has no presentation", () => {
    live({ canControl: false, room: { mode: "SLIDES", slide: 1, moduleId: null, moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 1 } });
    render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.getByText("Esta aula não tem apresentação.")).toBeDefined();
  });

  it("gives a student only the leave button, no control, and the hands and notes", () => {
    live({ canControl: false });
    render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.getByRole("button", { name: "Sair da sala" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Encerrar aula" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByTestId("slides").getAttribute("data-control")).toBe("false");
    expect(screen.getByRole("button", { name: "Levantar a mão" })).toBeDefined();
    expect(screen.queryByTestId("notes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anotações" }));
    expect(screen.getByTestId("notes")).toBeDefined();
  });

  it("lets a student leave, which only goes back to the class", () => {
    live({ canControl: false });
    const end = vi.spyOn(classroomService, "endSession");
    render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Sair da sala" }));
    expect(push).toHaveBeenCalledWith("/app/classes/c-1");
    expect(end).not.toHaveBeenCalled();
  });

  it("tells everybody when the class ended", () => {
    live({ ended: true });
    render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.getByText("A aula foi encerrada.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a turma" }).getAttribute("href")).toBe("/app/classes/c-1");
    expect(screen.queryByTestId("slides")).toBeNull();
  });

  it("tells when it is connecting or when the connection was lost", () => {
    live({ ready: false, connected: false });
    const view = render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.getByRole("status").textContent).toBe("Conectando à sala…");
    live({ ready: true, connected: false });
    view.rerender(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
    expect(screen.getByRole("status").textContent).toBe("Conexão perdida. Tentando de novo…");
  });

  // SPEC-054 CA-01, CA-03: the student waits for the teacher
  describe("waiting room of the student", () => {
    it("shows only the wait, and no stage, hands nor notes, until the teacher accepts", () => {
      live({ canControl: false, ready: false, admission: "WAITING" });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      expect(screen.getByText(/Aguardando o professor aceitar a sua entrada/)).toBeDefined();
      expect(screen.queryByTestId("slides")).toBeNull();
      expect(screen.queryByTestId("module")).toBeNull();
      expect(screen.queryByTestId("notes")).toBeNull();
      expect(screen.queryByRole("button", { name: "Levantar a mão" })).toBeNull();
      expect(screen.getByRole("button", { name: "Sair da sala" })).toBeDefined();
    });

    it("shows the class as soon as the student is accepted, without reloading", () => {
      live({ canControl: false, ready: false, admission: "WAITING" });
      const view = render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      expect(screen.queryByTestId("slides")).toBeNull();
      live({ canControl: false, ready: true, admission: "ADMITTED" });
      view.rerender(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      expect(screen.getByTestId("slides")).toBeDefined();
      expect(screen.queryByText(/Aguardando o professor/)).toBeNull();
    });

    it("tells the student who was removed, and lets him ask again", () => {
      const l = live({ canControl: false, ready: false, admission: "REMOVED" });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      expect(screen.getByText("O professor retirou você da aula")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Pedir para entrar de novo" }));
      expect(l.requestEntry).toHaveBeenCalledTimes(1);
    });
  });

  // SPEC-057 CA-01, CA-07, CA-10: the stage of the student is the stage of the teacher, only smaller or bigger, and he moves nothing
  describe("the fixed stage", () => {
    it("draws the slides inside the fixed stage, and the bar and the notes outside of it", () => {
      live({ canControl: false });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      fireEvent.click(screen.getByRole("button", { name: "Anotações" }));
      const stage = screen.getByTestId("fixed-stage");
      expect(stage.contains(screen.getByTestId("slides"))).toBe(true);
      expect(stage.contains(screen.getByRole("heading", { name: "Permissões" }))).toBe(false);
      expect(stage.contains(screen.getByTestId("notes"))).toBe(false);
    });

    it("draws the module inside the stage too, and the blank screen over it", () => {
      live({ canControl: false, room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: true, deck: null, strokes: [], cursor: null, online: 2 } });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      const stage = screen.getByTestId("fixed-stage");
      expect(stage.contains(screen.getByTestId("module"))).toBe(true);
      expect(stage.contains(screen.getByRole("status", { name: "Tela preta" }))).toBe(true);
    });

    it("tells where the slide is in the bar, because the stage has no bar of its own", () => {
      live({ canControl: false });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      expect(screen.getByTestId("slides").getAttribute("data-bare")).toBe("true");
      expect(screen.getByText("Lâmina 2 de 5")).toBeDefined();
      expect(screen.getByTestId("fixed-stage").contains(screen.getByText("Lâmina 2 de 5"))).toBe(false);
    });

    it("gives the slides the scroll of the teacher", () => {
      live({ canControl: false, stageView: { slideScroll: 0.4, slideScrollX: 0.3, materialScroll: 0.9, split: 0.5, zoom: 1, selection: null, terminalScroll: {} } });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      expect(screen.getByTestId("slides").getAttribute("data-scroll")).toBe("0.4");
      expect(screen.getByTestId("slides").getAttribute("data-scroll-x")).toBe("0.3");
    });

    it("gives the module the scroll of the material, the divider and the pointer of the teacher, and nothing to send", () => {
      live({
        canControl: false,
        stageView: { slideScroll: 0.4, slideScrollX: 0, materialScroll: 0.9, split: 0.5, zoom: 1, selection: null, terminalScroll: {} },
        room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: { x: 30, y: 40, laser: true, visible: true }, online: 2 },
      });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      const module_ = screen.getByTestId("module");
      expect(module_.getAttribute("data-material-scroll")).toBe("0.9");
      expect(module_.getAttribute("data-split")).toBe("0.5");
      expect(module_.getAttribute("data-cursor")).toBe("30,40");
      expect(module_.getAttribute("data-can-move")).toBe("false");
    });
  });


  // SPEC-057 CA-13: the stage takes the whole window but a strip of controls at the bottom, as in a video call, and nothing is over the stage
  describe("the stage and the strip of controls", () => {
    const strip = () => screen.getByRole("toolbar", { name: "Controles da aula" });
    const stageBox = () => screen.getByTestId("fixed-stage").parentElement!;
    const rule = (css: string, name: string) => css.slice(css.indexOf(`.${name} {`), css.indexOf("}", css.indexOf(`.${name} {`)));
    const room = () => render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);

    beforeEach(() => {
      Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
    });
    afterEach(() => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    });

    it("has no header and no margin: the room is the window, and the stage and the strip are all that is in it", () => {
      live({ canControl: false });
      const view = room();
      expect(view.container.querySelector("header")).toBeNull();
      const main = screen.getByRole("main");
      expect([...main.children].map((child) => child.getAttribute("role") ?? child.tagName.toLowerCase())).toEqual(["div", "toolbar"]);
      expect(rule(liveClassroomStyles, "live")).toMatch(/position:\s*fixed/);
      expect(rule(liveClassroomStyles, "live")).toMatch(/inset:\s*0/);
      expect(rule(liveClassroomStyles, "live")).not.toMatch(/padding|max-width/);
    });

    it("gives the stage all the room the strip leaves, and keeps the strip in the flow, under the stage, so it never covers it", () => {
      expect(rule(liveClassroomStyles, "body")).toMatch(/flex:\s*1/);
      expect(rule(liveClassroomStyles, "body")).toMatch(/min-height:\s*0/);
      expect(rule(liveClassroomStyles, "controls")).toMatch(/flex:\s*none/);
      expect(rule(liveClassroomStyles, "controls")).not.toMatch(/position:\s*(absolute|fixed)/);
      expect(rule(liveClassroomStyles, "controls")).toMatch(/min-height:\s*3\.5rem/);
    });

    it("has the title, the time and who is connected on the left of the strip", () => {
      live({ canControl: false });
      room();
      const bar = within(strip());
      expect(bar.getByRole("heading", { name: "Permissões" })).toBeDefined();
      expect(bar.getByRole("timer", { name: "Tempo de aula" }).textContent).toMatch(/^1:0[5-6]:\d\d$/);
      expect(bar.getByText("Conectados: 5")).toBeDefined();
    });

    it("has the hand, the notes and the full screen in the middle, and the way out on the right", () => {
      live({ canControl: false });
      room();
      expect(within(strip()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Levantar a mão", "Anotações", "Tela cheia", "Sair da sala"]);
    });

    it("has the strip after the stage, and nothing of it inside the stage", () => {
      live({ canControl: false });
      room();
      expect(screen.getByTestId("fixed-stage").contains(strip())).toBe(false);
      expect(stageBox().compareDocumentPosition(strip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    describe("the hand", () => {
      it("lets the student raise it from the strip", () => {
        const l = live({ canControl: false });
        room();
        const button = within(strip()).getByRole("button", { name: "Levantar a mão" });
        expect(button.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(button);
        expect(l.raiseHand).toHaveBeenCalledTimes(1);
      });

      it("shows in the strip that the hand is up, with the place in the line, and lets him lower it", () => {
        const l = live({ canControl: false, hands: [{ studentId: "u-9", name: "Ana", requestedAt: "x" }, { studentId: "u-1", name: "Bia", requestedAt: "y" }] });
        room();
        const bar = within(strip());
        expect(bar.getByText("Sua mão está levantada.")).toBeDefined();
        expect(bar.getByText("2º na fila")).toBeDefined();
        expect(bar.queryByRole("button", { name: "Levantar a mão" })).toBeNull();
        const lower = bar.getByRole("button", { name: "Abaixar a mão" });
        expect(lower.getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(lower);
        expect(l.lowerHand).toHaveBeenCalledTimes(1);
      });

      it("has no menu over the stage for the hand", () => {
        live({ canControl: false });
        room();
        expect(screen.getByTestId("fixed-stage").querySelector("[role='menu'], [role='dialog'], [role='listbox']")).toBeNull();
        expect(screen.queryByRole("menu")).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });

    describe("the notes", () => {
      it("are closed at first, and the stage has the whole window", () => {
        live({ canControl: false });
        room();
        const toggle = within(strip()).getByRole("button", { name: "Anotações" });
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByTestId("notes")).toBeNull();
        expect(screen.queryByRole("complementary")).toBeNull();
      });

      it("open in a column beside the stage, not over it, and close again", () => {
        live({ canControl: false });
        room();
        const toggle = within(strip()).getByRole("button", { name: "Anotações" });
        fireEvent.click(toggle);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        const column = screen.getByRole("complementary", { name: "Anotações da aula" });
        expect(column.contains(screen.getByTestId("notes"))).toBe(true);
        expect(column.parentElement).toBe(stageBox().parentElement);
        expect(screen.getByTestId("fixed-stage").contains(column)).toBe(false);
        expect(stageBox().contains(column)).toBe(false);
        fireEvent.click(toggle);
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByTestId("notes")).toBeNull();
      });

      it("share the window with the stage in a row, 320 px wide, so the stage is fit to what is left", () => {
        expect(rule(liveClassroomStyles, "body")).toMatch(/display:\s*flex/);
        expect(rule(liveClassroomStyles, "side")).toMatch(/width:\s*20rem|flex:\s*0 0 20rem/);
        expect(rule(liveClassroomStyles, "stage")).toMatch(/flex:\s*1/);
        expect(rule(liveClassroomStyles, "stage")).toMatch(/min-width:\s*0/);
        expect(rule(liveClassroomStyles, "side")).not.toMatch(/position:\s*(absolute|fixed)/);
      });

      it("do not load the stage again when they open and close", () => {
        live({ canControl: false });
        room();
        const before = screen.getByTestId("fixed-stage");
        const slides = screen.getByTestId("slides");
        const toggle = within(strip()).getByRole("button", { name: "Anotações" });
        fireEvent.click(toggle);
        expect(screen.getByTestId("fixed-stage")).toBe(before);
        expect(screen.getByTestId("slides")).toBe(slides);
        fireEvent.click(toggle);
        expect(screen.getByTestId("fixed-stage")).toBe(before);
      });
    });

    // The scale is the biggest that fits, which is the job of FixedStage; the window asks it to take the whole stage box to full screen
    describe("the full screen", () => {
      it("asks the browser for the full screen of the stage, with a button and the key F", () => {
        live({ canControl: false });
        room();
        const button = within(strip()).getByRole("button", { name: "Tela cheia" });
        expect(button.getAttribute("title")).toBe("Tela cheia (F)");
        fireEvent.click(button);
        expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
        expect(vi.mocked(Element.prototype.requestFullscreen).mock.contexts[0]).toBe(stageBox());
        fireEvent.keyDown(document.body, { key: "f" });
        expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(document.body, { key: "F" });
        expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(3);
      });

      it("leaves the full screen with the same button or key when it is on", () => {
        live({ canControl: false });
        room();
        Object.defineProperty(document, "fullscreenElement", { configurable: true, value: stageBox() });
        fireEvent.keyDown(document.body, { key: "f" });
        expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
        fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
        expect(document.exitFullscreen).toHaveBeenCalledTimes(2);
        expect(Element.prototype.requestFullscreen).not.toHaveBeenCalled();
      });

      it("leaves the key F to the notes while the student writes, and to the browser with Ctrl, Alt or Meta", () => {
        live({ canControl: false });
        room();
        fireEvent.click(within(strip()).getByRole("button", { name: "Anotações" }));
        fireEvent.keyDown(screen.getByLabelText("caderno"), { key: "f" });
        fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
        fireEvent.keyDown(document.body, { key: "f", altKey: true });
        fireEvent.keyDown(document.body, { key: "f", metaKey: true });
        expect(Element.prototype.requestFullscreen).not.toHaveBeenCalled();
      });

      it("does not keep listening to the key when the room goes away", () => {
        live({ canControl: false });
        const view = room();
        view.unmount();
        fireEvent.keyDown(document.body, { key: "f" });
        expect(Element.prototype.requestFullscreen).not.toHaveBeenCalled();
      });

      it("does not break in a browser that has no full screen", () => {
        live({ canControl: false });
        room();
        Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, writable: true, value: undefined });
        expect(() => fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }))).not.toThrow();
      });
    });

    describe("what is over the stage", () => {
      it("is only the stage itself: the blank screen, and the connecting, which takes the place of the content", () => {
        live({ canControl: false, ready: false, connected: false });
        room();
        const stage = screen.getByTestId("fixed-stage");
        expect(stage.contains(screen.getByRole("status"))).toBe(true);
        expect(screen.getByRole("status").textContent).toBe("Conectando à sala…");
        // It is the whole of what the stage has, in the place of the slides.
        expect(stage.querySelector("[data-testid='slides'], [data-testid='module']")).toBeNull();
      });

      // CA-22: what is only the student's does not go inside the stage, where the teacher has nothing of the kind
      it("tells the loss of the connection in the strip, and leaves the stage as the teacher's", () => {
        live({ canControl: false, ready: true, connected: false });
        room();
        expect(within(strip()).getByRole("status").textContent).toBe("Conexão perdida. Tentando de novo…");
        expect(screen.getByTestId("fixed-stage").querySelector("[role='status']")).toBeNull();
        expect(screen.getByTestId("slides")).toBeDefined();
      });

      it("does not tell the loss of the connection while it is connected", () => {
        live({ canControl: false });
        room();
        expect(screen.queryByRole("status")).toBeNull();
      });

      it("shows no slides while the room is connecting, and shows them when the first state comes", () => {
        live({ canControl: false, ready: false, connected: false });
        const view = room();
        expect(screen.queryByTestId("slides")).toBeNull();
        expect(screen.queryByText("Esta aula não tem apresentação.")).toBeNull();
        live({ canControl: false, ready: true, connected: true });
        view.rerender(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
        expect(screen.getByTestId("slides")).toBeDefined();
      });

      it("has nothing positioned over the stage in the style of the room", () => {
        for (const name of ["body", "stage", "side", "controls"]) expect(rule(liveClassroomStyles, name)).not.toMatch(/position:\s*absolute|z-index/);
      });
    });

    // CA-15, CA-18: the student follows the zoom, and has no control of it
    describe("the zoom of the teacher", () => {
      it("draws the stage smaller by the zoom of the teacher, in the same box", () => {
        live({ canControl: false, stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 2, selection: null, terminalScroll: {} } });
        room();
        expect(screen.getByTestId("stage-box").style.width).toBe("640px");
        expect(screen.getByTestId("stage-box").style.height).toBe("360px");
      });

      it("has no button of zoom, and no key of zoom", () => {
        live({ canControl: false, stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1.5, selection: null, terminalScroll: {} } });
        room();
        expect(screen.queryByRole("button", { name: /Aumentar|Diminuir|\d+%/ })).toBeNull();
        for (const key of ["+", "-", "0"]) fireEvent.keyDown(document.body, { key });
        expect(screen.getByTestId("stage-box").style.width).toBe(`${1280 / 1.5}px`);
      });
    });

    // CA-23: where the teacher has each terminal reaches the module of the student
    it("gives the module the places of the terminals of the teacher", () => {
      live({
        canControl: false,
        stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: { "1": 0.25, "2": 1 } },
        room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 2 },
      });
      room();
      expect(JSON.parse(screen.getByTestId("module").getAttribute("data-terminal-scroll")!)).toEqual({ "1": 0.25, "2": 1 });
    });

    // CA-20, CA-21: the stretch of text of the teacher reaches the module
    it("gives the module the selection of the teacher to mark", () => {
      const picked = { pane: "material", start: { block: "b-1", offset: 1 }, end: { block: "b-1", offset: 4 } };
      live({
        canControl: false,
        stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: picked, terminalScroll: {} },
        room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 2 },
      });
      room();
      expect(JSON.parse(screen.getByTestId("module").getAttribute("data-selection")!)).toEqual(picked);
    });
  });

  // CA-13: only the tokens, never a color written in the style
  it.each([
    ["FixedStage", styleOf("../FixedStage/FixedStage.module.scss")],
    ["LiveClassroom", liveClassroomStyles],
    ["SlidePresenter", slideStyles],
    ["MirroredModuleView", mirroredStyles],
    ["TerminalMirror", styleOf("../TerminalMirror/TerminalMirror.module.scss")],
    ["LiveInteractionDrawer", drawerStyles],
    ["StudentNotesPanel", notesStyles],
    ["LiveClassPanel", liveClassPanelStyles],
    ["WaitingRoom", styleOf("../WaitingRoom/WaitingRoom.module.scss")],
    ["AdmissionPanel", styleOf("../AdmissionPanel/AdmissionPanel.module.scss")],
    ["ModuleStage", styleOf("../ModuleStage/ModuleStage.module.scss")],
    ["TeacherPanel", styleOf("../TeacherPanel/TeacherPanel.module.scss")],
    ["PresenterStage", styleOf("../PresenterStage/PresenterStage.module.scss")],
    ["SlideThumbnails", styleOf("../SlideThumbnails/SlideThumbnails.module.scss")],
  ])("%s uses only the color tokens", (_name, css) => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});
