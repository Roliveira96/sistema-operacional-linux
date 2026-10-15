import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import type { LiveSession } from "@/services/classroomService";
import { PresenterStage } from "./PresenterStage";

vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  return { SlidePresenter: () => React.createElement("div", { "data-testid": "slides" }) };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  type P = { startedAt?: string | null; handCount?: number };
  return {
    ModuleStage: (p: P) => React.createElement("div", { "data-testid": "module", "data-started-at": p.startedAt ?? "", "data-hand-count": String(p.handCount) }),
  };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const deck = { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" };

function live(over: Record<string, unknown> = {}, room: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "MODULE", slide: 2, moduleId: "m-1", moduleFocusBlockId: null, deck, strokes: [], cursor: null, online: 5, blank: false, ...room },
    terminal: { screen: null },
    stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {}, fullscreen: false },
    handCount: 0,
    fullscreenRequested: false,
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), switchMode: vi.fn(), sendTerminalScreen: vi.fn(),
    focusBlock: vi.fn(), setBlank: vi.fn(), sendStageScroll: vi.fn(), sendStageSplit: vi.fn(), sendStageZoom: vi.fn(), sendStageSelection: vi.fn(), sendTerminalScroll: vi.fn(),
    sendStageFullscreen: vi.fn(),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value as typeof value & { sendStageFullscreen: ReturnType<typeof vi.fn> };
}

const stage = () => render(<PresenterStage classId="c-1" session={session} />);
const bar = () => within(screen.getByRole("toolbar", { name: "Ferramentas da apresentação" }));

beforeEach(() => {
  localStorage.setItem("live-presenter-tip", "seen");
  document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-058 CA-01: the header of the module is the same on the presentation window as on the screen of the students
describe("PresenterStage, for the header of the module", () => {
  it("gives the module the start of the class, as the room tells it, and the number of raised hands", () => {
    live({ startedAt: "2026-10-14T09:30:00Z", handCount: 2 });
    stage();
    expect(screen.getByTestId("module").getAttribute("data-started-at")).toBe("2026-10-14T09:30:00Z");
    expect(screen.getByTestId("module").getAttribute("data-hand-count")).toBe("2");
  });

  it("falls back to the start the page was given while no snapshot has come", () => {
    live({ handCount: 0 });
    stage();
    expect(screen.getByTestId("module").getAttribute("data-started-at")).toBe(session.startedAt);
    expect(screen.getByTestId("module").getAttribute("data-hand-count")).toBe("0");
  });
});

// SPEC-059 CA-01: the button on the toolbar of the presentation window
describe("PresenterStage, the full screen for the students", () => {
  it("has the button on the toolbar, off at first, with the state in view and the explanation on it", () => {
    live();
    stage();
    const button = bar().getByRole("button", { name: "Tela cheia para os alunos" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(bar().getByText("Desligada")).toBeDefined();
    expect(button.getAttribute("title")).toMatch(/ao primeiro toque, se o navegador pedir/);
  });

  it("is not the full screen of the teacher's own window, which is another button", () => {
    live();
    stage();
    fireEvent.click(bar().getByRole("button", { name: "Tela cheia para os alunos" }));
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(bar().getByRole("button", { name: "Tela cheia" })).toBeDefined();
  });

  it("turns the request on with a click, and sends it", () => {
    const l = live();
    stage();
    fireEvent.click(bar().getByRole("button", { name: "Tela cheia para os alunos" }));
    expect(l.sendStageFullscreen).toHaveBeenCalledTimes(1);
    expect(l.sendStageFullscreen).toHaveBeenCalledWith(true);
  });

  it("shows it on, as the room tells, and turns it off with a click", () => {
    const l = live({ fullscreenRequested: true });
    stage();
    const button = bar().getByRole("button", { name: "Tela cheia para os alunos" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(bar().getByText("Ligada")).toBeDefined();
    expect(bar().queryByText("Desligada")).toBeNull();
    fireEvent.click(button);
    expect(l.sendStageFullscreen).toHaveBeenCalledWith(false);
  });

  it("follows the room when the request is turned on or off from the panel", () => {
    live({ fullscreenRequested: false });
    const view = stage();
    live({ fullscreenRequested: true });
    view.rerender(<PresenterStage classId="c-1" session={session} />);
    expect(bar().getByText("Ligada")).toBeDefined();
    expect(bar().getByRole("button", { name: "Tela cheia para os alunos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("cannot be used by a window that lost the control", () => {
    live({ canControl: false, passive: true });
    stage();
    expect((bar().getByRole("button", { name: "Tela cheia para os alunos" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the button on the slides too, not only on the module", () => {
    live({}, { mode: "SLIDES" });
    stage();
    expect(bar().getByRole("button", { name: "Tela cheia para os alunos" })).toBeDefined();
  });
});
