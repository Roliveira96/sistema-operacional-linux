import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import type { LiveModuleContent } from "@/services/classroomService";
import { TopicStudy, type TopicLive } from "./TopicStudy";

const mirrored = vi.fn();
vi.mock("@/components/Classroom/MirroredModuleView/MirroredModuleView", async () => {
  const React = await import("react");
  return {
    MirroredModuleView: (p: { role: string; initialState?: unknown; onScreen?: () => void }) => {
      mirrored(p);
      return React.createElement("div", { "data-testid": "terminal", "data-role": p.role });
    },
  };
});

const terminal: LiveTerminal = { screen: null };
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

  it("has the material on the left and the terminal on the right, with the divider that the teacher can drag", () => {
    study({ role: "teacher" });
    const divider = screen.getByRole("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    const before = Number(divider.getAttribute("aria-valuenow"));
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(Number(screen.getByRole("separator").getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    expect(screen.getByRole("main").contains(screen.getByTestId("terminal"))).toBe(true);
  });

  it("gives the terminal the machine of the module, the screen of the class and the way for the teacher to tell his screen", () => {
    const onScreen = vi.fn();
    study({ role: "teacher", onScreen });
    expect(screen.getByTestId("terminal").getAttribute("data-role")).toBe("teacher");
    expect(mirrored).toHaveBeenLastCalledWith(expect.objectContaining({ initialState: { n: 1 }, terminal, onScreen }));
  });

  it("gives the student a terminal that only follows", () => {
    study({ role: "student" });
    expect(screen.getByTestId("terminal").getAttribute("data-role")).toBe("student");
    expect(mirrored.mock.lastCall![0].onScreen).toBeUndefined();
  });

  // CA-13, SPEC-054 CA-11: the block in focus
  describe("the block in focus", () => {
    const focused = () => document.querySelectorAll('[data-focused="true"]');

    // SPEC-057 CA-07, CA-10: the student's eyes go where the scroll of the teacher takes them, so the focus only marks the block
    it("highlights the block the teacher is on, without moving the student's own view", () => {
      const { view, full } = study({ focusBlockId: "b-2" });
      expect(focused()).toHaveLength(1);
      expect(focused()[0]!.getAttribute("data-block")).toBe("b-2");
      expect(focused()[0]!.textContent).toContain("Segundo bloco");
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
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

    it("is dragged with the pointer by the teacher, and the live screen leaves the preference of the study screen alone", () => {
      study({ role: "teacher" });
      vi.spyOn(screen.getByRole("main"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
      const divider = screen.getByRole("separator");
      fireEvent.pointerMove(divider, { clientX: 700 });
      expect(value()).not.toBe(70);
      fireEvent.pointerDown(divider, { pointerId: 1 });
      fireEvent.pointerMove(divider, { clientX: 600 });
      expect(value()).toBe(60);
      fireEvent.pointerUp(divider);
      expect(localStorage.length).toBe(0);
      fireEvent.pointerDown(divider, { pointerId: 1 });
      fireEvent.pointerCancel(divider);
      fireEvent.pointerMove(divider, { clientX: 300 });
      expect(value()).toBe(60);
    });

    it("goes back to the start with a double click, and to the ends with Home and End, for the teacher", () => {
      study({ role: "teacher" });
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

    // SPEC-057 CA-07, CA-08: the divider is where the teacher put it, for everybody, from the start
    it("starts where the room says, as a fraction of the stage that the material takes", () => {
      study({ split: 0.6 });
      expect(value()).toBe(60);
      expect(screen.getByRole("main").style.getPropertyValue("--split-columns")).toBe("minmax(0, 60fr) 10px minmax(0, 40fr)");
    });

    it("starts at the default of the layout when the room has none, and not at the preference of the study screen", () => {
      localStorage.setItem("exame-so:divisao", "70");
      study({ split: null });
      expect(value()).toBe(44);
      cleanup();
      study();
      expect(value()).toBe(44);
    });

    it("follows the teacher when the room changes the divider, or tells it again at a new connection", () => {
      const { view, full } = study({ split: 0.5 });
      expect(value()).toBe(50);
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, split: 0.3 }} />);
      expect(value()).toBe(30);
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, split: null }} />);
      expect(value()).toBe(44);
    });

    it("keeps the divider the room tells inside the range of the screen", () => {
      study({ split: 0.2 });
      expect(value()).toBe(25);
    });

    it("takes the new place of the room for the teacher too, after he moved it by hand", () => {
      const { view, full } = study({ role: "teacher", split: 0.5 });
      fireEvent.keyDown(screen.getByRole("separator"), { key: "Home" });
      expect(value()).toBe(25);
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, role: "teacher", split: 0.65 }} />);
      expect(value()).toBe(65);
    });

    it("tells the room, as a fraction, where the teacher drags the divider and where he puts it with the keys", () => {
      const onSplit = vi.fn();
      study({ role: "teacher", onSplit });
      vi.spyOn(screen.getByRole("main"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
      const divider = screen.getByRole("separator");
      fireEvent.pointerDown(divider, { pointerId: 1 });
      fireEvent.pointerMove(divider, { clientX: 600 });
      expect(onSplit).toHaveBeenLastCalledWith(0.6);
      fireEvent.pointerUp(divider);
      fireEvent.keyDown(divider, { key: "ArrowRight" });
      expect(onSplit).toHaveBeenLastCalledWith(0.62);
      fireEvent.keyDown(divider, { key: "Home" });
      expect(onSplit).toHaveBeenLastCalledWith(0.25);
      fireEvent.click(divider, { detail: 2 });
      expect(onSplit).toHaveBeenLastCalledWith(0.44);
    });

    // CA-10: the student cannot move it
    it("gives the student a divider that does not move: no pointer, no keys, no focus", () => {
      const onSplit = vi.fn();
      study({ role: "student", split: 0.5, onSplit });
      vi.spyOn(screen.getByRole("main"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
      const divider = screen.getByRole("separator");
      expect(divider.hasAttribute("tabindex")).toBe(false);
      fireEvent.pointerDown(divider, { pointerId: 1 });
      fireEvent.pointerMove(divider, { clientX: 800 });
      fireEvent.pointerUp(divider);
      fireEvent.keyDown(divider, { key: "ArrowRight" });
      fireEvent.keyDown(divider, { key: "Home" });
      fireEvent.click(divider, { detail: 2 });
      expect(value()).toBe(50);
      expect(onSplit).not.toHaveBeenCalled();
    });
  });

  // SPEC-057 CA-04, CA-07, CA-10: the scroll of the material is the teacher's, and the student only follows it
  describe("the scroll of the material", () => {
    /** The sizes the browser would compute; jsdom has none. */
    function layout(content = 2400, view = 600) {
      const sizes = { content, view };
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => sizes.content);
      vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => sizes.view);
      return sizes;
    }
    const panelEl = () => screen.getByRole("main").querySelector("[data-live-panel]") as HTMLElement;
    const contentEl = () => panelEl().querySelector("[data-live-content]") as HTMLElement;

    it("lets the teacher scroll the material, and gives the student a panel that nobody scrolls", () => {
      study({ role: "teacher" });
      expect(panelEl().classList.contains("follower")).toBe(false);
      cleanup();
      study({ role: "student" });
      expect(panelEl().classList.contains("follower")).toBe(true);
    });

    it("tells the room where the teacher is in the material, as a fraction of what can be scrolled", () => {
      layout();
      const onMaterialScroll = vi.fn();
      study({ role: "teacher", onMaterialScroll });
      panelEl().scrollTop = 900;
      fireEvent.scroll(panelEl());
      expect(onMaterialScroll).toHaveBeenLastCalledWith(0.5);
      panelEl().scrollTop = 1800;
      fireEvent.scroll(panelEl());
      expect(onMaterialScroll).toHaveBeenLastCalledWith(1);
    });

    it("tells 0 when the material fits in the panel", () => {
      layout(500, 600);
      const onMaterialScroll = vi.fn();
      study({ role: "teacher", onMaterialScroll });
      fireEvent.scroll(panelEl());
      expect(onMaterialScroll).toHaveBeenLastCalledWith(0);
    });

    it("keeps working when the teacher scrolls and nobody listens", () => {
      layout();
      study({ role: "teacher" });
      expect(() => fireEvent.scroll(panelEl())).not.toThrow();
    });

    it("tells nothing when it is the student who scrolls", () => {
      layout();
      const onMaterialScroll = vi.fn();
      study({ role: "student", onMaterialScroll });
      panelEl().scrollTop = 900;
      fireEvent.scroll(panelEl());
      expect(onMaterialScroll).not.toHaveBeenCalled();
    });

    it("shows the student the place of the teacher, moving the material and not the student's own scroll", () => {
      layout();
      study({ role: "student", materialScroll: 0.5 });
      expect(contentEl().style.transform).toBe("translateY(-900px)");
      expect(panelEl().scrollTop).toBe(0);
    });

    it("follows the teacher as the room changes the scroll, and goes back to the top", () => {
      layout();
      const { view, full } = study({ role: "student", materialScroll: 0.25 });
      expect(contentEl().style.transform).toBe("translateY(-450px)");
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, materialScroll: 1 }} />);
      expect(contentEl().style.transform).toBe("translateY(-1800px)");
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, materialScroll: 0 }} />);
      expect(contentEl().style.transform).toBe("translateY(0px)");
    });

    it("places the place of the teacher again when the divider moves, because the text breaks in other lines", () => {
      const sizes = layout();
      const { view, full } = study({ role: "student", materialScroll: 0.5, split: 0.4 });
      expect(contentEl().style.transform).toBe("translateY(-900px)");
      sizes.content = 3000;
      view.rerender(<TopicStudy moduleId="m-1" backHref="" live={{ ...full, materialScroll: 0.5, split: 0.6 }} />);
      expect(contentEl().style.transform).toBe("translateY(-1200px)");
    });

    it("puts the teacher back where the room says, when he comes in or connects again", () => {
      layout();
      study({ role: "teacher", materialScroll: 0.5 });
      expect(panelEl().scrollTop).toBe(900);
    });

    it("does not take the teacher back to the room's place when he moves the divider", () => {
      layout();
      study({ role: "teacher", materialScroll: 0 });
      panelEl().scrollTop = 900;
      fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
      expect(panelEl().scrollTop).toBe(900);
    });

    it("tells the room the place again when the teacher moves the divider, for the text breaks in other lines", () => {
      layout();
      const onMaterialScroll = vi.fn();
      study({ role: "teacher", onMaterialScroll });
      panelEl().scrollTop = 900;
      onMaterialScroll.mockClear();
      fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
      expect(onMaterialScroll).toHaveBeenLastCalledWith(0.5);
    });

    it("still takes the reading of the teacher as the block in focus when he scrolls", () => {
      vi.useFakeTimers();
      layout();
      const onRead = vi.fn();
      const onMaterialScroll = vi.fn();
      study({ role: "teacher", onRead, onMaterialScroll });
      fireEvent.scroll(panelEl());
      act(() => void vi.advanceTimersByTime(500));
      expect(onRead).toHaveBeenCalledTimes(1);
      expect(onMaterialScroll).toHaveBeenCalled();
    });
  });
});

