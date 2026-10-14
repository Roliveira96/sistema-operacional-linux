import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import type { LiveSession } from "@/services/classroomService";
import { LiveClassroom } from "../LiveClassroom/LiveClassroom";
import { PresenterStage } from "../PresenterStage/PresenterStage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  return { SlidePresenter: () => React.createElement("div", { "data-testid": "slides" }) };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  return { ModuleStage: () => React.createElement("div", { "data-testid": "module" }) };
});
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div") };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões de arquivos", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const deck = { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" };

/** The state of the room the hook gives to the window of the teacher and to the room of the student, with the waiting screen on. */
function room(mode: "SLIDES" | "MODULE", zoom = 1) {
  const value = {
    room: { mode, slide: 2, moduleId: "m-1", moduleFocusBlockId: null, blank: true, deck, strokes: [], cursor: null, online: 5 },
    admission: "ADMITTED",
    terminal: { screen: null },
    stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom, selection: null, terminalScroll: {} },
    hands: [],
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), raiseHand: vi.fn(), lowerHand: vi.fn(), requestEntry: vi.fn(),
    switchMode: vi.fn(), setBlank: vi.fn(), sendStageScroll: vi.fn(), sendStageSplit: vi.fn(), sendStageZoom: vi.fn(), sendStageSelection: vi.fn(), sendTerminalScroll: vi.fn(),
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
}

const teacher = () => render(<PresenterStage classId="c-1" session={session} />);
const student = () => render(<LiveClassroom classId="c-1" userId="u-1" session={session} />);
const coverOf = () => screen.getByRole("status", { name: "Tela de espera" });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T11:05:30Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-061 CA-04 (and CA-22 of the SPEC-057): the teacher and the students see the same screen, in the same place of the stage, and of the same size
describe("the waiting screen, for the teacher and for the student", () => {
  it.each([["SLIDES"], ["MODULE"]] as const)("is the very same markup for both, with the stage on %s", (mode) => {
    room(mode);
    teacher();
    const forTheTeacher = coverOf().outerHTML;
    cleanup();
    student();
    expect(coverOf().outerHTML).toBe(forTheTeacher);
    expect(forTheTeacher).toContain("Permissões de arquivos");
    expect(forTheTeacher).toContain("01:05:30");
  });

  it("is the last thing of the stage for both, so it covers all of it, and it has no size nor place of its own", () => {
    room("SLIDES");
    for (const open of [teacher, student]) {
      const view = open();
      const cover = coverOf();
      expect(screen.getByTestId("stage-box").lastElementChild).toBe(cover);
      expect(cover.getAttribute("style")).toBeNull();
      view.unmount();
    }
  });

  it("has the size of the stage of 1280 x 720 for both, and the size the zoom of the teacher gives it", () => {
    for (const zoom of [1, 2]) {
      room("SLIDES", zoom);
      for (const open of [teacher, student]) {
        const view = open();
        const stage = screen.getByTestId("stage-box");
        expect([stage.style.width, stage.style.height]).toEqual([`${1280 / zoom}px`, `${720 / zoom}px`]);
        expect(stage.contains(coverOf())).toBe(true);
        view.unmount();
      }
    }
  });

  it("runs the same time for both, second by second", () => {
    room("SLIDES");
    for (const open of [teacher, student]) {
      const view = open();
      expect(screen.getByText("01:05:30")).toBeDefined();
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.getByText("01:05:31")).toBeDefined();
      view.unmount();
      vi.setSystemTime(new Date("2026-10-14T11:05:30Z"));
    }
  });
});
