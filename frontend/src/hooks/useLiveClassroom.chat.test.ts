import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveChatMessage, LiveSnapshot } from "@/services/classroomService";
import { CHAT_MAX } from "@/services/classroomService";
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
  act(() => socket().handlers.onOpen());
  return { ...view, socket };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const all = (id: string, text = "Para todos"): LiveChatMessage => ({ id, scope: "all", from: "TEACHER", text, createdAt: "2026-10-14T10:05:00Z" });
const mine = (id: string, from: "TEACHER" | "STUDENT", studentId = "u-1", text = "Oi"): LiveChatMessage => ({ id, scope: "private", studentId, from, text, createdAt: "2026-10-14T10:06:00Z" });

// SPEC-063 section 3.3: the contract of the chat in the hook
describe("useLiveClassroom, the chat of the class", () => {
  // CA-06
  it("starts with no messages and nobody online", () => {
    const { result } = setup("student");
    expect(result.current.chat).toEqual([]);
    expect(result.current.onlineStudents).toEqual([]);
  });

  it("takes the history and the online students from the snapshot", () => {
    const { result, socket } = setup("teacher", "panel");
    const history = [all("m-1"), mine("m-2", "STUDENT")];
    act(() => socket().receive("live:snapshot", snapshot({ chat: history, onlineStudents: ["u-1", "u-2"] })));
    expect(result.current.chat).toEqual(history);
    expect(result.current.onlineStudents).toEqual(["u-1", "u-2"]);
  });

  it("gives the student the history and no online list, which only the panel is told", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ chat: [all("m-1")] })));
    expect(result.current.chat).toEqual([all("m-1")]);
    expect(result.current.onlineStudents).toEqual([]);
  });

  it("adds each message of the room at the end, and never twice the one with the same id", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ chat: [all("m-1")] })));
    act(() => socket().receive("live:chat:message", mine("m-2", "TEACHER")));
    act(() => socket().receive("live:chat:message", mine("m-2", "TEACHER")));
    act(() => socket().receive("live:chat:message", all("m-1")));
    expect(result.current.chat.map((m) => m.id)).toEqual(["m-1", "m-2"]);
  });

  it("replaces the list by the history of a new snapshot, as after a reconnection", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot({ chat: [all("m-1")] })));
    act(() => socket().receive("live:chat:message", all("m-2")));
    act(() => socket().receive("live:snapshot", snapshot({ chat: [all("m-1"), all("m-2"), all("m-3")] })));
    expect(result.current.chat.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3"]);
    act(() => socket().receive("live:snapshot", snapshot()));
    expect(result.current.chat).toEqual([]);
  });

  it("keeps the text as it came, as plain text with its line breaks", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:chat:message", all("m-1", "<b>oi</b>\nlinha 2")));
    expect(result.current.chat[0]?.text).toBe("<b>oi</b>\nlinha 2");
  });

  it("takes only what has the shape of a message: an id, a scope, a sender and a text", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    for (const bad of [null, "x", {}, { ...all("m-1"), id: "" }, { ...all("m-1"), scope: "team" }, { ...all("m-1"), from: "ROBOT" }, { ...all("m-1"), text: 5 }, { ...all("m-1"), createdAt: 1 }, { id: "m-9", scope: "private", from: "STUDENT", text: "sem dono", createdAt: "x" }]) {
      act(() => socket().receive("live:chat:message", bad));
    }
    expect(result.current.chat).toEqual([]);
  });

  it("drops the owner of a message to everybody, which has none", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    act(() => socket().receive("live:chat:message", { ...all("m-1"), studentId: "u-7" }));
    expect(result.current.chat[0]?.studentId).toBeUndefined();
  });

  it("keeps the last 500 messages, so a long class does not grow without end", () => {
    const { result, socket } = setup("student");
    act(() => socket().receive("live:snapshot", snapshot()));
    for (let i = 0; i < 520; i++) act(() => socket().receive("live:chat:message", all(`m-${i}`)));
    expect(result.current.chat).toHaveLength(500);
    expect(result.current.chat[0]?.id).toBe("m-20");
    expect(result.current.chat.at(-1)!.id).toBe("m-519");
  });

  it("follows the online students with the presence of the room, and keeps them when the presence does not tell", () => {
    const { result, socket } = setup("teacher", "panel");
    act(() => socket().receive("live:snapshot", snapshot({ onlineStudents: ["u-1"] })));
    act(() => socket().receive("live:presence", { online: 2, presenterConnected: true, onlineStudents: ["u-1", "u-2"] }));
    expect(result.current.onlineStudents).toEqual(["u-1", "u-2"]);
    act(() => socket().receive("live:presence", { online: 1, presenterConnected: true }));
    expect(result.current.onlineStudents).toEqual(["u-1", "u-2"]);
    act(() => socket().receive("live:presence", { online: 0, presenterConnected: true, onlineStudents: [] }));
    expect(result.current.onlineStudents).toEqual([]);
  });

  // CA-05, CA-10: what goes out
  describe("sendChat", () => {
    it("sends the text of a student to the teacher, trimmed and with nothing else, and says it went", () => {
      const { result, socket } = setup("student");
      let sent = false;
      act(() => void (sent = result.current.sendChat("  Posso ir ao banheiro?  ")));
      expect(sent).toBe(true);
      expect(socket().sent.at(-1)).toEqual({ type: "live:chat:send", data: { text: "Posso ir ao banheiro?" } });
    });

    it("never lets a student name a destination", () => {
      const { result, socket } = setup("student");
      act(() => void result.current.sendChat("oi", "all"));
      act(() => void result.current.sendChat("oi", { studentId: "u-9" }));
      expect(socket().sent).toEqual([
        { type: "live:chat:send", data: { text: "oi" } },
        { type: "live:chat:send", data: { text: "oi" } },
      ]);
    });

    it("sends the teacher's message to everybody, or only to one student", () => {
      const { result, socket } = setup("teacher", "panel");
      act(() => void result.current.sendChat("Atenção, turma", "all"));
      expect(socket().sent.at(-1)).toEqual({ type: "live:chat:send", data: { text: "Atenção, turma", to: "all" } });
      act(() => void result.current.sendChat("Use o -R", { studentId: "u-1" }));
      expect(socket().sent.at(-1)).toEqual({ type: "live:chat:send", data: { text: "Use o -R", studentId: "u-1" } });
    });

    it("sends nothing from the teacher without a destination", () => {
      const { result, socket } = setup("teacher", "panel");
      let sent = true;
      act(() => void (sent = result.current.sendChat("oi")));
      expect(sent).toBe(false);
      expect(socket().sent).toEqual([]);
    });

    it("sends nothing from the presentation window of the teacher, which has no chat", () => {
      const { result, socket } = setup("teacher", "presenter");
      let sent = true;
      act(() => void (sent = result.current.sendChat("oi", "all")));
      expect(sent).toBe(false);
      expect(socket().sent).toEqual([]);
    });

    it("sends nothing from a teacher who lost the control to another window", () => {
      const { result, socket } = setup("teacher", "panel");
      act(() => socket().receive("live:control:revoked", {}));
      let sent = true;
      act(() => void (sent = result.current.sendChat("oi", "all")));
      expect(sent).toBe(false);
      expect(socket().sent).toEqual([]);
    });

    it("sends nothing empty, nothing of only spaces and nothing over 500 characters, counted by character", () => {
      const { result, socket } = setup("student");
      const results: boolean[] = [];
      act(() => {
        results.push(result.current.sendChat(""), result.current.sendChat("   \n  "), result.current.sendChat("x".repeat(CHAT_MAX + 1)), result.current.sendChat("😀".repeat(CHAT_MAX)));
      });
      expect(results).toEqual([false, false, false, true]);
      expect(socket().sent).toHaveLength(1);
    });

    it("sends nothing while the connection is down, and says so", () => {
      const { result, socket } = setup("student");
      act(() => socket().handlers.onClose());
      let sent = true;
      act(() => void (sent = result.current.sendChat("oi")));
      expect(sent).toBe(false);
      expect(socket().sent).toEqual([]);
    });

    it("shows no message of its own before the room gives it back: no optimistic copy", () => {
      const { result, socket } = setup("student");
      act(() => socket().receive("live:snapshot", snapshot()));
      act(() => void result.current.sendChat("oi"));
      expect(result.current.chat).toEqual([]);
    });
  });
});
