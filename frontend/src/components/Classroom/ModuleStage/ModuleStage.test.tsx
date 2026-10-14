import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
import { StageScale, StageZoom } from "../FixedStage/FixedStage";
import { STAGE_HEIGHT as H, STAGE_WIDTH as W } from "../FixedStage/stage";
import { ModuleStage } from "./ModuleStage";

const topic = vi.fn();
vi.mock("@/components/TopicStudy/TopicStudy", async () => {
  const React = await import("react");
  return {
    TopicStudy: (p: { moduleId: string; live?: { role: string; focusBlockId: string | null; module: { title: string }; onRead?: unknown; onScreen?: unknown } }) => {
      topic(p);
      return React.createElement("div", { "data-testid": "topic", "data-module": p.moduleId, "data-role": p.live?.role, "data-focus": p.live?.focusBlockId ?? "" }, p.live?.module.title);
    },
  };
});

const terminal: LiveTerminal = { screen: null };
const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { formato: "exame-so/maquina", n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { html: "Primeiro bloco" } },
    { id: "b-2", type: "TEXT", position: 1, payload: { html: "Segundo bloco" } },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  topic.mockClear();
  vi.restoreAllMocks();
});

// SPEC-055 CA-13: the module of the room is the study screen of the module, in the live-class mode
describe("ModuleStage", () => {
  it("loads the module of the room and shows it in the study screen, in the live-class mode", async () => {
    const get = vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId="b-2" terminal={terminal} />);
    expect(screen.getByRole("status").textContent).toBe("Carregando o módulo da aula…");
    const view = await screen.findByTestId("topic");
    expect(get).toHaveBeenCalledWith("c-1");
    expect(view.getAttribute("data-module")).toBe("m-1");
    expect(view.getAttribute("data-role")).toBe("student");
    expect(view.getAttribute("data-focus")).toBe("b-2");
    expect(topic.mock.lastCall![0].live).toMatchObject({ module: module_, terminal, role: "student" });
  });

  it("gives the student no way to send anything", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} onScreen={vi.fn()} onFocusBlock={vi.fn()} />);
    await screen.findByTestId("topic");
    const { live } = topic.mock.lastCall![0];
    expect(live.onScreen).toBeUndefined();
    expect(live.onRead).toBeUndefined();
  });

  it("gives the teacher the picture of the terminal screen and the reading, straight", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const onScreen = vi.fn();
    const onFocusBlock = vi.fn();
    render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onScreen={onScreen} onFocusBlock={onFocusBlock} />);
    await screen.findByTestId("topic");
    const { live } = topic.mock.lastCall![0];
    expect(live.onScreen).toBe(onScreen);
    expect(live.onRead).toBe(onFocusBlock);
  });

  it("loads the module again when the module of the room changes, and not at every focus", async () => {
    const get = vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const view = render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    await screen.findByTestId("topic");
    view.rerender(<ModuleStage classId="c-1" role="student" moduleFocusBlockId="b-1" terminal={terminal} />);
    expect(get).toHaveBeenCalledTimes(1);
    view.rerender(<ModuleStage classId="c-1" moduleId="m-2" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  // SPEC-057 CA-07, CA-10: the scroll of the material and the divider follow the teacher, and only he moves them
  describe("the scroll of the material and the divider", () => {
    const stageView = { slideScroll: 0.2, slideScrollX: 0, materialScroll: 0.6, split: 0.55, zoom: 1, selection: null };

    it("gives the study screen where the teacher is: the scroll of the material and the divider", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} stageView={stageView} />);
      await screen.findByTestId("topic");
      expect(topic.mock.lastCall![0].live).toMatchObject({ materialScroll: 0.6, split: 0.55 });
    });

    it("lets the teacher tell the scroll of the material and the divider, straight, and gives the student no way to", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onMaterialScroll = vi.fn();
      const onSplit = vi.fn();
      const view = render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} stageView={stageView} onMaterialScroll={onMaterialScroll} onSplit={onSplit} />);
      await screen.findByTestId("topic");
      expect(topic.mock.lastCall![0].live.onMaterialScroll).toBe(onMaterialScroll);
      expect(topic.mock.lastCall![0].live.onSplit).toBe(onSplit);
      view.rerender(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} stageView={stageView} onMaterialScroll={onMaterialScroll} onSplit={onSplit} />);
      expect(topic.mock.lastCall![0].live.onMaterialScroll).toBeUndefined();
      expect(topic.mock.lastCall![0].live.onSplit).toBeUndefined();
    });

    it("leaves the scroll and the divider to the study screen's own default when the room tells nothing", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} />);
      await screen.findByTestId("topic");
      expect(topic.mock.lastCall![0].live.materialScroll).toBeUndefined();
      expect(topic.mock.lastCall![0].live.split).toBeUndefined();
    });
  });

  // SPEC-057 CA-07: the pointer of the teacher is shown on the module, as a percentage of the stage
  describe("the pointer of the teacher", () => {
    const wrapper = () => screen.getByTestId("topic").parentElement as HTMLElement;
    const rectOf = (el: Element, r: { left: number; top: number; width: number; height: number }) =>
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) });
    const stageRect = { left: 0, top: 0, width: W, height: H };

    it("shows the student the plain pointer, and the laser as a highlight, at a percentage of the stage", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const view = render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} cursor={{ x: 30, y: 40, laser: false, visible: true }} />);
      await screen.findByTestId("topic");
      const pointer = wrapper().querySelector("[data-pointer]") as HTMLElement;
      expect([pointer.style.left, pointer.style.top]).toEqual(["30%", "40%"]);
      expect(wrapper().querySelector("[data-laser]")).toBeNull();
      view.rerender(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} cursor={{ x: 70, y: 10, laser: true, visible: true }} />);
      const laser = wrapper().querySelector("[data-laser]") as HTMLElement;
      expect([laser.style.left, laser.style.top]).toEqual(["70%", "10%"]);
      expect(wrapper().querySelector("[data-pointer]")).toBeNull();
    });

    it("hides the pointer when the teacher has left the stage, or there is none", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const view = render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} cursor={{ x: 30, y: 40, laser: false, visible: false }} />);
      await screen.findByTestId("topic");
      expect(wrapper().querySelector("[data-pointer]")).toBeNull();
      view.rerender(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} cursor={null} />);
      expect(wrapper().querySelector("[data-pointer], [data-laser]")).toBeNull();
    });

    it("sends the mouse of the teacher as a percentage of the stage", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} />);
      await screen.findByTestId("topic");
      rectOf(wrapper(), stageRect);
      fireEvent.mouseMove(wrapper(), { clientX: W / 4, clientY: H / 4 });
      expect(onCursor).toHaveBeenLastCalledWith(25, 25, false, true);
    });

    it("sends the same point from a window that shows the stage smaller", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      render(
        <StageScale.Provider value={0.5}>
          <ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} laser />
        </StageScale.Provider>,
      );
      await screen.findByTestId("topic");
      rectOf(wrapper(), { left: 100, top: 50, width: W / 2, height: H / 2 });
      fireEvent.mouseMove(wrapper(), { clientX: 100 + W / 4, clientY: 50 + H / 4 });
      expect(onCursor).toHaveBeenLastCalledWith(50, 50, true, true);
    });

    it("keeps the point inside the stage", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} />);
      await screen.findByTestId("topic");
      rectOf(wrapper(), stageRect);
      fireEvent.mouseMove(wrapper(), { clientX: 5000, clientY: -40 });
      expect(onCursor).toHaveBeenLastCalledWith(100, 0, false, true);
    });

    it("sends at most every 33 ms, the last position always arrives, and the pointer goes away with the mouse", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} />);
      await screen.findByTestId("topic");
      rectOf(wrapper(), stageRect);
      vi.useFakeTimers();
      fireEvent.mouseMove(wrapper(), { clientX: W / 10, clientY: H / 10 });
      act(() => vi.advanceTimersByTime(10));
      fireEvent.mouseMove(wrapper(), { clientX: W / 5, clientY: H / 5 });
      act(() => vi.advanceTimersByTime(10));
      fireEvent.mouseMove(wrapper(), { clientX: W / 2, clientY: H / 2 });
      expect(onCursor).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(14));
      expect(onCursor).toHaveBeenCalledTimes(2);
      expect(onCursor).toHaveBeenLastCalledWith(50, 50, false, true);
      fireEvent.mouseLeave(wrapper());
      expect(onCursor).toHaveBeenLastCalledWith(0, 0, false, false);
    });

    it("turns the pointer into the highlight at once when the laser is turned on, even if the mouse is still", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      const view = render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} />);
      await screen.findByTestId("topic");
      rectOf(wrapper(), stageRect);
      fireEvent.mouseMove(wrapper(), { clientX: W / 2, clientY: H / 2 });
      view.rerender(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} laser />);
      expect(onCursor).toHaveBeenLastCalledWith(50, 50, true, true);
    });

    // CA-15, CA-16: with the zoom the stage is smaller in logical pixels, and the point is still a percentage of it
    it("sends the mouse as a percentage of the smaller stage that the zoom makes", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      render(
        <StageZoom.Provider value={2}>
          <ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} />
        </StageZoom.Provider>,
      );
      await screen.findByTestId("topic");
      // The stage is W/2 x H/2 logical pixels, and the window shows it at scale 1.
      rectOf(wrapper(), { left: 0, top: 0, width: W / 2, height: H / 2 });
      fireEvent.mouseMove(wrapper(), { clientX: W / 4, clientY: H / 4 });
      expect(onCursor).toHaveBeenLastCalledWith(50, 50, false, true);
      fireEvent.mouseMove(wrapper(), { clientX: W / 8, clientY: H / 2 });
      expect(onCursor).toHaveBeenLastCalledWith(25, 100, false, true);
    });

    it("sends the same point with the zoom and the scale of the window together", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      render(
        <StageScale.Provider value={2}>
          <StageZoom.Provider value={2}>
            <ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} />
          </StageZoom.Provider>
        </StageScale.Provider>,
      );
      await screen.findByTestId("topic");
      // The stage of W/2 x H/2 is shown twice as big, so it takes W x H of the screen.
      rectOf(wrapper(), { left: 40, top: 20, width: W, height: H });
      fireEvent.mouseMove(wrapper(), { clientX: 40 + W / 2, clientY: 20 + H / 2 });
      expect(onCursor).toHaveBeenLastCalledWith(50, 50, false, true);
    });

    // CA-19: the teacher sees his own mouse, not the point that stands for it; the laser is for both
    it("does not draw the plain pointer on the screen of the teacher, and draws the laser", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const view = render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} cursor={{ x: 30, y: 40, laser: false, visible: true }} />);
      await screen.findByTestId("topic");
      expect(wrapper().querySelector("[data-pointer]")).toBeNull();
      expect(wrapper().querySelector("[data-laser]")).toBeNull();
      view.rerender(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} cursor={{ x: 30, y: 40, laser: true, visible: true }} />);
      const laser = wrapper().querySelector("[data-laser]") as HTMLElement;
      expect([laser.style.left, laser.style.top]).toEqual(["30%", "40%"]);
    });

    // CA-20, CA-21: the stretch of text the teacher selected is told by him and shown to the student
    it("gives the student the selection of the teacher to mark, and no way to tell one", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const picked = { pane: "material" as const, start: { block: "b-1", offset: 1 }, end: { block: "b-2", offset: 3 } };
      const onSelection = vi.fn();
      render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} stageView={{ slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: picked }} onSelection={onSelection} />);
      await screen.findByTestId("topic");
      expect(topic.mock.lastCall![0].live.selection).toEqual(picked);
      expect(topic.mock.lastCall![0].live.onSelection).toBeUndefined();
    });

    it("lets the teacher tell the selection, straight, and leaves the marking to the real selection he has", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const picked = { pane: "terminal" as const, terminal: 1, start: 1, end: 3 };
      const onSelection = vi.fn();
      render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} stageView={{ slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: picked }} onSelection={onSelection} />);
      await screen.findByTestId("topic");
      expect(topic.mock.lastCall![0].live.onSelection).toBe(onSelection);
      expect(topic.mock.lastCall![0].live.selection).toBeUndefined();
    });

    it("sends nothing from a student, even when given the way to", async () => {
      vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
      const onCursor = vi.fn();
      render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} onCursor={onCursor} />);
      await screen.findByTestId("topic");
      fireEvent.mouseMove(wrapper(), { clientX: W / 2, clientY: H / 2 });
      fireEvent.mouseLeave(wrapper());
      expect(onCursor).not.toHaveBeenCalled();
    });
  });

  it("tells when the module cannot be loaded", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockRejectedValue(new Error("down"));
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Não foi possível carregar o módulo da aula."));
  });
});
