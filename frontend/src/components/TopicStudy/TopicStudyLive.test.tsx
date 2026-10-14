import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import type { LiveModuleContent } from "@/services/classroomService";
import { TopicStudy, type TopicLive } from "./TopicStudy";

const mirrored = vi.fn();
vi.mock("@/components/Classroom/MirroredModuleView/MirroredModuleView", async () => {
  const React = await import("react");
  return {
    MirroredModuleView: (p: { role: string; initialState?: unknown; onInput?: () => void }) => {
      mirrored(p);
      return React.createElement("div", { "data-testid": "terminal", "data-role": p.role });
    },
  };
});

const terminal: LiveTerminal = { input: null, entries: [], state: null, revision: 0 };
const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { title: "Primeiro", command: "Um", html: "<p>Primeiro bloco</p>" } },
    { id: "b-2", type: "TEXT", position: 1, payload: { title: "Segundo", command: "Dois", html: "<p>Segundo bloco</p>" } },
    { id: "b-3", type: "TEXT", position: 2, payload: { title: "Terceiro", command: "Três", html: "<p>Terceiro bloco</p>" } },
  ],
};

const services = () => ({
  content: { content: vi.fn(), questions: vi.fn() },
  modules: { getModuleById: vi.fn() },
  practice: { scenario: vi.fn(), topicScenario: vi.fn(), checkModule: vi.fn(), progress: vi.fn(), answer: vi.fn(), choose: vi.fn(), link: vi.fn(), write: vi.fn() },
});

function study(live: Partial<TopicLive> = {}) {
  const s = services();
  const full: TopicLive = { module: module_, role: "student", terminal, focusBlockId: null, ...live };
  const view = render(<TopicStudy moduleId="m-1" backHref="/materials" content={s.content as never} modules={s.modules as never} practice={s.practice as never} live={full} />);
  return { s, view, full };
}

beforeEach(() => {
  localStorage.clear();
  mirrored.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-055 CA-13: the study screen, in the live-class mode
describe("TopicStudy in the live-class mode", () => {
  it("shows the module of the room at once, without asking for anything else", () => {
    const { s } = study();
    expect(screen.getByRole("heading", { level: 1, name: "Permissões de arquivos" })).toBeDefined();
    expect(screen.getByText("Primeiro bloco")).toBeDefined();
    expect(screen.getByText("Terceiro bloco")).toBeDefined();
    for (const fn of [s.content.content, s.content.questions, s.modules.getModuleById, s.practice.topicScenario, s.practice.progress]) expect(fn).not.toHaveBeenCalled();
  });

  it("leaves out what is for study alone: no challenges tab, no marks, no voice, no player, no way back", () => {
    study();
    expect(screen.queryByRole("tab", { name: /Desafios/ })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/Marcar como visto/)).toBeNull();
    expect(screen.queryByRole("button", { name: /voz|Voz/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reiniciar|Exportar|Importar/ })).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("has the material on the left and the terminal on the right, with the divider that can be dragged", () => {
    study();
    const divider = screen.getByRole("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    const before = Number(divider.getAttribute("aria-valuenow"));
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(Number(screen.getByRole("separator").getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    expect(screen.getByRole("main").contains(screen.getByTestId("terminal"))).toBe(true);
  });

  it("gives the terminal the machine of the module, the state of the class and the typing of the teacher", () => {
    const onInput = vi.fn();
    const onSync = vi.fn();
    study({ role: "teacher", onInput, onSync });
    expect(screen.getByTestId("terminal").getAttribute("data-role")).toBe("teacher");
    expect(mirrored).toHaveBeenLastCalledWith(expect.objectContaining({ initialState: { n: 1 }, terminal, onInput, onSync }));
  });

  it("gives the student a terminal that only follows", () => {
    study({ role: "student" });
    expect(screen.getByTestId("terminal").getAttribute("data-role")).toBe("student");
    expect(mirrored.mock.lastCall![0].onInput).toBeUndefined();
  });

  // CA-13, SPEC-054 CA-11: the block in focus
  describe("the block in focus", () => {
    const focused = () => document.querySelectorAll('[data-focused="true"]');

    it("highlights the block the teacher is on, and takes the student's eyes to it", () => {
      const { view, full } = study({ focusBlockId: "b-2" });
      expect(focused()).toHaveLength(1);
      expect(focused()[0]!.getAttribute("data-block")).toBe("b-2");
      expect(focused()[0]!.textContent).toContain("Segundo bloco");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, focusBlockId: "b-3" }} />);
      expect(focused()[0]!.getAttribute("data-block")).toBe("b-3");
    });

    it("highlights nothing when there is no block in focus", () => {
      study();
      expect(focused()).toHaveLength(0);
    });

    it("brings the block to the teacher's view when the panel put it in focus, but not when it came from his own reading", () => {
      const { view, full } = study({ role: "teacher", onRead: vi.fn(), focusBlockId: null });
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, role: "teacher", focusBlockId: "b-3" }} />);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });
  });

  // CA-18: the focus follows what the teacher reads
  describe("the reading of the teacher", () => {
    function layout(panel: HTMLElement, tops: Record<string, number>) {
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0, height: 400, bottom: 400, left: 0, right: 0, width: 600, x: 0, y: 0, toJSON: () => ({}) });
      for (const [id, top] of Object.entries(tops)) {
        const el = panel.querySelector(`[data-block="${id}"]`)!;
        vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top, height: 100, bottom: top + 100, left: 0, right: 0, width: 600, x: 0, y: top, toJSON: () => ({}) });
      }
    }

    it("takes as the block in focus the one the teacher is reading, without any action", () => {
      vi.useFakeTimers();
      const onRead = vi.fn();
      study({ role: "teacher", onRead });
      const panel = screen.getByRole("main").querySelector("[data-live-panel]") as HTMLElement;
      layout(panel, { "b-1": -300, "b-2": 50, "b-3": 250 });
      fireEvent.scroll(panel);
      expect(onRead).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(500));
      expect(onRead).toHaveBeenCalledTimes(1);
      expect(onRead).toHaveBeenCalledWith("b-2");

      layout(panel, { "b-1": -500, "b-2": -150, "b-3": 40 });
      fireEvent.scroll(panel);
      act(() => void vi.advanceTimersByTime(500));
      expect(onRead).toHaveBeenLastCalledWith("b-3");
    });

    it("does not repeat the same block while the teacher keeps reading it", () => {
      vi.useFakeTimers();
      const onRead = vi.fn();
      study({ role: "teacher", onRead });
      const panel = screen.getByRole("main").querySelector("[data-live-panel]") as HTMLElement;
      layout(panel, { "b-1": -300, "b-2": 50, "b-3": 250 });
      for (let i = 0; i < 3; i++) {
        fireEvent.scroll(panel);
        act(() => void vi.advanceTimersByTime(500));
      }
      expect(onRead).toHaveBeenCalledTimes(1);
    });

    it("waits for the teacher to stop scrolling", () => {
      vi.useFakeTimers();
      const onRead = vi.fn();
      study({ role: "teacher", onRead });
      const panel = screen.getByRole("main").querySelector("[data-live-panel]") as HTMLElement;
      layout(panel, { "b-1": 10, "b-2": 150, "b-3": 250 });
      fireEvent.scroll(panel);
      act(() => void vi.advanceTimersByTime(200));
      fireEvent.scroll(panel);
      act(() => void vi.advanceTimersByTime(200));
      expect(onRead).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(300));
      expect(onRead).toHaveBeenCalledWith("b-1");
    });

    it("does nothing when it is the student who scrolls", () => {
      vi.useFakeTimers();
      study({ role: "student" });
      const panel = screen.getByRole("main").querySelector("[data-live-panel]") as HTMLElement;
      layout(panel, { "b-1": -300, "b-2": 50, "b-3": 250 });
      expect(() => {
        fireEvent.scroll(panel);
        act(() => void vi.advanceTimersByTime(500));
      }).not.toThrow();
    });
  });

  describe("the divider", () => {
    const value = () => Number(screen.getByRole("separator").getAttribute("aria-valuenow"));

    it("is dragged with the pointer, and keeps the place", () => {
      study();
      vi.spyOn(screen.getByRole("main"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
      const divider = screen.getByRole("separator");
      fireEvent.pointerMove(divider, { clientX: 700 });
      expect(value()).not.toBe(70);
      fireEvent.pointerDown(divider, { pointerId: 1 });
      fireEvent.pointerMove(divider, { clientX: 600 });
      expect(value()).toBe(60);
      fireEvent.pointerUp(divider);
      expect(localStorage.length).toBeGreaterThan(0);
      fireEvent.pointerDown(divider, { pointerId: 1 });
      fireEvent.pointerCancel(divider);
      fireEvent.pointerMove(divider, { clientX: 300 });
      expect(value()).toBe(60);
    });

    it("goes back to the start with a double click, and to the ends with Home and End", () => {
      study();
      const divider = screen.getByRole("separator");
      fireEvent.keyDown(divider, { key: "Home" });
      const min = value();
      fireEvent.keyDown(divider, { key: "End" });
      expect(value()).toBeGreaterThan(min);
      fireEvent.click(divider, { detail: 2 });
      expect(value()).toBeGreaterThan(min);
      expect(value()).toBeLessThan(80);
      fireEvent.keyDown(divider, { key: "x" });
      fireEvent.keyDown(divider, { key: "ArrowLeft", shiftKey: true });
    });
  });
});

