import { act, renderHook } from "@testing-library/react";
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

const snapshot = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  hasActiveSession: true,
  session: { id: "s-1", classId: "c-1", title: "Aula", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 2, startedAt: "2026-10-14T10:00:00Z" },
  displayMode: "SLIDES",
  currentSlide: 2,
  activeModuleId: null,
  activeDeck: { id: "d-1", title: "Slides", pageCount: 10, downloadUrl: "https://minio/x" },
  recentDrawings: [{ path: [[1, 2]] }],
  terminal: { input: { terminal: 1, line: "ls" }, entries: [], state: { formato: "exame-so/maquina" } },
  handRaises: [],
  onlineCount: 3,
  ...over,
});

function setup(role: "teacher" | "student") {
  FakeLive.all = [];
  const connect = vi.fn((_classId: string, handlers: Handlers) => new FakeLive(handlers));
  const view = renderHook(() => useLiveClassroom({ classId: "c-1", role, connect: connect as never }));
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
    expect(result.current.terminal).toMatchObject({ input: { line: "ls" }, state: { formato: "exame-so/maquina" } });
    expect(result.current.ready).toBe(true);
  });

  // CA-05, CA-06, CA-07: what the teacher sends changes what the student shows.
  it("applies the messages of the teacher", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:slide:change", { slide: 5 }));
    expect(result.current.room.slide).toBe(5);
    expect(result.current.room.strokes).toEqual([]);
    act(() => socket().receive("live:cursor:move", { x: 10, y: 20, laser: true }));
    expect(result.current.room.cursor).toEqual({ x: 10, y: 20, laser: true });
    act(() => socket().receive("live:canvas:draw", { path: [[3, 4], [5, 6]] }));
    expect(result.current.room.strokes).toHaveLength(1);
    act(() => socket().receive("live:canvas:draw", { clear: true }));
    expect(result.current.room.strokes).toEqual([]);
    act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-1" }));
    expect(result.current.room).toMatchObject({ mode: "MODULE", moduleId: "m-1" });
    act(() => socket().receive("live:presence", { online: 8 }));
    expect(result.current.room.online).toBe(8);
  });

  it("keeps the typing and the commands of the terminal", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:terminal:input", { terminal: 1, line: "echo o" }));
    expect(result.current.terminal.input).toEqual({ terminal: 1, line: "echo o" });
    const done = { terminal: 1, line: "echo oi", output: "oi", status: 0, segments: [{ text: "oi\n" }], user: "root", cwd: "/root", state: { n: 1 } };
    act(() => socket().receive("live:terminal:sync", done));
    expect(result.current.terminal.entries.at(-1)).toEqual(done);
    expect(result.current.terminal.state).toEqual({ n: 1 });
    expect(result.current.terminal.input).toBeNull();
    expect(result.current.terminal.revision).toBeGreaterThan(0);
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
    const { result, socket } = setup("teacher");
    act(() => socket().handlers.onOpen());
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => result.current.changeSlide(4));
    expect(socket().sent.at(-1)).toEqual({ type: "live:slide:change", data: { slide: 4 } });
    expect(result.current.room.slide).toBe(4);
    act(() => result.current.moveCursor(1, 2, true));
    expect(socket().sent.at(-1)).toEqual({ type: "live:cursor:move", data: { x: 1, y: 2, laser: true } });
    act(() => result.current.draw([[1, 1], [2, 2]]));
    expect(socket().sent.at(-1)).toEqual({ type: "live:canvas:draw", data: { path: [[1, 1], [2, 2]] } });
    act(() => result.current.clearDrawings());
    expect(socket().sent.at(-1)).toEqual({ type: "live:canvas:draw", data: { clear: true } });
    expect(result.current.room.strokes).toEqual([]);
    act(() => result.current.switchMode("MODULE", "m-9"));
    expect(socket().sent.at(-1)).toEqual({ type: "live:mode:switch", data: { mode: "MODULE", moduleId: "m-9" } });
    act(() => result.current.sendTerminalInput({ terminal: 1, line: "l" }));
    expect(socket().sent.at(-1)).toEqual({ type: "live:terminal:input", data: { terminal: 1, line: "l" } });
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

    const teacher = setup("teacher");
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
      act(() => socket().receive("live:admission:state", { state: "WAITING" }));
      expect(result.current.admission).toBe("WAITING");
      expect(result.current.ready).toBe(false);
      act(() => socket().receive("live:admission:state", { state: "ADMITTED" }));
      act(() => socket().receive("live:snapshot", snapshot()));
      expect(result.current.admission).toBe("ADMITTED");
      expect(result.current.ready).toBe(true);
      act(() => socket().receive("live:admission:state", { state: "REMOVED" }));
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

    it("asks to come in again by opening a new connection", () => {
      const { result, socket, connect } = setup("student");
      act(() => socket().handlers.onOpen());
      act(() => socket().receive("live:admission:state", { state: "REMOVED" }));
      const first = socket();
      act(() => result.current.reconnect());
      expect(first.closed).toBe(true);
      expect(connect).toHaveBeenCalledTimes(2);
    });
  });

  // SPEC-054 CA-10 and CA-11: the module in focus and the broadcast of the terminal
  describe("module and terminal broadcast", () => {
    it("takes the module, the block in focus and the broadcast from the snapshot and from the messages", () => {
      const { result, socket } = setup("student");
      act(() =>
        socket().receive("live:snapshot", snapshot({ displayMode: "MODULE", moduleId: "m-3", moduleFocusBlockId: "b-2", terminalBroadcast: true } as never)),
      );
      expect(result.current.room).toMatchObject({ mode: "MODULE", moduleId: "m-3", moduleFocusBlockId: "b-2", terminalBroadcast: true });
      act(() => socket().receive("live:module:focus", { blockId: "b-5" }));
      expect(result.current.room.moduleFocusBlockId).toBe("b-5");
      act(() => socket().receive("live:terminal:broadcast", { on: false }));
      expect(result.current.room.terminalBroadcast).toBe(false);
      act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-4" }));
      expect(result.current.room.moduleFocusBlockId).toBeNull();
    });

    it("keeps the broadcast off, and no focus, until the teacher says", () => {
      const { result, socket } = setup("teacher");
      act(() => socket().receive("live:snapshot", snapshot()));
      expect(result.current.room).toMatchObject({ terminalBroadcast: false, moduleFocusBlockId: null });
    });

    it("sends the focus and the broadcast of the teacher and applies them to his own screen", () => {
      const { result, socket } = setup("teacher");
      act(() => socket().handlers.onOpen());
      act(() => socket().receive("live:snapshot", snapshot()));
      act(() => result.current.focusBlock("b-7"));
      expect(socket().sent.at(-1)).toEqual({ type: "live:module:focus", data: { blockId: "b-7" } });
      expect(result.current.room.moduleFocusBlockId).toBe("b-7");
      act(() => result.current.setTerminalBroadcast(true));
      expect(socket().sent.at(-1)).toEqual({ type: "live:terminal:broadcast", data: { on: true } });
      expect(result.current.room.terminalBroadcast).toBe(true);
    });

    it("does not let a student, or a tab that lost the control, send them", () => {
      const student = setup("student");
      act(() => student.socket().handlers.onOpen());
      act(() => student.result.current.focusBlock("b-1"));
      act(() => student.result.current.setTerminalBroadcast(true));
      expect(student.socket().sent).toEqual([]);
    });
  });
});
