import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { LiveClassroom } from "./LiveClassroom";
import liveClassroomStyles from "./LiveClassroom.module.scss?raw";
import liveClassPanelStyles from "../LiveClassPanel/LiveClassPanel.module.scss?raw";
import drawerStyles from "../LiveInteractionDrawer/LiveInteractionDrawer.module.scss?raw";
import mirroredStyles from "../MirroredModuleView/MirroredModuleView.module.scss?raw";
import slideStyles from "../SlidePresenter/SlidePresenter.module.scss?raw";
import notesStyles from "../StudentNotesPanel/StudentNotesPanel.module.scss?raw";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  return { SlidePresenter: (p: { slide: number; canControl: boolean }) => React.createElement("div", { "data-testid": "slides", "data-slide": p.slide, "data-control": String(p.canControl) }) };
});
vi.mock("../MirroredModuleView/MirroredModuleView", async () => {
  const React = await import("react");
  return { MirroredModuleView: (p: { role: string }) => React.createElement("div", { "data-testid": "module", "data-role": p.role }) };
});
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: new Date(Date.now() - 65 * 60_000).toISOString() };

const actions = () => ({
  changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), switchMode: vi.fn(), sendTerminalInput: vi.fn(), sendTerminalSync: vi.fn(),
  moderate: vi.fn(), raiseHand: vi.fn(), lowerHand: vi.fn(),
});

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 },
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

beforeEach(() => push.mockClear());
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
    expect(screen.getByTestId("slides").getAttribute("data-slide")).toBe("2");
    expect(screen.getByTestId("slides").getAttribute("data-control")).toBe("true");
  });

  it("switches the mode for everybody", () => {
    const l = live();
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    fireEvent.click(screen.getByRole("radio", { name: "Módulo de Ensino" }));
    expect(l.switchMode).toHaveBeenCalledWith("MODULE", undefined);
    fireEvent.click(screen.getByRole("radio", { name: "Lâminas" }));
    expect(l.switchMode).toHaveBeenLastCalledWith("SLIDES");
  });

  it("shows the module mode with the mirrored terminal", () => {
    live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", deck: null, strokes: [], cursor: null, online: 2 } });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    expect(screen.getByTestId("module").getAttribute("data-role")).toBe("teacher");
    expect(screen.queryByTestId("slides")).toBeNull();
  });

  it("gives a student only the leave button, no control, and the hands and notes", () => {
    live({ canControl: false });
    render(<LiveClassroom classId="c-1" role="student" userId="u-1" session={session} />);
    expect(screen.getByRole("button", { name: "Sair da sala" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Encerrar aula" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Módulo de Ensino" })).toBeNull();
    expect(screen.getByTestId("slides").getAttribute("data-control")).toBe("false");
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
    expect(screen.getByTestId("slides").getAttribute("data-control")).toBe("false");
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
    live({ room: { mode: "SLIDES", slide: 1, moduleId: null, deck: null, strokes: [], cursor: null, online: 1 } });
    render(<LiveClassroom classId="c-1" role="teacher" userId="t-1" session={session} />);
    expect(screen.getByText("Esta aula não tem apresentação.")).toBeDefined();
  });

  // CA-13: only the tokens, never a color written in the style
  it.each([
    ["LiveClassroom", liveClassroomStyles],
    ["SlidePresenter", slideStyles],
    ["MirroredModuleView", mirroredStyles],
    ["LiveInteractionDrawer", drawerStyles],
    ["StudentNotesPanel", notesStyles],
    ["LiveClassPanel", liveClassPanelStyles],
  ])("%s uses only the color tokens", (_name, css) => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});
