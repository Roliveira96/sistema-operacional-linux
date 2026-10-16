import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSnapshot } from "@/services/classroomService";
import { useLiveClassroom } from "./useLiveClassroom";

type Handlers = { onOpen(): void; onMessage(m: { type: string; data: unknown }): void; onClose(): void };

class FakeLive {
  static all: FakeLive[] = [];
  sent: Array<{ type: string; data: unknown }> = [];
  closed = false;
  constructor(public handlers: Handlers) {
    FakeLive.all.push(this);
  }
  send(type: string, data: unknown) {
    this.sent.push({ type, data });
  }
  close() {
    this.closed = true;
  }
  receive(type: string, data: unknown) {
    this.handlers.onMessage({ type, data });
  }
}

const screenOf = (text: string) => ({ tag: "div", attrs: { class: "janela" }, children: [{ tag: "span", children: [text] }] });

const snapshot = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  hasActiveSession: true,
  session: { id: "s-1", classId: "c-1", title: "Aula", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 2, startedAt: "2026-10-14T10:00:00Z" },
  displayMode: "SLIDES",
  currentSlide: 2,
  activeModuleId: null,
  activeDeck: { id: "d-1", title: "Slides", pageCount: 10, downloadUrl: "https://minio/x" },
  recentDrawings: [{ path: [[1, 2]] }],
  terminal: { screen: screenOf("ls") },
  handRaises: [],
  onlineCount: 3,
  ...over,
});

function setup(role: "teacher" | "student", window?: "panel" | "presenter") {
  FakeLive.all = [];
  const connect = vi.fn((_classId: string, handlers: Handlers, _view?: string) => new FakeLive(handlers));
  const view = renderHook(() => useLiveClassroom({ classId: "c-1", role, view: window, connect: connect as never }));
  const socket = () => FakeLive.all.at(-1)!;
  return { ...view, socket, connect };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// SPEC-051 CA-14: the state of the room comes first, at the first connection and at every reconnection.
describe("useLiveClassroom", () => {
  it("connects, and the snapshot gives the whole state of the room", () => {
    const { result, socket } = setup("student");
    expect(result.current.connected).toBe(false);
    act(() => socket().handlers.onOpen());
    expect(result.current.connected).toBe(true);
    act(() => socket().receive("live:snapshot", snapshot()));
    expect(result.current.room).toMatchObject({ mode: "SLIDES", slide: 2, online: 3, deck: { pageCount: 10 }, strokes: [{ path: [[1, 2]] }] });
    expect(result.current.terminal).toEqual({ screen: screenOf("ls") });
    expect(result.current.ready).toBe(true);
  });

  // CA-05, CA-06, CA-07: what the teacher sends changes what the student shows.
  it("applies the messages of the teacher", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:slide:change", { slide: 5 }));
    expect(result.current.room.slide).toBe(5);
    expect(result.current.room.strokes).toEqual([]);
    act(() => socket().receive("live:cursor:move", { x: 10, y: 20, laser: true, visible: true }));
    expect(result.current.room.cursor).toEqual({ x: 10, y: 20, laser: true, visible: true });
    act(() => socket().receive("live:cursor:move", { x: 0, y: 0, laser: false, visible: false }));
    expect(result.current.room.cursor?.visible).toBe(false);
    act(() => socket().receive("live:canvas:draw", { path: [[3, 4], [5, 6]] }));
    expect(result.current.room.strokes).toHaveLength(1);
    act(() => socket().receive("live:canvas:draw", { clear: true }));
    expect(result.current.room.strokes).toEqual([]);
    act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-1" }));
    expect(result.current.room).toMatchObject({ mode: "MODULE", moduleId: "m-1" });
    act(() => socket().receive("live:presence", { online: 8 }));
    expect(result.current.room.online).toBe(8);
  });

  // SPEC-056 CA-05: who comes in gets the current screen of the teacher with the snapshot
  it("takes the screen of the terminal from the snapshot, and null when there is none", () => {
    const { result, socket } = setup("student");
    expect(result.current.terminal).toEqual({ screen: null });
    act(() => socket().receive("live:snapshot", snapshot({ terminal: { screen: null } })));
    expect(result.current.terminal.screen).toBeNull();
    act(() => socket().receive("live:snapshot", snapshot({ terminal: undefined } as never)));
    expect(result.current.terminal.screen).toBeNull();
    act(() => socket().receive("live:snapshot", snapshot()));
    expect(result.current.terminal.screen).toEqual(screenOf("ls"));
  });

  // SPEC-056 CA-01 to CA-03: each screen of the teacher replaces the last one
  it("keeps the last screen of the terminal that the teacher sent", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:terminal:screen", { screen: screenOf("echo o") }));
    expect(result.current.terminal.screen).toEqual(screenOf("echo o"));
    act(() => socket().receive("live:terminal:screen", { screen: screenOf("echo oi") }));
    expect(result.current.terminal.screen).toEqual(screenOf("echo oi"));
    // What is not a tree is not taken: the screen stays as it was.
    act(() => socket().receive("live:terminal:screen", { screen: "texto solto" }));
    act(() => socket().receive("live:terminal:screen", { screen: null }));
    act(() => socket().receive("live:terminal:screen", {}));
    expect(result.current.terminal.screen).toEqual(screenOf("echo oi"));
  });

  // SPEC-056 CA-09: the copy by commands is gone from the protocol
  it("no longer knows the typing and the commands of the terminal", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:terminal:input", { terminal: 1, line: "echo o" }));
    act(() => socket().receive("live:terminal:sync", { terminal: 1, line: "echo oi", output: "oi", state: { n: 1 } }));
    expect(result.current.terminal).toEqual({ screen: screenOf("ls") });
    for (const gone of ["input", "entries", "state", "revision"]) expect(result.current.terminal).not.toHaveProperty(gone);
    expect(result.current).not.toHaveProperty("sendTerminalInput");
    expect(result.current).not.toHaveProperty("sendTerminalSync");
  });

  // CA-08, CA-09
  it("follows the queue of raised hands", () => {
    const { result, socket } = setup("teacher");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:hand:queue", { queue: [{ studentId: "u-1", name: "Ana", requestedAt: "x" }] }));
    expect(result.current.hands).toEqual([{ studentId: "u-1", name: "Ana", requestedAt: "x" }]);
  });

  // CA-12 and CA-11
  it("knows when the class ended and when another tab took the control", () => {
    const { result, socket } = setup("teacher");
    act(() => socket().receive("live:control:revoked", {}));
    expect(result.current.passive).toBe(true);
    act(() => socket().receive("live:ended", {}));
    expect(result.current.ended).toBe(true);
    act(() => socket().handlers.onClose());
    expect(vi.getTimerCount()).toBe(0);
  });

  // The teacher sends and also applies what he sends.
  it("sends the controls of the teacher and applies them to his own screen", () => {
    const { result, socket } = setup("teacher", "presenter");
    act(() => socket().handlers.onOpen());
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => result.current.changeSlide(4));
    expect(socket().sent.at(-1)).toEqual({ type: "live:slide:change", data: { slide: 4 } });
    expect(result.current.room.slide).toBe(4);
    act(() => result.current.moveCursor(1, 2, true));
    expect(socket().sent.at(-1)).toEqual({ type: "live:cursor:move", data: { x: 1, y: 2, laser: true, visible: true } });
    act(() => result.current.moveCursor(0, 0, false, false));
    expect(socket().sent.at(-1)).toEqual({ type: "live:cursor:move", data: { x: 0, y: 0, laser: false, visible: false } });
    act(() => result.current.draw([[1, 1], [2, 2]]));
    expect(socket().sent.at(-1)).toEqual({ type: "live:canvas:draw", data: { path: [[1, 1], [2, 2]] } });
    act(() => result.current.clearDrawings());
    expect(socket().sent.at(-1)).toEqual({ type: "live:canvas:draw", data: { clear: true } });
    expect(result.current.room.strokes).toEqual([]);
    act(() => result.current.switchMode("MODULE", "m-9"));
    expect(socket().sent.at(-1)).toEqual({ type: "live:mode:switch", data: { mode: "MODULE", moduleId: "m-9" } });
  });

  it("lets the panel lower the hands", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().handlers.onOpen());
    act(() => result.current.moderate("u-1"));
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:moderate", data: { studentId: "u-1" } });
    act(() => result.current.moderate());
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:moderate", data: { all: true } });
  });

  it("does not send the controls of the teacher from a student, nor from a tab that lost the control", () => {
    const student = setup("student");
    act(() => student.socket().handlers.onOpen());
    act(() => student.result.current.changeSlide(4));
    act(() => student.result.current.moveCursor(1, 2, false));
    expect(student.socket().sent).toEqual([]);

    const teacher = setup("teacher", "presenter");
    act(() => teacher.socket().handlers.onOpen());
    act(() => teacher.socket().receive("live:control:revoked", {}));
    act(() => teacher.result.current.changeSlide(2));
    expect(teacher.socket().sent).toEqual([]);
  });

  // CA-08
  it("lets a student raise and lower the hand", () => {
    const { result, socket } = setup("student");
    act(() => socket().handlers.onOpen());
    act(() => result.current.raiseHand());
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:raise", data: {} });
    act(() => result.current.lowerHand());
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:lower", data: {} });
  });

  // CA-14: reconnecting asks for nothing, the server sends the snapshot again.
  it("reconnects after the connection drops, with a growing wait, and applies the new snapshot", () => {
    const { result, socket, connect } = setup("student");
    act(() => socket().handlers.onOpen());
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().handlers.onClose());
    expect(result.current.connected).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(connect).toHaveBeenCalledTimes(2);
    act(() => socket().handlers.onClose());
    act(() => vi.advanceTimersByTime(1500));
    expect(connect).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(600));
    expect(connect).toHaveBeenCalledTimes(3);
    act(() => socket().handlers.onOpen());
    act(() => socket().receive("live:snapshot", snapshot({ currentSlide: 7, displayMode: "SLIDES" })));
    expect(result.current.connected).toBe(true);
    expect(result.current.room.slide).toBe(7);
  });

  it("closes the connection when the screen goes away", () => {
    const { unmount, socket } = setup("student");
    const first = socket();
    unmount();
    expect(first.closed).toBe(true);
    act(() => vi.advanceTimersByTime(20_000));
    expect(FakeLive.all).toHaveLength(1);
  });

  // SPEC-054 CA-01 to CA-04: the room of waiting
  describe("admission", () => {
    it("knows the student waits, is in the class or was removed", () => {
      const { result, socket } = setup("student");
      expect(result.current.admission).toBeNull();
      act(() => socket().receive("live:admission:state", { status: "WAITING" }));
      expect(result.current.admission).toBe("WAITING");
      expect(result.current.ready).toBe(false);
      act(() => socket().receive("live:admission:state", { status: "ADMITTED" }));
      act(() => socket().receive("live:snapshot", snapshot()));
      expect(result.current.admission).toBe("ADMITTED");
      expect(result.current.ready).toBe(true);
      act(() => socket().receive("live:admission:state", { status: "REMOVED" }));
      expect(result.current.admission).toBe("REMOVED");
    });

    it("gives the teacher who waits and who is in the class, from the queue and from the snapshot", () => {
      const { result, socket } = setup("teacher");
      const waiting = [{ studentId: "u-1", name: "Ana", requestedAt: "2026-10-14T10:00:00Z" }];
      const admitted = [{ studentId: "u-2", name: "Bruno" }];
      act(() => socket().receive("live:snapshot", snapshot({ admissions: { waiting, admitted } } as never)));
      expect(result.current.admissions).toEqual({ waiting, admitted });
      act(() => socket().receive("live:admission:queue", { waiting: [], admitted: [...admitted, { studentId: "u-1", name: "Ana" }] }));
      expect(result.current.admissions.waiting).toEqual([]);
      expect(result.current.admissions.admitted).toHaveLength(2);
    });

    it("lets only the teacher accept, accept all and remove", () => {
      const teacher = setup("teacher");
      act(() => teacher.socket().handlers.onOpen());
      act(() => teacher.result.current.acceptStudent("u-1"));
      expect(teacher.socket().sent.at(-1)).toEqual({ type: "live:admission:accept", data: { studentId: "u-1" } });
      act(() => teacher.result.current.acceptAll());
      expect(teacher.socket().sent.at(-1)).toEqual({ type: "live:admission:accept-all", data: {} });
      act(() => teacher.result.current.removeStudent("u-2"));
      expect(teacher.socket().sent.at(-1)).toEqual({ type: "live:admission:remove", data: { studentId: "u-2" } });

      const student = setup("student");
      act(() => student.socket().handlers.onOpen());
      act(() => student.result.current.acceptStudent("u-1"));
      act(() => student.result.current.acceptAll());
      act(() => student.result.current.removeStudent("u-2"));
      expect(student.socket().sent).toEqual([]);
    });

    it("asks to come in again with a request message, without reconnecting", () => {
      const { result, socket, connect } = setup("student");
      act(() => socket().handlers.onOpen());
      act(() => socket().receive("live:admission:state", { status: "REMOVED" }));
      act(() => result.current.requestEntry());
      expect(socket().sent.at(-1)).toEqual({ type: "live:admission:request", data: {} });
      expect(connect).toHaveBeenCalledTimes(1);
      act(() => socket().receive("live:admission:state", { status: "WAITING" }));
      expect(result.current.admission).toBe("WAITING");
    });
  });

  // SPEC-054 CA-10 (focus) and SPEC-055 RN-04: the module in focus, and no switch for the terminal any more
  describe("module and focus", () => {
    it("takes the module and the block in focus from the snapshot and from the messages", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-3", moduleFocusBlockId: "b-2" } as never)));
      expect(result.current.room).toMatchObject({ mode: "MODULE", moduleId: "m-3", moduleFocusBlockId: "b-2" });
      expect(result.current.room).not.toHaveProperty("terminalBroadcast");
      act(() => socket().receive("live:module:focus", { blockId: "b-5" }));
      expect(result.current.room.moduleFocusBlockId).toBe("b-5");
      act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-4" }));
      expect(result.current.room.moduleFocusBlockId).toBeNull();
    });

    it("does not know the message that switched the broadcast of the terminal", () => {
      const { result, socket } = setup("teacher", "presenter");
      expect(result.current).not.toHaveProperty("setTerminalBroadcast");
      act(() => socket().receive("live:snapshot", snapshot()));
      act(() => socket().receive("live:terminal:broadcast", { enabled: true }));
      expect(result.current.room).not.toHaveProperty("terminalBroadcast");
    });

    it("sends the focus from any of the two windows and applies it to his own screen", () => {
      for (const window of ["panel", "presenter"] as const) {
        const { result, socket } = setup("teacher", window);
        act(() => socket().handlers.onOpen());
        act(() => socket().receive("live:snapshot", snapshot()));
        act(() => result.current.focusBlock("b-7"));
        expect(socket().sent.at(-1)).toEqual({ type: "live:module:focus", data: { blockId: "b-7" } });
        expect(result.current.room.moduleFocusBlockId).toBe("b-7");
      }
    });

    it("does not let a student send the focus", () => {
      const student = setup("student");
      act(() => student.socket().handlers.onOpen());
      act(() => student.result.current.focusBlock("b-1"));
      expect(student.socket().sent).toEqual([]);
    });
  });

  // SPEC-055 RN-01: the window of the teacher is told to the server
  describe("the two windows of the teacher", () => {
    it("connects as the panel by default and as the presenter when asked, and the student asks for no window", () => {
      expect(setup("teacher").connect.mock.calls[0]![2]).toBe("panel");
      expect(setup("teacher", "presenter").connect.mock.calls[0]![2]).toBe("presenter");
      expect(setup("student").connect.mock.calls[0]![2]).toBeUndefined();
    });

    // RN-02: who sends what
    it("lets only the presenter send the messages of the stage", () => {
      const panel = setup("teacher", "panel");
      act(() => panel.socket().handlers.onOpen());
      act(() => panel.result.current.moveCursor(1, 2, true));
      act(() => panel.result.current.draw([[1, 1], [2, 2]]));
      act(() => panel.result.current.clearDrawings());
      act(() => panel.result.current.sendTerminalScreen(screenOf("l") as never));
      act(() => panel.result.current.setBlank(true));
      expect(panel.socket().sent).toEqual([]);

      const presenter = setup("teacher", "presenter");
      act(() => presenter.socket().handlers.onOpen());
      act(() => presenter.result.current.sendTerminalScreen(screenOf("ls") as never));
      expect(presenter.socket().sent.at(-1)).toEqual({ type: "live:terminal:screen", data: { screen: screenOf("ls") } });
    });

    // SPEC-056 CA-08: a student, or a tab that lost the control, never sends a screen
    it("does not send the screen of the terminal from a student, nor from a presenter that lost the control", () => {
      const student = setup("student");
      act(() => student.socket().handlers.onOpen());
      act(() => student.result.current.sendTerminalScreen(screenOf("x") as never));
      expect(student.socket().sent).toEqual([]);

      const presenter = setup("teacher", "presenter");
      act(() => presenter.socket().handlers.onOpen());
      act(() => presenter.socket().receive("live:control:revoked", {}));
      act(() => presenter.result.current.sendTerminalScreen(screenOf("x") as never));
      expect(presenter.socket().sent).toEqual([]);
    });

    // SPEC-056 section 4: the server keeps the screen in memory only, so the presenter window tells the whole screen again at every connection
    it("tells the last screen again when the presenter connects, or connects again, because a message sent before that is lost", () => {
      const { result, socket } = setup("teacher", "presenter");
      act(() => result.current.sendTerminalScreen(screenOf("antes de conectar") as never));
      // The fake socket records what it is given even when closed; the real one drops it, which is why the screen is told again on open.
      const sentBeforeOpen = socket().sent.length;
      act(() => socket().handlers.onOpen());
      expect(socket().sent.slice(sentBeforeOpen)).toEqual([{ type: "live:terminal:screen", data: { screen: screenOf("antes de conectar") } }]);

      act(() => result.current.sendTerminalScreen(screenOf("a ultima") as never));
      act(() => socket().handlers.onClose());
      act(() => vi.advanceTimersByTime(1000));
      const again = socket();
      expect(again.sent).toEqual([]);
      act(() => again.handlers.onOpen());
      expect(again.sent).toEqual([{ type: "live:terminal:screen", data: { screen: screenOf("a ultima") } }]);
    });

    it("tells nothing at the connection when there is no screen yet, and the panel never tells one", () => {
      const presenter = setup("teacher", "presenter");
      act(() => presenter.socket().handlers.onOpen());
      expect(presenter.socket().sent).toEqual([]);
      const panel = setup("teacher", "panel");
      act(() => panel.result.current.sendTerminalScreen(screenOf("x") as never));
      act(() => panel.socket().handlers.onOpen());
      expect(panel.socket().sent).toEqual([]);
    });

    it("lets both windows change the slide and the mode", () => {
      for (const window of ["panel", "presenter"] as const) {
        const { result, socket } = setup("teacher", window);
        act(() => socket().handlers.onOpen());
        act(() => result.current.changeSlide(3));
        expect(socket().sent.at(-1)).toEqual({ type: "live:slide:change", data: { slide: 3 } });
        act(() => result.current.switchMode("SLIDES"));
        expect(socket().sent.at(-1)).toEqual({ type: "live:mode:switch", data: { mode: "SLIDES" } });
      }
    });

    it("lets only the panel handle the waiting room", () => {
      const presenter = setup("teacher", "presenter");
      act(() => presenter.socket().handlers.onOpen());
      act(() => presenter.result.current.acceptStudent("u-1"));
      act(() => presenter.result.current.acceptAll());
      act(() => presenter.result.current.removeStudent("u-1"));
      act(() => presenter.result.current.moderate());
      expect(presenter.socket().sent).toEqual([]);
    });

    // RN-05, CA-09
    it("knows the start of the class and whether the presenter window is connected, from the snapshot and from the messages", () => {
      const { result, socket } = setup("teacher", "panel");
      expect(result.current.presenterConnected).toBe(false);
      act(() => socket().receive("live:snapshot", snapshot({ startedAt: "2026-10-14T10:00:00Z", presenterConnected: true } as never)));
      expect(result.current.startedAt).toBe("2026-10-14T10:00:00Z");
      expect(result.current.presenterConnected).toBe(true);
      act(() => socket().receive("live:presenter:state", { connected: false }));
      expect(result.current.presenterConnected).toBe(false);
      act(() => socket().receive("live:presence", { online: 4, presenterConnected: true }));
      expect(result.current.presenterConnected).toBe(true);
      expect(result.current.room.online).toBe(4);
      act(() => socket().receive("live:presence", { online: 5 }));
      expect(result.current.presenterConnected).toBe(true);
    });

    // CA-17: the blank screen
    it("follows the blank screen of the stage, and only the presenter sends it", () => {
      const student = setup("student");
      expect(student.result.current.room.blank).toBe(false);
      act(() => student.socket().receive("live:snapshot", snapshot({ stageBlank: true } as never)));
      expect(student.result.current.room.blank).toBe(true);
      act(() => student.socket().receive("live:stage:blank", { blank: false }));
      expect(student.result.current.room.blank).toBe(false);

      const presenter = setup("teacher", "presenter");
      act(() => presenter.socket().handlers.onOpen());
      act(() => presenter.result.current.setBlank(true));
      expect(presenter.socket().sent.at(-1)).toEqual({ type: "live:stage:blank", data: { blank: true } });
      expect(presenter.result.current.room.blank).toBe(true);
    });
  });

  // SPEC-057: the scroll of the slide and of the material and the divider of the module follow the teacher
  describe("the stage view", () => {
    const NONE = { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {} };
    const view = (over: Record<string, unknown> = {}) => ({ slideScroll: 0.25, slideScrollX: 0.1, materialScroll: 0.5, split: 0.6, zoom: 1.5, selection: null, terminalScroll: { "1": 0.2 }, ...over });
    const scrolls = (sent: Array<{ type: string; data: unknown }>) => sent.filter((m) => m.type === "live:stage:scroll");

    // CA-08: who comes in, or connects again, sees where the teacher is without waiting for him
    it("starts with nothing scrolled and the default divider, and takes the view from the snapshot", () => {
      const { result, socket } = setup("student");
      expect(result.current.stageView).toEqual(NONE);
      act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
      expect(result.current.stageView).toEqual(view());
    });

    it("takes the default view from a snapshot that has none, or has a divider that is null", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
      act(() => socket().receive("live:snapshot", snapshot()));
      expect(result.current.stageView).toEqual(NONE);
      act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ split: null }) } as never)));
      expect(result.current.stageView.split).toBeNull();
    });

    // CA-04, CA-07
    it("follows the scroll of the slide, the scroll of the material and the divider", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot()));
      act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.4 }));
      expect(result.current.stageView).toEqual({ ...NONE, slideScroll: 0.4 });
      act(() => socket().receive("live:stage:scroll", { pane: "material", y: 0.75 }));
      expect(result.current.stageView).toEqual({ ...NONE, slideScroll: 0.4, materialScroll: 0.75 });
      act(() => socket().receive("live:stage:split", { ratio: 0.35 }));
      expect(result.current.stageView).toEqual({ ...NONE, slideScroll: 0.4, materialScroll: 0.75, split: 0.35 });
    });

    it("does not take what is not a scroll or a divider", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
      const same = result.current.stageView;
      expect(same).toEqual(view());
      for (const data of [{ pane: "other", y: 0.1 }, { pane: "slide", y: "x" }, { pane: "slide", y: Number.NaN }, { pane: "slide" }, {}, null]) {
        act(() => socket().receive("live:stage:scroll", data));
      }
      for (const data of [{ ratio: "x" }, { ratio: Number.NaN }, {}, null]) act(() => socket().receive("live:stage:split", data));
      expect(result.current.stageView).toEqual(same);
    });

    it("keeps the scroll between 0 and 1 and the divider between 0.2 and 0.8", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 3 }));
      expect(result.current.stageView.slideScroll).toBe(1);
      act(() => socket().receive("live:stage:scroll", { pane: "material", y: -2 }));
      expect(result.current.stageView.materialScroll).toBe(0);
      act(() => socket().receive("live:stage:split", { ratio: 0.95 }));
      expect(result.current.stageView.split).toBe(0.8);
      act(() => socket().receive("live:stage:split", { ratio: 0.01 }));
      expect(result.current.stageView.split).toBe(0.2);
    });

    // CA-05: the server tells no restart, each client does it
    it("takes the scroll of the slide back to the top when the slide changes, and leaves the others alone", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
      act(() => socket().receive("live:slide:change", { slide: 3 }));
      expect(result.current.stageView).toEqual(view({ slideScroll: 0, slideScrollX: 0 }));
    });

    it("takes the scroll of the material back to the top when the module changes, and keeps it when it does not", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1", stageView: view() } as never)));
      act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-1" }));
      expect(result.current.stageView).toEqual(view());
      act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-2" }));
      expect(result.current.stageView).toEqual(view({ materialScroll: 0, terminalScroll: {} }));
    });

    it("keeps the scroll of the material when the teacher goes to the slides and back to the same module, as the server does", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1", stageView: view() } as never)));
      act(() => socket().receive("live:mode:switch", { mode: "SLIDES" }));
      expect(result.current.room.moduleId).toBe("m-1");
      act(() => socket().receive("live:stage:scroll", { pane: "material", y: 0.9 }));
      act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-1" }));
      expect(result.current.stageView.materialScroll).toBe(0.9);
      act(() => socket().receive("live:mode:switch", { mode: "SLIDES" }));
      act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-2" }));
      expect(result.current.stageView.materialScroll).toBe(0);
    });

    it("applies the restart to the teacher's own screen when he changes the slide or the module", () => {
      const { result, socket } = setup("teacher", "presenter");
      act(() => socket().handlers.onOpen());
      act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
      act(() => result.current.changeSlide(4));
      expect(result.current.stageView.slideScroll).toBe(0);
      act(() => result.current.switchMode("MODULE", "m-9"));
      expect(result.current.stageView.materialScroll).toBe(0);
    });

    // CA-17: with the zoom the page rolls both ways, and the horizontal place is the teacher's too
    describe("the horizontal scroll of the slide", () => {
      it("follows the horizontal place the teacher tells with the vertical one, and takes it as 0 when it is not told", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.4, x: 0.3 }));
        expect(result.current.stageView).toMatchObject({ slideScroll: 0.4, slideScrollX: 0.3 });
        act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.5 }));
        expect(result.current.stageView).toMatchObject({ slideScroll: 0.5, slideScrollX: 0 });
      });

      it("keeps the horizontal place between 0 and 1, and does not take a message with a horizontal place that is not a number", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.1, x: 7 }));
        expect(result.current.stageView.slideScrollX).toBe(1);
        act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.2, x: -1 }));
        expect(result.current.stageView.slideScrollX).toBe(0);
        act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.3, x: 0.6 }));
        for (const x of ["a", Number.NaN, null]) act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.9, x }));
        expect(result.current.stageView).toMatchObject({ slideScroll: 0.3, slideScrollX: 0.6 });
      });

      it("has no horizontal place for the material", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:scroll", { pane: "slide", y: 0.1, x: 0.4 }));
        act(() => socket().receive("live:stage:scroll", { pane: "material", y: 0.7, x: 0.9 }));
        expect(result.current.stageView).toMatchObject({ slideScroll: 0.1, slideScrollX: 0.4, materialScroll: 0.7 });
      });

      it("takes the horizontal place of the snapshot, and 0 when it has none", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ slideScrollX: 0.8 }) } as never)));
        expect(result.current.stageView.slideScrollX).toBe(0.8);
        act(() => socket().receive("live:snapshot", snapshot({ stageView: { slideScroll: 0.2, materialScroll: 0, split: null } } as never)));
        expect(result.current.stageView.slideScrollX).toBe(0);
      });

      it("goes back to the left with the top when the slide changes", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
        act(() => socket().receive("live:slide:change", { slide: 3 }));
        expect(result.current.stageView).toMatchObject({ slideScroll: 0, slideScrollX: 0 });
      });
    });

    // CA-15, CA-18: the zoom of the teacher, which the students only follow
    describe("the zoom", () => {
      it("starts at 100%, takes the zoom from the snapshot, and follows the teacher", () => {
        const { result, socket } = setup("student");
        expect(result.current.stageView.zoom).toBe(1);
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ zoom: 1.75 }) } as never)));
        expect(result.current.stageView.zoom).toBe(1.75);
        act(() => socket().receive("live:stage:zoom", { zoom: 1.25 }));
        expect(result.current.stageView.zoom).toBe(1.25);
      });

      it("takes 100% from a snapshot that has no zoom", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ zoom: 2 }) } as never)));
        act(() => socket().receive("live:snapshot", snapshot()));
        expect(result.current.stageView.zoom).toBe(1);
      });

      it("keeps the zoom between 1 and 2, and does not take what is not a number", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:zoom", { zoom: 9 }));
        expect(result.current.stageView.zoom).toBe(2);
        act(() => socket().receive("live:stage:zoom", { zoom: 0.2 }));
        expect(result.current.stageView.zoom).toBe(1);
        act(() => socket().receive("live:stage:zoom", { zoom: 1.5 }));
        for (const data of [{ zoom: "x" }, { zoom: Number.NaN }, { zoom: null }, {}, null]) act(() => socket().receive("live:stage:zoom", data));
        expect(result.current.stageView.zoom).toBe(1.5);
      });

      it("is not taken back to 100% by a new slide, a new module, or a new mode", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1", stageView: view({ zoom: 1.5 }) } as never)));
        act(() => socket().receive("live:slide:change", { slide: 4 }));
        act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-2" }));
        act(() => socket().receive("live:mode:switch", { mode: "SLIDES" }));
        expect(result.current.stageView.zoom).toBe(1.5);
      });

      it("has no way for a student to change it", () => {
        const student = setup("student");
        act(() => student.socket().handlers.onOpen());
        act(() => student.result.current.sendStageZoom(1.5));
        expect(student.socket().sent).toEqual([]);
        expect(student.result.current.stageView.zoom).toBe(1);
      });
    });

    // CA-20, CA-21: the stretch of text the teacher selected, which is marked on the screens of the students
    describe("the selection of the teacher", () => {
      const material = { pane: "material", start: { block: "b-1", offset: 2 }, end: { block: "b-2", offset: 5 } };
      const terminal = { pane: "terminal", terminal: 2, start: 10, end: 14 };

      it("starts with no selection, and takes the one of the snapshot, for who comes in or connects again", () => {
        const { result, socket } = setup("student");
        expect(result.current.stageView.selection).toBeNull();
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ selection: material }) } as never)));
        expect(result.current.stageView.selection).toEqual(material);
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ selection: terminal }) } as never)));
        expect(result.current.stageView.selection).toEqual(terminal);
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
        expect(result.current.stageView.selection).toBeNull();
      });

      it("follows the selection of the material and of the terminal, and the one that clears it", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:selection", material));
        expect(result.current.stageView.selection).toEqual(material);
        act(() => socket().receive("live:stage:selection", terminal));
        expect(result.current.stageView.selection).toEqual(terminal);
        act(() => socket().receive("live:stage:selection", { clear: true }));
        expect(result.current.stageView.selection).toBeNull();
      });

      it("does not take a selection that is not well formed", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:selection", material));
        const bad = [
          null,
          {},
          { clear: false },
          { pane: "other", start: 0, end: 1 },
          { pane: "material" },
          { pane: "material", start: { block: "b", offset: 1 } },
          { pane: "material", start: { block: "", offset: 1 }, end: { block: "b", offset: 2 } },
          { pane: "material", start: { block: "b", offset: -1 }, end: { block: "b", offset: 2 } },
          { pane: "material", start: { block: "b", offset: 1.5 }, end: { block: "b", offset: 2 } },
          { pane: "material", start: { block: 7, offset: 1 }, end: { block: "b", offset: 2 } },
          { pane: "terminal", terminal: 0, start: 1, end: 2 },
          { pane: "terminal", terminal: 4, start: 1, end: 2 },
          { pane: "terminal", terminal: 1, start: 5, end: 2 },
          { pane: "terminal", terminal: 1, start: "a", end: 2 },
          { pane: "terminal", terminal: 1, start: 1, end: Number.NaN },
          { pane: "terminal", terminal: 1, start: -1, end: 2 },
        ];
        for (const data of bad) act(() => socket().receive("live:stage:selection", data));
        expect(result.current.stageView.selection).toEqual(material);
      });

      it("is cleared when the module changes, and kept when it does not, or when the slide changes", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1", stageView: view({ selection: material }) } as never)));
        act(() => socket().receive("live:slide:change", { slide: 3 }));
        act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-1" }));
        expect(result.current.stageView.selection).toEqual(material);
        act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-2" }));
        expect(result.current.stageView.selection).toBeNull();
      });

      describe("sending", () => {
        function presenter() {
          const h = setup("teacher", "presenter");
          act(() => h.socket().handlers.onOpen());
          return h;
        }
        const selections = (sent: Array<{ type: string; data: unknown }>) => sent.filter((m) => m.type === "live:stage:selection").map((m) => m.data);

        it("lets only the presentation window tell it", () => {
          const panel = setup("teacher", "panel");
          const panelSocket = panel.socket();
          act(() => panelSocket.handlers.onOpen());
          act(() => panel.result.current.sendStageSelection(material as never));
          const student = setup("student");
          const studentSocket = student.socket();
          act(() => studentSocket.handlers.onOpen());
          act(() => student.result.current.sendStageSelection(material as never));
          const lost = presenter();
          const lostSocket = lost.socket();
          act(() => lostSocket.receive("live:control:revoked", {}));
          act(() => lost.result.current.sendStageSelection(material as never));
          act(() => vi.advanceTimersByTime(1000));
          for (const sent of [panelSocket.sent, studentSocket.sent, lostSocket.sent]) expect(sent).toEqual([]);
        });

        it("tells the selection as the contract says, and the clear as {clear: true}", () => {
          const { result, socket } = presenter();
          act(() => result.current.sendStageSelection(material as never));
          expect(socket().sent.at(-1)).toEqual({ type: "live:stage:selection", data: material });
          act(() => vi.advanceTimersByTime(150));
          act(() => result.current.sendStageSelection(terminal as never));
          expect(socket().sent.at(-1)).toEqual({ type: "live:stage:selection", data: terminal });
          act(() => vi.advanceTimersByTime(150));
          act(() => result.current.sendStageSelection(null));
          expect(socket().sent.at(-1)).toEqual({ type: "live:stage:selection", data: { clear: true } });
        });

        it("tells at most ten a second while the teacher drags, and the last one always arrives", () => {
          const { result, socket } = presenter();
          const at = (end: number) => ({ pane: "terminal", terminal: 1, start: 0, end });
          act(() => result.current.sendStageSelection(at(1) as never));
          for (let end = 2; end <= 9; end++) {
            act(() => vi.advanceTimersByTime(10));
            act(() => result.current.sendStageSelection(at(end) as never));
          }
          expect(selections(socket().sent)).toHaveLength(1);
          act(() => vi.advanceTimersByTime(100));
          expect(selections(socket().sent)).toEqual([at(1), at(9)]);
        });

        it("tells only what changed, and nothing to clear when there is nothing selected", () => {
          const { result, socket } = presenter();
          act(() => result.current.sendStageSelection(null));
          act(() => result.current.sendStageSelection(material as never));
          act(() => vi.advanceTimersByTime(200));
          act(() => result.current.sendStageSelection({ ...material } as never));
          act(() => vi.advanceTimersByTime(200));
          expect(selections(socket().sent)).toEqual([material]);
          act(() => result.current.sendStageSelection(null));
          act(() => vi.advanceTimersByTime(200));
          act(() => result.current.sendStageSelection(null));
          act(() => vi.advanceTimersByTime(200));
          expect(selections(socket().sent)).toEqual([material, { clear: true }]);
        });

        it("drops a selection that was waiting when the module changes, which the server clears, and counts it as told", () => {
          const { result, socket } = presenter();
          act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1" } as never)));
          act(() => result.current.sendStageSelection(material as never));
          act(() => result.current.sendStageSelection(terminal as never));
          act(() => result.current.switchMode("MODULE", "m-2"));
          act(() => vi.advanceTimersByTime(300));
          expect(selections(socket().sent)).toEqual([material]);
          // The room has no selection now: telling that it is cleared is nothing new.
          act(() => result.current.sendStageSelection(null));
          act(() => vi.advanceTimersByTime(300));
          expect(selections(socket().sent)).toEqual([material]);
        });

        it("does not show his own selection to himself: the teacher has the real one", () => {
          const { result } = presenter();
          act(() => result.current.sendStageSelection(material as never));
          expect(result.current.stageView.selection).toBeNull();
        });

        it("leaves no timer behind when the window goes away", () => {
          const { result, unmount } = presenter();
          act(() => result.current.sendStageSelection(material as never));
          act(() => result.current.sendStageSelection(terminal as never));
          unmount();
          expect(vi.getTimerCount()).toBe(0);
        });
      });
    });

    // SPEC-057 CA-23: the scroll of the history of each terminal is the teacher's too, and the students follow it
    describe("the scroll of the terminals", () => {
      const terminalScrolls = (sent: Array<{ type: string; data: unknown }>) => sent.filter((m) => m.type === "live:stage:scroll" && (m.data as { pane: string }).pane === "terminal").map((m) => m.data);

      it("starts with no terminal scrolled, and takes the places of the snapshot, for who comes in or connects again", () => {
        const { result, socket } = setup("student");
        expect(result.current.stageView.terminalScroll).toEqual({});
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ terminalScroll: { "1": 0.25, "3": 0.75 } }) } as never)));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 0.25, "3": 0.75 });
        act(() => socket().receive("live:snapshot", snapshot()));
        expect(result.current.stageView.terminalScroll).toEqual({});
      });

      it("takes only the places of terminals 1 to 3, between 0 and 1, from a snapshot", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ terminalScroll: { "1": 4, "2": -1, "4": 0.5, "0": 0.5, x: 0.5, "3": "a" } }) } as never)));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 1, "2": 0 });
        for (const bad of [null, "x", [0.5], 7]) act(() => socket().receive("live:snapshot", snapshot({ stageView: view({ terminalScroll: bad }) } as never)));
        expect(result.current.stageView.terminalScroll).toEqual({});
      });

      it("follows the place of each terminal the teacher scrolls, and keeps the others", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:scroll", { pane: "terminal", terminal: 2, y: 0.4 }));
        expect(result.current.stageView.terminalScroll).toEqual({ "2": 0.4 });
        act(() => socket().receive("live:stage:scroll", { pane: "terminal", terminal: 1, y: 1 }));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 1, "2": 0.4 });
        act(() => socket().receive("live:stage:scroll", { pane: "terminal", terminal: 2, y: 0.9 }));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 1, "2": 0.9 });
      });

      it("leaves the scroll of the slide and of the material alone", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ stageView: view() } as never)));
        act(() => socket().receive("live:stage:scroll", { pane: "terminal", terminal: 1, y: 0.7 }));
        expect(result.current.stageView).toMatchObject({ slideScroll: 0.25, slideScrollX: 0.1, materialScroll: 0.5 });
      });

      it("keeps the place between 0 and 1, and does not take a terminal that does not exist or a place that is not a number", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:stage:scroll", { pane: "terminal", terminal: 1, y: 9 }));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 1 });
        act(() => socket().receive("live:stage:scroll", { pane: "terminal", terminal: 1, y: -9 }));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 0 });
        const bad = [
          { pane: "terminal", y: 0.5 },
          { pane: "terminal", terminal: 0, y: 0.5 },
          { pane: "terminal", terminal: 4, y: 0.5 },
          { pane: "terminal", terminal: 1.5, y: 0.5 },
          { pane: "terminal", terminal: "2", y: 0.5 },
          { pane: "terminal", terminal: 2 },
          { pane: "terminal", terminal: 2, y: "a" },
          { pane: "terminal", terminal: 2, y: Number.NaN },
        ];
        for (const data of bad) act(() => socket().receive("live:stage:scroll", data));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 0 });
      });

      it("is kept when the slide changes, and cleared when the module changes, because the new module has new terminals", () => {
        const { result, socket } = setup("student");
        act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1", stageView: view({ terminalScroll: { "1": 0.3 } }) } as never)));
        act(() => socket().receive("live:slide:change", { slide: 3 }));
        act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-1" }));
        expect(result.current.stageView.terminalScroll).toEqual({ "1": 0.3 });
        act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-2" }));
        expect(result.current.stageView.terminalScroll).toEqual({});
      });

      describe("sending", () => {
        function presenter() {
          const h = setup("teacher", "presenter");
          act(() => h.socket().handlers.onOpen());
          return h;
        }

        it("lets only the presentation window tell it", () => {
          const panel = setup("teacher", "panel");
          const panelSocket = panel.socket();
          act(() => panelSocket.handlers.onOpen());
          act(() => panel.result.current.sendTerminalScroll(1, 0.5));
          const student = setup("student");
          const studentSocket = student.socket();
          act(() => studentSocket.handlers.onOpen());
          act(() => student.result.current.sendTerminalScroll(1, 0.5));
          const lost = presenter();
          const lostSocket = lost.socket();
          act(() => lostSocket.receive("live:control:revoked", {}));
          act(() => lost.result.current.sendTerminalScroll(1, 0.5));
          act(() => vi.advanceTimersByTime(1000));
          for (const sent of [panelSocket.sent, studentSocket.sent, lostSocket.sent]) expect(sent).toEqual([]);
        });

        it("tells the terminal and the place as the contract says, and nothing else", () => {
          const { result, socket } = presenter();
          act(() => result.current.sendTerminalScroll(2, 0.4));
          expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "terminal", terminal: 2, y: 0.4 } });
        });

        it("keeps the terminal and the place inside what the server takes", () => {
          const { result, socket } = presenter();
          act(() => result.current.sendTerminalScroll(1, -7));
          expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "terminal", terminal: 1, y: 0 } });
          act(() => vi.advanceTimersByTime(150));
          act(() => result.current.sendTerminalScroll(1, 7));
          expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "terminal", terminal: 1, y: 1 } });
          for (const terminal of [0, 4, 1.5, Number.NaN]) act(() => result.current.sendTerminalScroll(terminal, 0.5));
          expect(terminalScrolls(socket().sent)).toHaveLength(2);
        });

        it("does not tell the end when the terminal has not been scrolled: the end is where the history starts, and the room has it", () => {
          const { result, socket } = presenter();
          act(() => result.current.sendTerminalScroll(1, 1));
          act(() => vi.advanceTimersByTime(300));
          expect(terminalScrolls(socket().sent)).toEqual([]);
          act(() => result.current.sendTerminalScroll(1, 0.4));
          act(() => vi.advanceTimersByTime(300));
          act(() => result.current.sendTerminalScroll(1, 1));
          expect(terminalScrolls(socket().sent).at(-1)).toEqual({ pane: "terminal", terminal: 1, y: 1 });
        });

        it("sends at once, then at most every 100 ms, the last place always arrives, and only what changed", () => {
          const { result, socket } = presenter();
          act(() => result.current.sendTerminalScroll(1, 0.1));
          act(() => vi.advanceTimersByTime(30));
          act(() => result.current.sendTerminalScroll(1, 0.2));
          act(() => vi.advanceTimersByTime(30));
          act(() => result.current.sendTerminalScroll(1, 0.3));
          expect(terminalScrolls(socket().sent)).toHaveLength(1);
          act(() => vi.advanceTimersByTime(40));
          expect(terminalScrolls(socket().sent)).toEqual([
            { pane: "terminal", terminal: 1, y: 0.1 },
            { pane: "terminal", terminal: 1, y: 0.3 },
          ]);
          act(() => result.current.sendTerminalScroll(1, 0.3));
          act(() => vi.advanceTimersByTime(500));
          expect(terminalScrolls(socket().sent)).toHaveLength(2);
        });

        it("keeps a pace for each terminal, so one does not hold the other back", () => {
          const { result, socket } = presenter();
          act(() => result.current.sendTerminalScroll(1, 0.1));
          act(() => result.current.sendTerminalScroll(2, 0.2));
          act(() => result.current.sendTerminalScroll(3, 0.3));
          expect(terminalScrolls(socket().sent)).toEqual([
            { pane: "terminal", terminal: 1, y: 0.1 },
            { pane: "terminal", terminal: 2, y: 0.2 },
            { pane: "terminal", terminal: 3, y: 0.3 },
          ]);
        });

        it("drops a place that was waiting when the module changes, and counts the end as told, as the new terminals start at the end", () => {
          const { result, socket } = presenter();
          act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1" } as never)));
          act(() => result.current.sendTerminalScroll(1, 0.5));
          act(() => result.current.sendTerminalScroll(1, 0.7));
          act(() => result.current.switchMode("MODULE", "m-2"));
          act(() => vi.advanceTimersByTime(300));
          expect(terminalScrolls(socket().sent)).toEqual([{ pane: "terminal", terminal: 1, y: 0.5 }]);
          act(() => result.current.sendTerminalScroll(1, 1));
          act(() => vi.advanceTimersByTime(300));
          expect(terminalScrolls(socket().sent)).toHaveLength(1);
          act(() => result.current.sendTerminalScroll(1, 0.4));
          act(() => vi.advanceTimersByTime(300));
          expect(terminalScrolls(socket().sent).at(-1)).toEqual({ pane: "terminal", terminal: 1, y: 0.4 });
        });

        it("does not show his own place to himself: the teacher has the real scroll", () => {
          const { result } = presenter();
          act(() => result.current.sendTerminalScroll(1, 0.4));
          expect(result.current.stageView.terminalScroll).toEqual({});
        });

        it("leaves no timer behind when the window goes away", () => {
          const { result, unmount } = presenter();
          act(() => result.current.sendTerminalScroll(1, 0.1));
          act(() => result.current.sendTerminalScroll(1, 0.2));
          act(() => result.current.sendTerminalScroll(2, 0.1));
          act(() => result.current.sendTerminalScroll(2, 0.2));
          unmount();
          expect(vi.getTimerCount()).toBe(0);
        });
      });
    });

    describe("sending the zoom and the horizontal place", () => {
      function presenter() {
        const h = setup("teacher", "presenter");
        act(() => h.socket().handlers.onOpen());
        return h;
      }

      it("sends the zoom as the contract says, and shows it on the teacher's own stage", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageZoom(1.25));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:zoom", data: { zoom: 1.25 } });
        expect(result.current.stageView.zoom).toBe(1.25);
      });

      it("keeps the zoom it sends between 1 and 2", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageZoom(5));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:zoom", data: { zoom: 2 } });
        act(() => result.current.sendStageZoom(Number.NaN));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:zoom", data: { zoom: 1 } });
      });

      it("lets only the presentation window change the zoom", () => {
        const panel = setup("teacher", "panel");
        const panelSocket = panel.socket();
        act(() => panelSocket.handlers.onOpen());
        act(() => panel.result.current.sendStageZoom(1.5));
        const lost = presenter();
        const lostSocket = lost.socket();
        act(() => lostSocket.receive("live:control:revoked", {}));
        act(() => lost.result.current.sendStageZoom(1.5));
        expect(panelSocket.sent).toEqual([]);
        expect(lostSocket.sent).toEqual([]);
        expect(panel.result.current.stageView.zoom).toBe(1);
      });

      it("sends the horizontal place with the vertical one, and leaves it out when it is 0", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.5, 0.25));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "slide", y: 0.5, x: 0.25 } });
        act(() => vi.advanceTimersByTime(150));
        act(() => result.current.sendStageScroll("slide", 0.6, 0));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "slide", y: 0.6 } });
        act(() => vi.advanceTimersByTime(150));
        act(() => result.current.sendStageScroll("slide", 0.7));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "slide", y: 0.7 } });
      });

      it("tells a change of the horizontal place alone, at the same pace, and only when one of the two changed", () => {
        const { result, socket } = presenter();
        const scrolls = () => socket().sent.filter((m) => m.type === "live:stage:scroll");
        act(() => result.current.sendStageScroll("slide", 0.5, 0.2));
        act(() => result.current.sendStageScroll("slide", 0.5, 0.4));
        act(() => result.current.sendStageScroll("slide", 0.5, 0.6));
        expect(scrolls()).toHaveLength(1);
        act(() => vi.advanceTimersByTime(100));
        expect(scrolls().at(-1)!.data).toEqual({ pane: "slide", y: 0.5, x: 0.6 });
        act(() => result.current.sendStageScroll("slide", 0.5, 0.6));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls()).toHaveLength(2);
      });

      it("takes the horizontal place of the material as none", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("material", 0.5, 0.9));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "material", y: 0.5 } });
      });

      it("drops a position of the old slide, horizontal one included, when the slide changes", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.5, 0.2));
        act(() => result.current.sendStageScroll("slide", 0.7, 0.9));
        act(() => result.current.changeSlide(2));
        act(() => vi.advanceTimersByTime(300));
        expect(socket().sent.filter((m) => m.type === "live:stage:scroll")).toHaveLength(1);
        act(() => result.current.sendStageScroll("slide", 0, 0));
        act(() => vi.advanceTimersByTime(300));
        expect(socket().sent.filter((m) => m.type === "live:stage:scroll")).toHaveLength(1);
      });
    });

    // The pointer is a percentage of the page on the slides and of the stage on the module, so it means nothing in the other mode
    it("takes the pointer away when the mode changes", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot()));
      act(() => socket().receive("live:cursor:move", { x: 40, y: 80, laser: false, visible: true }));
      expect(result.current.room.cursor).not.toBeNull();
      act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-1" }));
      expect(result.current.room.cursor).toBeNull();
      act(() => socket().receive("live:cursor:move", { x: 10, y: 20, laser: true, visible: true }));
      act(() => socket().receive("live:mode:switch", { mode: "SLIDES" }));
      expect(result.current.room.cursor).toBeNull();
    });

    describe("sending", () => {
      function presenter() {
        const h = setup("teacher", "presenter");
        act(() => h.socket().handlers.onOpen());
        return h;
      }

      // CA-09: only the presentation window sends
      it("lets only the presentation window send the scroll and the divider", () => {
        const panel = setup("teacher", "panel");
        const panelSocket = panel.socket();
        act(() => panelSocket.handlers.onOpen());
        act(() => panel.result.current.sendStageScroll("slide", 0.5));
        act(() => panel.result.current.sendStageScroll("material", 0.5));
        act(() => panel.result.current.sendStageSplit(0.5));
        const student = setup("student");
        const studentSocket = student.socket();
        act(() => studentSocket.handlers.onOpen());
        act(() => student.result.current.sendStageScroll("slide", 0.5));
        act(() => student.result.current.sendStageSplit(0.5));
        const lost = presenter();
        const lostSocket = lost.socket();
        act(() => lostSocket.receive("live:control:revoked", {}));
        act(() => lost.result.current.sendStageScroll("slide", 0.5));
        act(() => lost.result.current.sendStageSplit(0.5));
        act(() => vi.advanceTimersByTime(1000));
        for (const sent of [panelSocket.sent, studentSocket.sent, lostSocket.sent]) expect(sent).toEqual([]);
      });

      it("sends the scroll of the slide, the scroll of the material and the divider as the contract says", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.5));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "slide", y: 0.5 } });
        act(() => result.current.sendStageScroll("material", 0.25));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:scroll", data: { pane: "material", y: 0.25 } });
        act(() => result.current.sendStageSplit(0.4));
        expect(socket().sent.at(-1)).toEqual({ type: "live:stage:split", data: { ratio: 0.4 } });
      });

      // CA-04: at most every 100 ms, and the last position always gets there
      it("sends at once, then at most every 100 ms, and the last position always arrives", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.1));
        expect(scrolls(socket().sent)).toHaveLength(1);
        act(() => vi.advanceTimersByTime(30));
        act(() => result.current.sendStageScroll("slide", 0.2));
        act(() => vi.advanceTimersByTime(30));
        act(() => result.current.sendStageScroll("slide", 0.3));
        expect(scrolls(socket().sent)).toHaveLength(1);
        act(() => vi.advanceTimersByTime(39));
        expect(scrolls(socket().sent)).toHaveLength(1);
        act(() => vi.advanceTimersByTime(1));
        expect(scrolls(socket().sent).map((m) => m.data)).toEqual([{ pane: "slide", y: 0.1 }, { pane: "slide", y: 0.3 }]);
        act(() => vi.advanceTimersByTime(500));
        expect(scrolls(socket().sent)).toHaveLength(2);
      });

      it("sends at once when the last one went more than 100 ms ago", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.1));
        act(() => vi.advanceTimersByTime(150));
        act(() => result.current.sendStageScroll("slide", 0.2));
        expect(scrolls(socket().sent)).toHaveLength(2);
      });

      it("sends only what changed", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.5));
        expect(scrolls(socket().sent)).toHaveLength(1);
        // Away and back to the value that already went out, before the wait is over: nothing new to tell.
        act(() => result.current.sendStageScroll("slide", 0.6));
        act(() => result.current.sendStageScroll("slide", 0.5));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls(socket().sent)).toHaveLength(1);
        // The same value again, long after.
        act(() => result.current.sendStageScroll("slide", 0.5));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls(socket().sent)).toHaveLength(1);
      });

      it("does not hold one scroll back for another: the slide, the material and the divider go on their own", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.1));
        act(() => result.current.sendStageScroll("material", 0.2));
        act(() => result.current.sendStageSplit(0.3));
        expect(socket().sent.map((m) => m.type)).toEqual(["live:stage:scroll", "live:stage:scroll", "live:stage:split"]);
      });

      it("sends the divider the same way, every 100 ms at most and only when it changed", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageSplit(0.3));
        act(() => result.current.sendStageSplit(0.31));
        act(() => result.current.sendStageSplit(0.32));
        expect(socket().sent).toHaveLength(1);
        act(() => vi.advanceTimersByTime(100));
        expect(socket().sent.map((m) => m.data)).toEqual([{ ratio: 0.3 }, { ratio: 0.32 }]);
        act(() => result.current.sendStageSplit(0.32));
        act(() => vi.advanceTimersByTime(300));
        expect(socket().sent).toHaveLength(2);
      });

      // The server brings the slide scroll back to 0 at the change, so a position of the old slide must never reach the new one
      it("drops a position of the old slide that was waiting when the slide changes, and counts 0 as told", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.5));
        act(() => result.current.sendStageScroll("slide", 0.7));
        act(() => result.current.changeSlide(2));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls(socket().sent).map((m) => m.data)).toEqual([{ pane: "slide", y: 0.5 }]);
        // The page is at the top, as the server has it: telling 0 is nothing new.
        act(() => result.current.sendStageScroll("slide", 0));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls(socket().sent)).toHaveLength(1);
        act(() => result.current.sendStageScroll("slide", 0.2));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls(socket().sent).at(-1)!.data).toEqual({ pane: "slide", y: 0.2 });
      });

      it("drops a position of the old slide when the other window changes the slide", () => {
        const { result, socket } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.5));
        act(() => result.current.sendStageScroll("slide", 0.7));
        act(() => socket().receive("live:slide:change", { slide: 3 }));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls(socket().sent)).toHaveLength(1);
      });

      it("drops a position of the old module when the module changes", () => {
        const { result, socket } = presenter();
        act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-1" } as never)));
        act(() => result.current.sendStageScroll("material", 0.5));
        act(() => result.current.sendStageScroll("material", 0.7));
        act(() => result.current.switchMode("MODULE", "m-2"));
        act(() => vi.advanceTimersByTime(300));
        expect(scrolls(socket().sent).map((m) => m.data)).toEqual([{ pane: "material", y: 0.5 }]);
        act(() => result.current.sendStageScroll("material", 0.5));
        expect(scrolls(socket().sent)).toHaveLength(2);
      });

      it("leaves no timer behind when the window goes away", () => {
        const { result, unmount } = presenter();
        act(() => result.current.sendStageScroll("slide", 0.1));
        act(() => result.current.sendStageScroll("slide", 0.2));
        act(() => result.current.sendStageSplit(0.3));
        act(() => result.current.sendStageSplit(0.4));
        unmount();
        expect(vi.getTimerCount()).toBe(0);
      });
    });
  });

  // Defect found in use: with the screen mounted twice (React Strict Mode in development, or a quick reload) the first connection was
  // closed but its messages and its close still reached the screen, so the teacher was made passive and the connection was reopened.
  describe("a connection that was replaced", () => {
    function strict(role: "teacher" | "student") {
      FakeLive.all = [];
      const connect = vi.fn((_classId: string, handlers: Handlers) => new FakeLive(handlers));
      const view = renderHook(() => useLiveClassroom({ classId: "c-1", role, connect: connect as never }), { wrapper: StrictMode });
      return { ...view, connect };
    }

    it("does not let the old connection take the control from the teacher", () => {
      const { result } = strict("teacher");
      const [old, current] = [FakeLive.all[0]!, FakeLive.all.at(-1)!];
      expect(old).not.toBe(current);
      expect(old.closed).toBe(true);
      act(() => old.receive("live:control:revoked", {}));
      expect(result.current.canControl).toBe(true);
      act(() => current.receive("live:control:revoked", {}));
      expect(result.current.canControl).toBe(false);
    });

    it("does not reconnect when the old connection closes", () => {
      const { connect } = strict("teacher");
      const old = FakeLive.all[0]!;
      const before = connect.mock.calls.length;
      act(() => old.handlers.onClose());
      act(() => vi.advanceTimersByTime(60_000));
      expect(connect.mock.calls.length).toBe(before);
    });

    it("does not mix up the state of the connection with the one of the old", () => {
      const { result } = strict("student");
      const [old, current] = [FakeLive.all[0]!, FakeLive.all.at(-1)!];
      act(() => old.handlers.onOpen());
      expect(result.current.connected).toBe(false);
      act(() => old.receive("live:ended", {}));
      expect(result.current.ended).toBe(false);
      act(() => current.handlers.onOpen());
      expect(result.current.connected).toBe(true);
    });
  });
});

// SPEC-068 CA-06: the teacher chooses the presentation that is on the stage; the server says which one it is, with its address
describe("useLiveClassroom, the presentation on the stage", () => {
  const picture = { id: "d-2", title: "Esquema", pageCount: 1, kind: "IMAGE", downloadUrl: "https://minio/e.png" };

  it("puts the presentation that the server says on the stage, at the first slide, in the slides mode and with nothing drawn", () => {
    const { result, socket } = setup("student");
    act(() => socket().handlers.onOpen());
    act(() => socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", currentSlide: 4, activeModuleId: "m-1" })));
    expect(result.current.room).toMatchObject({ mode: "MODULE", slide: 4, deck: { id: "d-1" }, strokes: [{ path: [[1, 2]] }] });

    act(() => socket().receive("live:deck:changed", { activeDeck: picture, displayMode: "SLIDES", currentSlide: 1 }));
    expect(result.current.room).toMatchObject({ mode: "SLIDES", slide: 1, deck: picture, strokes: [] });
    expect(result.current.stageView.slideScroll).toBe(0);
  });

  it("lets the panel choose a presentation, and waits for the server to say which one is on the stage", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().handlers.onOpen());
    act(() => socket().receive("live:snapshot", snapshot()));

    act(() => result.current.selectDeck("d-2"));
    expect(socket().sent.at(-1)).toEqual({ type: "live:deck:select", data: { deckId: "d-2" } });
    expect(result.current.room.deck?.id).toBe("d-1");

    act(() => socket().receive("live:deck:changed", { activeDeck: picture, displayMode: "SLIDES", currentSlide: 1 }));
    expect(result.current.room.deck?.id).toBe("d-2");
  });

  it("does not send the choice from a student, nor from the window of the presentation", () => {
    for (const [role, window] of [["student", undefined], ["teacher", "presenter"]] as const) {
      const { result, socket } = setup(role, window);
      act(() => socket().handlers.onOpen());
      act(() => socket().receive("live:snapshot", snapshot()));
      act(() => result.current.selectDeck("d-2"));
      expect(socket().sent.filter((m) => m.type === "live:deck:select")).toEqual([]);
    }
  });
});

// SPEC-071 CA-09: the commands of the teacher go out only from the presenter window, as they ran
describe("commands of the teacher (SPEC-071)", () => {
  const run = { terminal: 1, command: "ls -la", exitStatus: 0, output: "total 0\n", outputTruncated: false };

  it("lets only the presenter send a command", () => {
    const presenter = setup("teacher", "presenter");
    act(() => presenter.socket().handlers.onOpen());
    act(() => presenter.result.current.sendTerminalCommand(run));
    expect(presenter.socket().sent.at(-1)).toEqual({ type: "live:terminal:command", data: run });

    const panel = setup("teacher", "panel");
    act(() => panel.socket().handlers.onOpen());
    act(() => panel.result.current.sendTerminalCommand(run));
    expect(panel.socket().sent).toEqual([]);

    const student = setup("student");
    act(() => student.socket().handlers.onOpen());
    act(() => student.result.current.sendTerminalCommand(run));
    expect(student.socket().sent).toEqual([]);
  });

  it("sends nothing from a presenter that lost the control", () => {
    const presenter = setup("teacher", "presenter");
    act(() => presenter.socket().handlers.onOpen());
    act(() => presenter.socket().receive("live:control:revoked", {}));
    act(() => presenter.result.current.sendTerminalCommand(run));
    expect(presenter.socket().sent.filter((m) => m.type === "live:terminal:command")).toEqual([]);
  });
});
