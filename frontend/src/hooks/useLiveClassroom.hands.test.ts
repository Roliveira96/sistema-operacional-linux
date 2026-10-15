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

const snapshot = (over: Record<string, unknown> = {}): LiveSnapshot =>
  ({
    hasActiveSession: true,
    session: { id: "s-1", classId: "c-1", title: "Aula", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" },
    displayMode: "SLIDES",
    currentSlide: 1,
    activeModuleId: null,
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
  return { ...view, socket };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ana = { studentId: "u-1", name: "Ana", requestedAt: "2026-10-14T10:01:00Z" };
const bia = { studentId: "u-2", name: "Bia", requestedAt: "2026-10-14T10:02:00Z" };

// SPEC-058
describe("useLiveClassroom, the hand with a doubt", () => {
  // CA-03, CA-04
  it("raises the hand with no text, with one call and nothing else", () => {
    const { result, socket } = setup("student");
    act(() => socket().handlers.onOpen());
    act(() => result.current.raiseHand());
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:raise", data: {} });
  });

  it("raises the hand with the doubt, trimmed, and sends the doubt again to change it", () => {
    const { result, socket } = setup("student");
    act(() => socket().handlers.onOpen());
    act(() => result.current.raiseHand("  Como uso o chmod?  "));
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:raise", data: { question: "Como uso o chmod?" } });
    act(() => result.current.raiseHand("Como uso o chmod -R?"));
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:raise", data: { question: "Como uso o chmod -R?" } });
  });

  it("sends no question for a doubt with no text, which takes the doubt away from the hand that is up", () => {
    const { result, socket } = setup("student");
    act(() => socket().handlers.onOpen());
    act(() => result.current.raiseHand("   "));
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:raise", data: {} });
    act(() => result.current.raiseHand(""));
    expect(socket().sent.at(-1)).toEqual({ type: "live:hand:raise", data: {} });
  });

  // CA-07
  it("has no hand of his own until the room tells it, and takes it from the snapshot at every connection", () => {
    const { result, socket } = setup("student");
    expect(result.current.myHand).toBeNull();
    act(() => socket().receive("live:snapshot", snapshot({ handRaises: [ana], myHand: { raised: true, question: "Como uso o chmod?" } })));
    expect(result.current.myHand).toEqual({ raised: true, question: "Como uso o chmod?" });
    act(() => socket().receive("live:snapshot", snapshot({ handRaises: [], myHand: { raised: false, question: "" } })));
    expect(result.current.myHand).toEqual({ raised: false, question: "" });
  });

  it("has no hand of his own for the teacher, whose snapshot has none", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:snapshot", snapshot({ handRaises: [{ ...ana, question: "x" }] })));
    expect(result.current.myHand).toBeNull();
  });

  it("reads a hand of his own that is not well formed as a hand that is down", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ myHand: { raised: "yes", question: 3 } })));
    expect(result.current.myHand).toEqual({ raised: false, question: "" });
  });

  it("keeps the doubt that it sent as the one the room has, and takes it away with the hand", () => {
    const { result, socket } = setup("student");
    act(() => socket().handlers.onOpen());
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => result.current.raiseHand());
    expect(result.current.myHand).toEqual({ raised: true, question: "" });
    act(() => result.current.raiseHand("  Como uso o chmod?  "));
    expect(result.current.myHand).toEqual({ raised: true, question: "Como uso o chmod?" });
    act(() => result.current.lowerHand());
    expect(result.current.myHand).toEqual({ raised: false, question: "" });
    act(() => result.current.raiseHand());
    expect(result.current.myHand).toEqual({ raised: true, question: "" });
  });

  // CA-06: the panel gets the doubts, the students and the presentation window get the hands without them
  it("keeps the doubt of each hand that the room tells the panel, in the queue and in the snapshot", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:snapshot", snapshot({ handRaises: [{ ...ana, question: "Como uso o chmod?" }] })));
    expect(result.current.hands).toEqual([{ ...ana, question: "Como uso o chmod?" }]);
    act(() => socket().receive("live:hand:queue", { queue: [{ ...ana, question: "Como uso o chmod?" }, { ...bia, question: "" }] }));
    expect(result.current.hands).toEqual([{ ...ana, question: "Como uso o chmod?" }, { ...bia, question: "" }]);
  });

  it("keeps the hands with no doubt that the room tells the students and the presentation window", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:hand:queue", { queue: [ana, bia] }));
    expect(result.current.hands).toEqual([ana, bia]);
  });

  // CA-01, CA-02: how many hands are up, from the presentation window to the student
  it("counts the raised hands, from the snapshot and from every queue, in the presentation window too", () => {
    const { result, socket } = setup("teacher", "presenter");
    expect(result.current.handCount).toBe(0);
    act(() => socket().receive("live:snapshot", snapshot({ handRaises: [ana] })));
    expect(result.current.handCount).toBe(1);
    act(() => socket().receive("live:hand:queue", { queue: [ana, bia] }));
    expect(result.current.handCount).toBe(2);
    act(() => socket().receive("live:hand:queue", { queue: [] }));
    expect(result.current.handCount).toBe(0);
  });

  it("tells the start of the class from every snapshot, so the clocks are corrected", () => {
    const { result, socket } = setup("student");
    expect(result.current.startedAt).toBeNull();
    act(() => socket().receive("live:snapshot", snapshot()));
    expect(result.current.startedAt).toBe("2026-10-14T10:00:00Z");
    act(() => socket().receive("live:snapshot", snapshot({ session: { id: "s-1", startedAt: "2026-10-14T10:30:00Z" } })));
    expect(result.current.startedAt).toBe("2026-10-14T10:30:00Z");
  });
});

// SPEC-059
describe("useLiveClassroom, the full screen asked of the students", () => {
  // CA-06
  it("is off until the room says it is on, and takes it from every snapshot", () => {
    const { result, socket } = setup("student");
    expect(result.current.fullscreenRequested).toBe(false);
    act(() => socket().receive("live:snapshot", snapshot({ stageView: { fullscreen: true } })));
    expect(result.current.fullscreenRequested).toBe(true);
    act(() => socket().receive("live:snapshot", snapshot({ stageView: { fullscreen: false } })));
    expect(result.current.fullscreenRequested).toBe(false);
  });

  it("takes a snapshot that says nothing about it, or says nonsense, for off", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ stageView: { fullscreen: true } })));
    act(() => socket().receive("live:snapshot", snapshot({ stageView: {} })));
    expect(result.current.fullscreenRequested).toBe(false);
    act(() => socket().receive("live:snapshot", snapshot({ stageView: { fullscreen: true } })));
    act(() => socket().receive("live:snapshot", snapshot({ stageView: { fullscreen: "true" } })));
    expect(result.current.fullscreenRequested).toBe(false);
    act(() => socket().receive("live:snapshot", snapshot()));
    expect(result.current.fullscreenRequested).toBe(false);
  });

  // CA-02, CA-05
  it("follows the message that turns the request on and off", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:stage:fullscreen", { enabled: true }));
    expect(result.current.fullscreenRequested).toBe(true);
    act(() => socket().receive("live:stage:fullscreen", { enabled: false }));
    expect(result.current.fullscreenRequested).toBe(false);
  });

  it("takes only a boolean as the state of the request", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:stage:fullscreen", { enabled: true }));
    for (const data of [{}, { enabled: "false" }, { enabled: 0 }, { enabled: null }, null, "off"]) {
      act(() => socket().receive("live:stage:fullscreen", data));
      expect(result.current.fullscreenRequested).toBe(true);
    }
  });

  it("is not restarted by a new slide or a new module", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ stageView: { fullscreen: true } })));
    act(() => socket().receive("live:slide:change", { slide: 4 }));
    expect(result.current.fullscreenRequested).toBe(true);
    act(() => socket().receive("live:mode:switch", { mode: "MODULE", moduleId: "m-2" }));
    expect(result.current.fullscreenRequested).toBe(true);
    act(() => socket().receive("live:mode:switch", { mode: "SLIDES" }));
    expect(result.current.fullscreenRequested).toBe(true);
  });

  // CA-01: both windows of the teacher
  it.each(["panel", "presenter"] as const)("lets the %s of the teacher turn it on and off, and shows it on his own screen", (window) => {
    const { result, socket } = setup("teacher", window);
    act(() => socket().handlers.onOpen());
    act(() => result.current.sendStageFullscreen(true));
    expect(socket().sent.at(-1)).toEqual({ type: "live:stage:fullscreen", data: { enabled: true } });
    expect(result.current.fullscreenRequested).toBe(true);
    act(() => result.current.sendStageFullscreen(false));
    expect(socket().sent.at(-1)).toEqual({ type: "live:stage:fullscreen", data: { enabled: false } });
    expect(result.current.fullscreenRequested).toBe(false);
  });

  it("shows in one window what the other one asked, which the server passes on without an echo", () => {
    const { result, socket } = setup("teacher", "presenter");
    act(() => socket().receive("live:stage:fullscreen", { enabled: true }));
    expect(result.current.fullscreenRequested).toBe(true);
  });

  it("sends nothing from a student, nor from a window that lost the control", () => {
    const student = setup("student");
    act(() => student.socket().handlers.onOpen());
    act(() => student.result.current.sendStageFullscreen(true));
    expect(student.socket().sent).toEqual([]);
    expect(student.result.current.fullscreenRequested).toBe(false);

    const teacher = setup("teacher", "panel");
    act(() => teacher.socket().handlers.onOpen());
    act(() => teacher.socket().receive("live:control:revoked", {}));
    act(() => teacher.result.current.sendStageFullscreen(true));
    expect(teacher.socket().sent).toEqual([]);
  });
});
