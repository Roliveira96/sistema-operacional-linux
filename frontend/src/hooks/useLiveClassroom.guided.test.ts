import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSnapshot } from "@/services/classroomService";
import { useLiveClassroom } from "./useLiveClassroom";

// SPEC-071 section 3.5: the contract of the guided practice in the hook

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

const round = (over: Record<string, unknown> = {}) => ({
  runId: "r-1",
  blockId: "b-1",
  index: 0,
  title: "Criar uma pasta",
  difficulty: "EASY",
  durationSeconds: 300,
  startedAt: "2026-10-14T10:00:00Z",
  endsAt: "2026-10-14T10:05:00Z",
  status: "RUNNING",
  resultVisible: false,
  now: "2026-10-14T10:00:00Z",
  pausedSeconds: 0,
  closedAt: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("useLiveClassroom, the guided practice (SPEC-071)", () => {
  // CA-13
  it("takes the four states of the round from the snapshot, with the time paused and the close", () => {
    const { result, socket } = setup("student");
    for (const status of ["RUNNING", "PAUSED", "ENDED", "CLOSED"]) {
      act(() => socket().receive("live:snapshot", snapshot({ exercise: round({ status, pausedSeconds: 30, closedAt: status === "CLOSED" ? "2026-10-14T10:06:00Z" : null }) })));
      expect(result.current.exercise?.status).toBe(status);
      expect(result.current.exercise?.pausedSeconds).toBe(30);
    }
    expect(result.current.exercise?.closedAt).toBe("2026-10-14T10:06:00Z");
  });

  // CA-01
  it("pauses and resumes the round, with the end and the time paused the server tells", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: round() })));
    act(() => socket().receive("live:exercise:paused", { runId: "r-1", paused: true, endsAt: "2026-10-14T10:05:00Z", pausedSeconds: 0, now: "2026-10-14T10:01:00Z" }));
    expect(result.current.exercise?.status).toBe("PAUSED");
    act(() => socket().receive("live:exercise:paused", { runId: "r-1", paused: false, endsAt: "2026-10-14T10:06:00Z", pausedSeconds: 60, now: "2026-10-14T10:02:00Z" }));
    expect(result.current.exercise).toMatchObject({ status: "RUNNING", endsAt: "2026-10-14T10:06:00Z", pausedSeconds: 60 });
    act(() => socket().receive("live:exercise:paused", { runId: "other", paused: true, endsAt: "2026-10-14T10:06:00Z", pausedSeconds: 60, now: "2026-10-14T10:02:00Z" }));
    expect(result.current.exercise?.status).toBe("RUNNING");
  });

  // CA-02, CA-03
  it("takes more time, and a reopening runs the ended round again with the result hidden", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: round() })));
    act(() => socket().receive("live:exercise:extended", { runId: "r-1", endsAt: "2026-10-14T10:07:00Z", durationSeconds: 420, reopened: false, now: "2026-10-14T10:01:00Z" }));
    expect(result.current.exercise).toMatchObject({ endsAt: "2026-10-14T10:07:00Z", durationSeconds: 420, status: "RUNNING" });

    act(() => socket().receive("live:exercise:ended", { runId: "r-1", by: "TIMER", endedAt: "2026-10-14T10:07:00Z", now: "2026-10-14T10:07:00Z" }));
    act(() => socket().receive("live:exercise:result", { runId: "r-1", visible: true, completed: 0, participants: 2, scoreboard: [] }));
    expect(result.current.exercise?.status).toBe("ENDED");
    act(() => socket().receive("live:exercise:extended", { runId: "r-1", endsAt: "2026-10-14T10:10:00Z", durationSeconds: 600, reopened: true, now: "2026-10-14T10:07:00Z" }));
    expect(result.current.exercise).toMatchObject({ status: "RUNNING", endsAt: "2026-10-14T10:10:00Z", resultVisible: false });
    expect(result.current.exercise?.endedBy).toBeUndefined();
    expect(result.current.exercise?.result).toBeUndefined();
  });

  // CA-04, CA-05
  it("keeps the round ENDED until the server tells it is CLOSED", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: round() })));
    act(() => socket().receive("live:exercise:ended", { runId: "r-1", by: "TEACHER", endedAt: "2026-10-14T10:02:00Z", now: "2026-10-14T10:02:00Z" }));
    expect(result.current.exercise?.status).toBe("ENDED");
    act(() => socket().receive("live:exercise:closed", { runId: "r-1", closedAt: "2026-10-14T10:03:00Z", now: "2026-10-14T10:03:00Z" }));
    expect(result.current.exercise).toMatchObject({ status: "CLOSED", closedAt: "2026-10-14T10:03:00Z" });
  });

  // CA-07
  it("tells the student when the teacher has his terminal, with the name, from the snapshot and the messages", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: round({ takenOver: true }) })));
    expect(result.current.takenOver).toBe(true);
    act(() => socket().receive("live:exercise:takeover", { on: false }));
    expect(result.current.takenOver).toBe(false);
    act(() => socket().receive("live:exercise:takeover", { on: true, teacherName: "Profa. Sediane" }));
    expect(result.current.takenOver).toBe(true);
    expect(result.current.takeoverTeacher).toBe("Profa. Sediane");
    act(() => socket().receive("live:exercise:closed", { runId: "r-1", closedAt: "2026-10-14T10:03:00Z", now: "2026-10-14T10:03:00Z" }));
    expect(result.current.takenOver).toBe(false);
  });

  // CA-07
  it("gives the keys of the teacher to who listens, in order, and none to who stopped listening", () => {
    const { result, socket } = setup("student");
    const got: unknown[] = [];
    let stop = () => undefined as void;
    act(() => {
      stop = result.current.onTakeoverKey((key) => got.push(key));
    });
    act(() => socket().receive("live:exercise:key", { key: "l", ctrl: false, alt: false, shift: false }));
    act(() => socket().receive("live:exercise:key", { paste: "ls\n" }));
    act(() => socket().receive("live:exercise:key", { key: 7 }));
    act(() => stop());
    act(() => socket().receive("live:exercise:key", { key: "s" }));
    expect(got).toEqual([{ key: "l", ctrl: false, alt: false, shift: false }, { paste: "ls\n" }]);
  });

  // CA-06, CA-07, CA-11
  it("tells the panel who is taken over and the commands of each student", () => {
    const { result, socket } = setup("teacher", "panel");
    const progress = [{ studentId: "u-1", name: "Ana", met: 0, total: 2, last: "", at: "2026-10-14T10:00:10Z", commands: 4, lastCommandAt: "2026-10-14T10:00:10Z", status: "IN_PROGRESS", helpRequested: true, takenOver: true, takeoverOn: true }];
    act(() => socket().receive("live:snapshot", snapshot({ exercise: round({ progress }) })));
    expect(result.current.takeover).toBe("u-1");
    expect(result.current.exerciseProgress["u-1"]).toMatchObject({ commands: 4, lastCommandAt: "2026-10-14T10:00:10Z", helpRequested: true, takenOver: true });
    act(() => socket().receive("live:exercise:takeover", { studentId: "u-1", on: false }));
    expect(result.current.takeover).toBeNull();
    expect(result.current.exerciseProgress["u-1"]?.takenOver).toBe(true);
    act(() => socket().receive("live:exercise:takeover", { studentId: "u-2", on: true }));
    expect(result.current.takeover).toBe("u-2");
    expect(result.current.exerciseProgress["u-2"]?.takenOver).toBe(true);
    act(() => socket().receive("live:exercise:progress", { runId: "r-1", studentId: "u-1", met: 1, total: 2, last: "ls", at: "2026-10-14T10:00:20Z", commands: 5, lastCommandAt: "2026-10-14T10:00:20Z" }));
    expect(result.current.exerciseProgress["u-1"]).toMatchObject({ commands: 5, lastCommandAt: "2026-10-14T10:00:20Z" });
  });

  it("sends the controls of the panel, and nothing from a student or the presentation window", () => {
    const panel = setup("teacher", "panel");
    act(() => panel.socket().receive("live:snapshot", snapshot({ exercise: round() })));
    act(() => {
      panel.result.current.pauseExercise(true);
      panel.result.current.extendExercise(2);
      panel.result.current.closeExercise();
      panel.result.current.takeoverStudent("u-1", true);
      panel.result.current.sendTakeoverKey("u-1", { key: "c", ctrl: true });
      panel.result.current.sendTakeoverPaste("u-1", "ls -l\n");
    });
    expect(panel.socket().sent).toEqual([
      { type: "live:exercise:pause", data: { paused: true } },
      { type: "live:exercise:extend", data: { minutes: 2 } },
      { type: "live:exercise:close", data: {} },
      { type: "live:exercise:takeover", data: { studentId: "u-1", on: true } },
      { type: "live:exercise:key", data: { studentId: "u-1", key: "c", ctrl: true, alt: false, shift: false } },
      { type: "live:exercise:key", data: { studentId: "u-1", paste: "ls -l\n" } },
    ]);

    for (const other of [setup("student"), setup("teacher", "presenter")]) {
      act(() => {
        other.result.current.pauseExercise(true);
        other.result.current.extendExercise(2);
        other.result.current.closeExercise();
        other.result.current.takeoverStudent("u-1", true);
        other.result.current.sendTakeoverKey("u-1", { key: "a" });
        other.result.current.sendTakeoverPaste("u-1", "x");
      });
      expect(other.socket().sent).toEqual([]);
    }
  });

  it("sends no paste that is empty or longer than 2,000 characters, and cuts no key", () => {
    const panel = setup("teacher", "panel");
    act(() => {
      panel.result.current.sendTakeoverPaste("u-1", "");
      panel.result.current.sendTakeoverPaste("u-1", "x".repeat(2001));
      panel.result.current.sendTakeoverKey("u-1", { key: "" });
    });
    expect(panel.socket().sent).toEqual([]);
  });

  // RN-09
  it("sends the commands of the student with his progress", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ exercise: round() })));
    act(() => void result.current.sendExerciseProgress({ runId: "r-1", met: 1, total: 2, last: "ls", commands: 3 }));
    expect(socket().sent.at(-1)).toEqual({ type: "live:exercise:progress", data: { runId: "r-1", met: 1, total: 2, last: "ls", commands: 3 } });
  });
});
