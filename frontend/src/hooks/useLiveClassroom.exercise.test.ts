import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSnapshot } from "@/services/classroomService";
import { useLiveClassroom } from "./useLiveClassroom";

type Handlers = { onOpen(): void; onMessage(m: { type: string; data: unknown }): void; onClose(): void };

class FakeLive {
  static all: FakeLive[] = [];
  sent: Array<{ type: string; data: unknown }> = [];
  constructor(public handlers: Handlers) {
    FakeLive.all.push(this);
  }
  send(type: string, data: unknown) {
    this.sent.push({ type, data });
  }
  close() {}
  receive(type: string, data: unknown) {
    this.handlers.onMessage({ type, data });
  }
}

const NOW = new Date("2026-10-14T10:00:00Z");

const snapshot = (over: Record<string, unknown> = {}): LiveSnapshot =>
  ({
    hasActiveSession: true,
    session: { id: "s-1", classId: "c-1", title: "Aula", status: "ACTIVE", displayMode: "MODULE", currentSlide: 1, startedAt: "2026-10-14T09:00:00Z" },
    displayMode: "MODULE",
    currentSlide: 1,
    activeModuleId: "m-1",
    activeDeck: null,
    recentDrawings: [],
    terminal: { screen: null },
    handRaises: [],
    onlineCount: 3,
    ...over,
  }) as LiveSnapshot;

function setup(role: "teacher" | "student", window?: "panel" | "presenter") {
  FakeLive.all = [];
  const connect = vi.fn((_classId: string, handlers: Handlers) => new FakeLive(handlers));
  const view = renderHook(() => useLiveClassroom({ classId: "c-1", role, view: window, connect: connect as never }));
  const socket = () => FakeLive.all.at(-1)!;
  act(() => socket().handlers.onOpen());
  return { ...view, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const started = (over: Record<string, unknown> = {}) => ({
  runId: "r-1",
  blockId: "b-1",
  index: 0,
  title: "Criar uma pasta",
  difficulty: "EASY",
  durationSeconds: 300,
  startedAt: "2026-10-14T10:00:00Z",
  endsAt: "2026-10-14T10:05:00Z",
  now: "2026-10-14T10:00:00Z",
  ...over,
});

const inRoom = (over: Record<string, unknown> = {}) => ({ ...started(), status: "RUNNING", resultVisible: false, now: "2026-10-14T10:00:00Z", ...over });

// SPEC-065 section 3.3: the contract of the live exercise in the hook
describe("useLiveClassroom, the live exercise", () => {
  it("starts with no round, no progress and nobody watched", () => {
    const { result } = setup("student");
    expect(result.current.exercise).toBeNull();
    expect(result.current.exerciseProgress).toEqual({});
    expect(result.current.watchedScreen).toBeNull();
    expect(result.current.watchedByTeacher).toBe(false);
    expect(result.current.watching).toBeNull();
  });

  // CA-12
  it("takes the round of the snapshot, with the result of the student and the clock corrected by the time of the server", () => {
    const { result, socket } = setup("student");
    act(() =>
      socket().receive("live:snapshot", snapshot({ exercise: inRoom({ now: "2026-10-14T10:00:02Z", myResult: { completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 12 } }) })),
    );
    const exercise = result.current.exercise!;
    expect(exercise).toMatchObject({ runId: "r-1", blockId: "b-1", index: 0, title: "Criar uma pasta", difficulty: "EASY", durationSeconds: 300, status: "RUNNING", resultVisible: false });
    expect(exercise.myResult).toEqual({ completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 12 });
    // The server is 2 s ahead of this browser: add it to the clock of the browser to get the time of the server.
    expect(exercise.skewMs).toBe(2000);
  });

  it("takes the progress of each student from the snapshot of the panel, and no progress from the student's", () => {
    const progress = [
      { studentId: "u-1", name: "Ana", met: 1, total: 3, last: "mkdir a", at: "2026-10-14T10:00:30Z", attempts: 0 },
      { studentId: "u-2", name: "Bia", met: 3, total: 3, last: "ls", at: "2026-10-14T10:01:00Z", completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 12, attempts: 1 },
    ];
    const panel = setup("teacher", "panel");
    act(() => panel.socket().receive("live:snapshot", snapshot({ exercise: inRoom({ progress }) })));
    expect(panel.result.current.exerciseProgress["u-1"]).toMatchObject({ met: 1, total: 3, last: "mkdir a" });
    expect(panel.result.current.exerciseProgress["u-2"]).toMatchObject({ completedAt: "2026-10-14T10:01:00Z", points: 12 });
    const student = setup("student");
    act(() => student.socket().receive("live:snapshot", snapshot({ exercise: inRoom({ progress }) })));
    expect(student.result.current.exerciseProgress).toEqual({});
  });

  it("has no round when the snapshot has none, and replaces the old one", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: inRoom() })));
    act(() => socket().receive("live:snapshot", snapshot({ exercise: null })));
    expect(result.current.exercise).toBeNull();
  });

  it("takes the shown result of an ended round with the snapshot", () => {
    const result_ = { runId: "r-1", visible: true, completed: 1, participants: 2, scoreboard: [{ studentId: "u-2", name: "Bia", elapsedSeconds: 60, points: 12 }] };
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: inRoom({ status: "ENDED", endedBy: "TIMER", endedAt: "2026-10-14T10:05:00Z", resultVisible: true, result: result_ }) })));
    expect(result.current.exercise).toMatchObject({ status: "ENDED", endedBy: "TIMER", resultVisible: true });
    expect(result.current.exercise?.result?.scoreboard[0]).toMatchObject({ name: "Bia", points: 12 });
  });

  it("starts a round with the message of the room, clearing what the last one left", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: inRoom({ runId: "old", status: "ENDED", progress: [{ studentId: "u-1", name: "Ana", met: 1, total: 1, last: "", at: "x" }] }) })));
    act(() => socket().receive("live:exercise:started", started()));
    expect(result.current.exercise).toMatchObject({ runId: "r-1", status: "RUNNING", resultVisible: false, myResult: null });
    expect(result.current.exerciseProgress).toEqual({});
    expect(result.current.watchedScreen).toBeNull();
  });

  it("ends the round it knows and ignores the end of another one", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:exercise:started", started()));
    act(() => socket().receive("live:exercise:ended", { runId: "other", by: "TEACHER", endedAt: "2026-10-14T10:02:00Z", now: "2026-10-14T10:02:00Z" }));
    expect(result.current.exercise?.status).toBe("RUNNING");
    act(() => socket().receive("live:exercise:ended", { runId: "r-1", by: "TIMER", endedAt: "2026-10-14T10:05:00Z", now: "2026-10-14T10:05:00Z" }));
    expect(result.current.exercise).toMatchObject({ status: "ENDED", endedBy: "TIMER", endedAt: "2026-10-14T10:05:00Z" });
  });

  it("shows and hides the result of the round with the message of the room", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:exercise:started", started()));
    act(() => socket().receive("live:exercise:ended", { runId: "r-1", by: "TEACHER", endedAt: "x", now: "2026-10-14T10:02:00Z" }));
    const body = { runId: "r-1", visible: true, completed: 2, participants: 3, scoreboard: [{ studentId: "u-1", name: "Ana", elapsedSeconds: 30, points: 14 }] };
    act(() => socket().receive("live:exercise:result", body));
    expect(result.current.exercise).toMatchObject({ resultVisible: true });
    expect(result.current.exercise?.result).toEqual(body);
    act(() => socket().receive("live:exercise:result", { runId: "r-1", visible: false, completed: 2, participants: 3, scoreboard: [] }));
    expect(result.current.exercise?.resultVisible).toBe(false);
    expect(result.current.exercise?.result).toBeUndefined();
  });

  it("ignores a message of a round it does not have", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:exercise:result", { runId: "r-9", visible: true, completed: 0, participants: 0, scoreboard: [] }));
    act(() => socket().receive("live:exercise:ended", { runId: "r-9", by: "TIMER", endedAt: "x", now: "x" }));
    expect(result.current.exercise).toBeNull();
  });

  it("takes only what has the shape of a round: an id, a block, a title, a level and the times", () => {
    const { result, socket } = setup("student");
    for (const bad of [null, "x", {}, { ...started(), runId: "" }, { ...started(), difficulty: "IMPOSSIBLE" }, { ...started(), durationSeconds: "300" }, { ...started(), endsAt: 5 }, { ...started(), title: undefined }]) {
      act(() => socket().receive("live:exercise:started", bad));
    }
    expect(result.current.exercise).toBeNull();
  });

  it("follows the progress and the conclusion of each student, which only the panel is told", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:exercise:started", started()));
    act(() => socket().receive("live:exercise:progress", { runId: "r-1", studentId: "u-1", met: 2, total: 4, last: "mkdir a", at: "2026-10-14T10:00:20Z" }));
    expect(result.current.exerciseProgress["u-1"]).toMatchObject({ met: 2, total: 4, last: "mkdir a", at: "2026-10-14T10:00:20Z" });
    act(() => socket().receive("live:exercise:done", { runId: "r-1", studentId: "u-1", name: "Ana", completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 12, attempts: 2 }));
    expect(result.current.exerciseProgress["u-1"]).toMatchObject({ met: 2, total: 4, name: "Ana", completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 12, attempts: 2 });
    act(() => socket().receive("live:exercise:progress", { runId: "r-1", studentId: "u-1", met: 4, total: 4, last: "ls", at: "2026-10-14T10:01:01Z" }));
    expect(result.current.exerciseProgress["u-1"]).toMatchObject({ met: 4, last: "ls", completedAt: "2026-10-14T10:01:00Z" });
  });

  it("ignores the progress of another round and a progress with no valid numbers", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:exercise:started", started()));
    act(() => socket().receive("live:exercise:progress", { runId: "other", studentId: "u-1", met: 1, total: 2, last: "", at: "x" }));
    act(() => socket().receive("live:exercise:progress", { runId: "r-1", studentId: "u-1", met: "1", total: 2, last: "", at: "x" }));
    act(() => socket().receive("live:exercise:progress", { runId: "r-1", studentId: "u-1", met: 5, total: 2, last: "", at: "x" }));
    expect(result.current.exerciseProgress).toEqual({});
  });

  it("shows the picture of the student the teacher watches, and takes it away when he stops or the round ends", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:exercise:started", started()));
    act(() => result.current.watchStudent("u-1"));
    expect(result.current.watching).toBe("u-1");
    const screen = { tag: "div", children: ["$ ls"] };
    act(() => socket().receive("live:exercise:screen", { studentId: "u-1", screen }));
    expect(result.current.watchedScreen).toEqual({ studentId: "u-1", screen });
    act(() => result.current.watchStudent("u-2"));
    expect(result.current.watching).toBe("u-2");
    expect(result.current.watchedScreen).toBeNull();
    act(() => socket().receive("live:exercise:screen", { studentId: "u-2", screen }));
    act(() => socket().receive("live:exercise:ended", { runId: "r-1", by: "TEACHER", endedAt: "x", now: "2026-10-14T10:02:00Z" }));
    expect(result.current.watchedScreen).toBeNull();
    expect(result.current.watching).toBeNull();
  });

  it("ignores a picture that is not a tree", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:exercise:screen", { studentId: "u-1", screen: "x" }));
    act(() => socket().receive("live:exercise:screen", { studentId: "u-1", screen: [1] }));
    expect(result.current.watchedScreen).toBeNull();
  });

  it("tells the student that the teacher watches him, and when he stops", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:exercise:watch", { on: true }));
    expect(result.current.watchedByTeacher).toBe(true);
    act(() => socket().receive("live:exercise:watch", { on: false }));
    expect(result.current.watchedByTeacher).toBe(false);
    act(() => socket().receive("live:exercise:watch", { on: true }));
    act(() => socket().receive("live:exercise:ended", { runId: "r-1", by: "TIMER", endedAt: "x", now: "x" }));
    expect(result.current.watchedByTeacher).toBe(true);
    act(() => socket().receive("live:exercise:started", started()));
    act(() => socket().receive("live:exercise:ended", { runId: "r-1", by: "TIMER", endedAt: "x", now: "x" }));
    expect(result.current.watchedByTeacher).toBe(false);
  });

  // CA-01: what the panel sends
  describe("the actions of the teacher, from the panel", () => {
    it("starts a round with the block, the exercise and the minutes, and says nothing of the minutes when none is given", () => {
      const { result, socket } = setup("teacher", "panel");
      act(() => result.current.startExercise("b-1", 2, 10));
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:start", data: { blockId: "b-1", index: 2, minutes: 10 } });
      act(() => result.current.startExercise("b-1", 0));
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:start", data: { blockId: "b-1", index: 0 } });
    });

    it("ends the round, shows or hides the result and watches a student or nobody", () => {
      const { result, socket } = setup("teacher", "panel");
      act(() => result.current.endExercise());
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:end", data: {} });
      act(() => result.current.revealExercise(true));
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:reveal", data: { visible: true } });
      act(() => result.current.revealExercise(false));
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:reveal", data: { visible: false } });
      act(() => result.current.watchStudent("u-1"));
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:watch", data: { studentId: "u-1" } });
      act(() => result.current.watchStudent(null));
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:watch", data: { studentId: null } });
    });

    it("sends nothing from the presentation window, from a student or from a teacher who lost the control", () => {
      const presenter = setup("teacher", "presenter");
      act(() => presenter.result.current.startExercise("b-1", 0));
      act(() => presenter.result.current.endExercise());
      expect(presenter.socket().sent).toEqual([]);
      const student = setup("student");
      act(() => student.result.current.startExercise("b-1", 0));
      act(() => student.result.current.endExercise());
      act(() => student.result.current.revealExercise(true));
      act(() => student.result.current.watchStudent("u-1"));
      expect(student.socket().sent).toEqual([]);
      const lost = setup("teacher", "panel");
      act(() => lost.socket().receive("live:control:revoked", {}));
      act(() => lost.result.current.startExercise("b-1", 0));
      expect(lost.socket().sent).toEqual([]);
    });
  });

  describe("the progress and the picture of the student", () => {
    it("sends the progress with the numbers in range and the last command clean and short", () => {
      const { result, socket } = setup("student");
      act(() => void result.current.sendExerciseProgress({ runId: "r-1", met: 2, total: 4, last: "mkdir a" }));
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:progress", data: { runId: "r-1", met: 2, total: 4, last: "mkdir a" } });
      act(() => void result.current.sendExerciseProgress({ runId: "r-1", met: 1, total: 1, last: `ls\u0007${"x".repeat(300)}` }));
      const last = (socket().sent.at(-1)!.data as { last: string }).last;
      expect(last.startsWith("ls")).toBe(true);
      expect(last).not.toContain("\u0007");
      expect(Array.from(last)).toHaveLength(200);
    });

    it("sends no progress out of range, from the teacher, or with the connection down", () => {
      const { result, socket } = setup("student");
      const sent: boolean[] = [];
      act(() => {
        sent.push(result.current.sendExerciseProgress({ runId: "r-1", met: 5, total: 4 }), result.current.sendExerciseProgress({ runId: "r-1", met: -1, total: 4 }), result.current.sendExerciseProgress({ runId: "r-1", met: 1, total: 101 }));
      });
      expect(sent).toEqual([false, false, false]);
      expect(socket().sent).toEqual([]);
      act(() => socket().handlers.onClose());
      let ok = true;
      act(() => void (ok = result.current.sendExerciseProgress({ runId: "r-1", met: 1, total: 4 })));
      expect(ok).toBe(false);
      const teacher = setup("teacher", "panel");
      act(() => void teacher.result.current.sendExerciseProgress({ runId: "r-1", met: 1, total: 4 }));
      expect(teacher.socket().sent).toEqual([]);
    });

    it("sends the picture of the terminal only while the teacher watches the student", () => {
      const { result, socket } = setup("student");
      const screen = { tag: "div", children: ["$ ls"] };
      let sent = true;
      act(() => void (sent = result.current.sendExerciseScreen("r-1", screen)));
      expect(sent).toBe(false);
      expect(socket().sent).toEqual([]);
      act(() => socket().receive("live:exercise:watch", { on: true }));
      act(() => void (sent = result.current.sendExerciseScreen("r-1", screen)));
      expect(sent).toBe(true);
      expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:screen", data: { runId: "r-1", screen } });
      act(() => socket().receive("live:exercise:watch", { on: false }));
      act(() => void (sent = result.current.sendExerciseScreen("r-1", screen)));
      expect(sent).toBe(false);
    });
  });
});
