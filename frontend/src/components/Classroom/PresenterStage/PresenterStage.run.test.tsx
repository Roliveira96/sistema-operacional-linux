import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import type { LiveSession } from "@/services/classroomService";
import { PresenterStage } from "./PresenterStage";

vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  return { SlidePresenter: () => React.createElement("div", { "data-testid": "slides" }) };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  type P = { role: string; onRunFailed?: () => void };
  return {
    ModuleStage: (p: P) => React.createElement("div", { "data-testid": "module", "data-role": p.role }, React.createElement("button", { onClick: () => p.onRunFailed?.() }, "mock-run-failed")),
  };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "MODULE", currentSlide: 1, startedAt: "x" };
const deck = { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" };
const FAILED = "Não foi possível executar o exemplo";

function live(room: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, deck, strokes: [], cursor: null, online: 5, blank: false, ...room },
    terminal: { screen: null },
    stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {} },
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), switchMode: vi.fn(), sendTerminalScreen: vi.fn(),
    focusBlock: vi.fn(), setBlank: vi.fn(), sendStageScroll: vi.fn(), sendStageSplit: vi.fn(), sendStageZoom: vi.fn(), sendStageSelection: vi.fn(), sendTerminalScroll: vi.fn(),
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value;
}

const fail = () => fireEvent.click(screen.getByRole("button", { name: "mock-run-failed" }));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-060 CA-04: the short notice of the window of the presentation, with no panel over the stage
describe("PresenterStage: the example that cannot run", () => {
  it("gives the module the way to tell it", () => {
    live();
    render(<PresenterStage classId="c-1" session={session} />);
    expect(screen.getByTestId("module").getAttribute("data-role")).toBe("teacher");
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("shows the short notice when an example cannot run, outside the stage that the students see", () => {
    live();
    render(<PresenterStage classId="c-1" session={session} />);
    fail();
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toBe(FAILED);
    expect(screen.getByTestId("module").contains(notice)).toBe(false);
  });

  it("takes the notice away by itself after a few seconds, since it is short", () => {
    live();
    render(<PresenterStage classId="c-1" session={session} />);
    fail();
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByText(FAILED)).not.toBeNull();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("keeps it for the full time when it happens again, instead of the time of the first one", () => {
    live();
    render(<PresenterStage classId="c-1" session={session} />);
    fail();
    act(() => void vi.advanceTimersByTime(3000));
    fail();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByText(FAILED)).not.toBeNull();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("does not take away, with its timer, a notice that came after it", () => {
    live({ deck: null });
    render(<PresenterStage classId="c-1" session={session} />);
    fail();
    expect(screen.getByRole("alert").textContent).toBe(FAILED);
    // The key M asks for the slides, which this class has not: that notice stays, as it always did, and the timer of the first is gone.
    fireEvent.keyDown(document.body, { key: "m" });
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(messages.classroom.room.noDeck);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("alert").textContent).toBe(messages.classroom.room.noDeck);
  });

  it("stops the timer when the window goes away", () => {
    live();
    const view = render(<PresenterStage classId="c-1" session={session} />);
    fail();
    expect(screen.getByRole("alert").textContent).toBe(FAILED);
    view.unmount();
    expect(() => act(() => void vi.advanceTimersByTime(10_000))).not.toThrow();
  });
});
