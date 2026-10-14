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
