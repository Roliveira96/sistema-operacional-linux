import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
        { "data-testid": "slides", "data-slide": p.slide, "data-control": String(p.canControl), "data-strokes": p.strokes.length, "data-scroll": String(p.scroll), "data-bare": String(p.bare) },
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
    stageView?: { materialScroll: number; split: number | null };
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
      }),
  };
});
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }) };
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
    stageView: { slideScroll: 0, materialScroll: 0, split: null },
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
    it("draws the slides inside the stage of 1920 x 1080, and the bar and the notes outside of it", () => {
      live({ canControl: false });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
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
      live({ canControl: false, stageView: { slideScroll: 0.4, materialScroll: 0.9, split: 0.5 } });
      render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
      expect(screen.getByTestId("slides").getAttribute("data-scroll")).toBe("0.4");
    });

    it("gives the module the scroll of the material, the divider and the pointer of the teacher, and nothing to send", () => {
      live({
        canControl: false,
        stageView: { slideScroll: 0.4, materialScroll: 0.9, split: 0.5 },
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
