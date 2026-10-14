import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
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
    onSlide(n: number): void;
    onCursor(x: number, y: number, laser: boolean): void;
    onDraw(path: Array<[number, number]>): void;
    onClear(): void;
  };
  return {
    SlidePresenter: (p: P) =>
      React.createElement(
        "div",
        { "data-testid": "slides", "data-slide": p.slide, "data-control": String(p.canControl), "data-strokes": p.strokes.length },
        React.createElement("button", { onClick: () => p.onSlide(4) }, "mock-go-4"),
        React.createElement("button", { onClick: () => p.onCursor(1, 2, true) }, "mock-cursor"),
        React.createElement("button", { onClick: () => p.onDraw([[1, 1], [2, 2]]) }, "mock-draw"),
        React.createElement("button", { onClick: () => p.onClear() }, "mock-clear"),
      ),
  };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  type P = { role: string; moduleFocusBlockId: string | null; onFocusBlock?: (id: string) => void; onInput?: (e: unknown) => void; onSync?: (e: unknown) => void };
  return {
    ModuleStage: (p: P) =>
      React.createElement(
        "div",
        { "data-testid": "module", "data-role": p.role, "data-focus": p.moduleFocusBlockId ?? "" },
        React.createElement("button", { onClick: () => p.onInput?.({ terminal: 1, line: "l" }) }, `mock-input-${p.role}`),
        React.createElement("button", { onClick: () => p.onSync?.({ terminal: 1, line: "ls" }) }, `mock-sync-${p.role}`),
        React.createElement("button", { onClick: () => p.onFocusBlock?.("b-9") }, `mock-focus-${p.role}`),
      ),
  };
});
vi.mock("@/services/moduleService", () => ({ moduleService: { listModules: vi.fn() } }));
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: new Date(Date.now() - 65 * 60_000).toISOString() };

const actions = () => ({
  changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), switchMode: vi.fn(), sendTerminalInput: vi.fn(), sendTerminalSync: vi.fn(),
  moderate: vi.fn(), raiseHand: vi.fn(), lowerHand: vi.fn(),
  acceptStudent: vi.fn(), acceptAll: vi.fn(), removeStudent: vi.fn(), focusBlock: vi.fn(), setTerminalBroadcast: vi.fn(), requestEntry: vi.fn(),
});

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, terminalBroadcast: false, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 },
    admission: "ADMITTED",
    admissions: { waiting: [], admitted: [] },
    terminal: { input: null, entries: [], state: null, revision: 0 },
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
  vi.mocked(moduleService.listModules).mockResolvedValue({ items: [{ id: "m-1", title: "Permissões" }, { id: "m-2", title: "Processos" }], total: 2, page: 1, limit: 100 } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-051 CA-12 and CA-13
describe("LiveClassroom", () => {
  it("gives the teacher the bar with the title, the time, who is connected, the mode and the end", () => {
    live();
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    expect(screen.getByRole("heading", { name: "Permissões" })).toBeDefined();
    expect(screen.getByRole("timer", { name: "Tempo de aula" }).textContent).toMatch(/^1:0[5-6]:\d\d$/);
    expect(screen.getByText("Conectados: 5")).toBeDefined();
    expect(screen.getByRole("button", { name: "Encerrar aula" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sair da sala" })).toBeNull();
    const mine = within(screen.getByRole("region", { name: "Minha tela" }));
    expect(mine.getByTestId("slides").getAttribute("data-slide")).toBe("2");
    expect(mine.getByTestId("slides").getAttribute("data-control")).toBe("true");
  });

  // SPEC-054 CA-11: the module is chosen before the class sees it
  it("switches to slides for everybody, and to the module only once one is chosen", async () => {
    const l = live();
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    fireEvent.click(screen.getByRole("radio", { name: "Módulo de Ensino" }));
    expect(l.switchMode).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Escolha um módulo para mostrar à turma.");
    fireEvent.click(screen.getByRole("radio", { name: "Lâminas" }));
    expect(l.switchMode).toHaveBeenCalledWith("SLIDES");
    const picker = await screen.findByRole("combobox", { name: "Módulo da aula" });
    await screen.findByRole("option", { name: "Processos" });
    fireEvent.change(picker, { target: { value: "m-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar o módulo para a turma" }));
    expect(l.switchMode).toHaveBeenLastCalledWith("MODULE", "m-2");
  });

  it("switches to the module of the room at once when there is one", () => {
    const l = live({ room: { mode: "SLIDES", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, terminalBroadcast: false, deck: null, strokes: [], cursor: null, online: 2 } });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    fireEvent.click(screen.getByRole("radio", { name: "Módulo de Ensino" }));
    expect(l.switchMode).toHaveBeenCalledWith("MODULE", "m-1");
  });

  it("shows the module mode on My screen for the teacher and on the Class screen as the student gets it", () => {
    live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: "b-2", terminalBroadcast: false, deck: null, strokes: [], cursor: null, online: 2 } });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    expect(within(screen.getByRole("region", { name: "Minha tela" })).getByTestId("module").getAttribute("data-role")).toBe("teacher");
    const klass = within(screen.getByRole("region", { name: "Tela da turma" })).getByTestId("module");
    expect(klass.getAttribute("data-role")).toBe("student");
    expect(klass.getAttribute("data-focus")).toBe("b-2");
    expect(screen.queryByTestId("slides")).toBeNull();
  });

  it("gives a student only the leave button, no control, and the hands and notes", () => {
    live({ canControl: false });
    render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
    expect(screen.getByRole("button", { name: "Sair da sala" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Encerrar aula" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Módulo de Ensino" })).toBeNull();
    expect(screen.getByTestId("slides").getAttribute("data-control")).toBe("false");
    expect(screen.queryByRole("region", { name: "Minha tela" })).toBeNull();
    expect(screen.getByRole("button", { name: "Levantar a mão" })).toBeDefined();
    expect(screen.getByTestId("notes")).toBeDefined();
  });

  it("ends the class for everybody, after confirming, and goes back to the class", async () => {
    live();
    const end = vi.spyOn(classroomService, "endSession").mockResolvedValue({ id: "s-1", status: "FINISHED", endedAt: "x" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar aula" }));
    expect(end).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar aula" }));
    await waitFor(() => expect(end).toHaveBeenCalledWith("c-1", "s-1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/classes/c-1"));
  });

  it("lets a student leave, which only goes back to the class", () => {
    live({ canControl: false });
    const end = vi.spyOn(classroomService, "endSession");
    render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Sair da sala" }));
    expect(push).toHaveBeenCalledWith("/app/classes/c-1");
    expect(end).not.toHaveBeenCalled();
  });

  it("tells everybody when the class ended", () => {
    live({ ended: true });
    render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
    expect(screen.getByText("A aula foi encerrada.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a turma" }).getAttribute("href")).toBe("/app/classes/c-1");
    expect(screen.queryByTestId("slides")).toBeNull();
  });

  it("tells a tab that lost the control that it only follows", () => {
    live({ passive: true, canControl: false });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    expect(screen.getByText("Outra aba assumiu o controle da aula. Esta aba só acompanha.")).toBeDefined();
    for (const slides of screen.getAllByTestId("slides")) expect(slides.getAttribute("data-control")).toBe("false");
  });

  it("tells when it is connecting or when the connection was lost", () => {
    live({ ready: false, connected: false });
    const view = render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
    expect(screen.getByRole("status").textContent).toBe("Conectando à sala…");
    live({ ready: true, connected: false });
    view.rerender(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
    expect(screen.getByRole("status").textContent).toBe("Conexão perdida. Tentando de novo…");
  });

  it("says when the class has no presentation", () => {
    live({ room: { mode: "SLIDES", slide: 1, moduleId: null, moduleFocusBlockId: null, terminalBroadcast: false, deck: null, strokes: [], cursor: null, online: 1 } });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    expect(screen.getAllByText("Esta aula não tem apresentação.").length).toBeGreaterThan(0);
  });

  // SPEC-054 CA-01, CA-03: the student waits for the teacher
  describe("waiting room of the student", () => {
    it("shows only the wait, and no stage, hands nor notes, until the teacher accepts", () => {
      live({ canControl: false, ready: false, admission: "WAITING" });
      render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
      expect(screen.getByText(/Aguardando o professor aceitar a sua entrada/)).toBeDefined();
      expect(screen.queryByTestId("slides")).toBeNull();
      expect(screen.queryByTestId("module")).toBeNull();
      expect(screen.queryByTestId("notes")).toBeNull();
      expect(screen.queryByRole("button", { name: "Levantar a mão" })).toBeNull();
      expect(screen.getByRole("button", { name: "Sair da sala" })).toBeDefined();
    });

    it("shows the class as soon as the student is accepted, without reloading", () => {
      live({ canControl: false, ready: false, admission: "WAITING" });
      const view = render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
      expect(screen.queryByTestId("slides")).toBeNull();
      live({ canControl: false, ready: true, admission: "ADMITTED" });
      view.rerender(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
      expect(screen.getByTestId("slides")).toBeDefined();
      expect(screen.queryByText(/Aguardando o professor/)).toBeNull();
    });

    it("tells the student who was removed, and lets him ask again", () => {
      const l = live({ canControl: false, ready: false, admission: "REMOVED" });
      render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
      expect(screen.getByText("O professor retirou você da aula")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Pedir para entrar de novo" }));
      expect(l.requestEntry).toHaveBeenCalledTimes(1);
    });
  });

  // SPEC-054 CA-02, CA-03, CA-06: the teacher decides who comes in
  it("gives the teacher the waiting room, to accept, accept all, decline and remove", () => {
    const l = live({
      admissions: {
        waiting: [{ studentId: "u-2", name: "Ana", requestedAt: new Date().toISOString() }],
        admitted: [{ studentId: "u-3", name: "Bruno" }],
      },
    });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Aceitar Ana" }));
    expect(l.acceptStudent).toHaveBeenCalledWith("u-2");
    fireEvent.click(screen.getByRole("button", { name: "Aceitar todos" }));
    expect(l.acceptAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Recusar Ana" }));
    expect(l.removeStudent).toHaveBeenCalledWith("u-2");
    fireEvent.click(screen.getByRole("button", { name: "Remover Bruno da aula" }));
    expect(l.removeStudent).toHaveBeenLastCalledWith("u-3");
  });

  // SPEC-054 CA-07, CA-13
  it("gives the teacher the Class screen as the student gets it, with the accepted count, and lets him collapse it", () => {
    live({ admissions: { waiting: [], admitted: [{ studentId: "u-3", name: "Bruno" }, { studentId: "u-4", name: "Carla" }] } });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    const klass = within(screen.getByRole("region", { name: "Tela da turma" }));
    expect(klass.getByText("A turma está vendo isto")).toBeDefined();
    expect(klass.getByText("2 estudantes aceitos")).toBeDefined();
    expect(klass.getByTestId("slides").getAttribute("data-slide")).toBe("2");
    expect(klass.getByTestId("slides").getAttribute("data-control")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Recolher a tela da turma" }));
    expect(screen.queryByText("A turma está vendo isto")).toBeNull();
  });

  // SPEC-054 CA-08: the teacher prepares the slides without the class seeing
  it("lets the teacher move through the slides on My screen without the class seeing it, and show them when he wants", () => {
    const l = live();
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    const mine = () => within(screen.getByRole("region", { name: "Minha tela" }));
    const klass = () => within(screen.getByRole("region", { name: "Tela da turma" }));
    expect(screen.queryByRole("button", { name: "Mostrar para a turma" })).toBeNull();

    fireEvent.click(mine().getByRole("button", { name: "mock-go-4" }));
    expect(l.changeSlide).not.toHaveBeenCalled();
    expect(mine().getByTestId("slides").getAttribute("data-slide")).toBe("4");
    expect(klass().getByTestId("slides").getAttribute("data-slide")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Seguir a turma" }));
    expect(mine().getByTestId("slides").getAttribute("data-slide")).toBe("2");
    expect(l.changeSlide).not.toHaveBeenCalled();

    fireEvent.click(mine().getByRole("button", { name: "mock-go-4" }));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar para a turma" }));
    expect(l.changeSlide).toHaveBeenCalledWith(4);
  });

  // SPEC-054 CA-09: the laser and the pen only reach the class on the slide the class sees
  it("sends the laser and the pen only while My screen is on the slide of the class", () => {
    const l = live();
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    const mine = () => within(screen.getByRole("region", { name: "Minha tela" }));

    fireEvent.click(mine().getByRole("button", { name: "mock-cursor" }));
    fireEvent.click(mine().getByRole("button", { name: "mock-draw" }));
    fireEvent.click(mine().getByRole("button", { name: "mock-clear" }));
    expect(l.moveCursor).toHaveBeenCalledWith(1, 2, true);
    expect(l.draw).toHaveBeenCalledTimes(1);
    expect(l.clearDrawings).toHaveBeenCalledTimes(1);

    fireEvent.click(mine().getByRole("button", { name: "mock-go-4" }));
    fireEvent.click(mine().getByRole("button", { name: "mock-cursor" }));
    fireEvent.click(mine().getByRole("button", { name: "mock-draw" }));
    expect(l.moveCursor).toHaveBeenCalledTimes(1);
    expect(l.draw).toHaveBeenCalledTimes(1);
    expect(mine().getByTestId("slides").getAttribute("data-strokes")).toBe("1");
    fireEvent.click(mine().getByRole("button", { name: "mock-clear" }));
    expect(l.clearDrawings).toHaveBeenCalledTimes(1);
    expect(mine().getByTestId("slides").getAttribute("data-strokes")).toBe("0");
  });

  // SPEC-054 CA-10: nothing of the terminal goes out while the broadcast is off
  it("keeps the terminal of the teacher private until the broadcast is on", () => {
    const l = live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, terminalBroadcast: false, deck: null, strokes: [], cursor: null, online: 2 } });
    const view = render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    const toggle = screen.getByRole("switch", { name: "Transmitir o terminal" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "mock-input-teacher" }));
    fireEvent.click(screen.getByRole("button", { name: "mock-sync-teacher" }));
    expect(l.sendTerminalInput).not.toHaveBeenCalled();
    expect(l.sendTerminalSync).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(l.setTerminalBroadcast).toHaveBeenCalledWith(true);

    const on = live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, terminalBroadcast: true, deck: null, strokes: [], cursor: null, online: 2 } });
    view.rerender(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    expect(screen.getByRole("switch", { name: "Transmitir o terminal" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "mock-input-teacher" }));
    fireEvent.click(screen.getByRole("button", { name: "mock-sync-teacher" }));
    expect(on.sendTerminalInput).toHaveBeenCalledWith({ terminal: 1, line: "l" });
    expect(on.sendTerminalSync).toHaveBeenCalledWith({ terminal: 1, line: "ls" });
  });

  it("lets the teacher put a block of the module in focus for the class", () => {
    const l = live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, terminalBroadcast: false, deck: null, strokes: [], cursor: null, online: 2 } });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "mock-focus-teacher" }));
    expect(l.focusBlock).toHaveBeenCalledWith("b-9");
  });

  // CA-13: only the tokens, never a color written in the style
  it.each([
    ["LiveClassroom", liveClassroomStyles],
    ["SlidePresenter", slideStyles],
    ["MirroredModuleView", mirroredStyles],
    ["LiveInteractionDrawer", drawerStyles],
    ["StudentNotesPanel", notesStyles],
    ["LiveClassPanel", liveClassPanelStyles],
    ["WaitingRoom", styleOf("../WaitingRoom/WaitingRoom.module.scss")],
    ["AdmissionPanel", styleOf("../AdmissionPanel/AdmissionPanel.module.scss")],
    ["ModuleStage", styleOf("../ModuleStage/ModuleStage.module.scss")],
  ])("%s uses only the color tokens", (_name, css) => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});
