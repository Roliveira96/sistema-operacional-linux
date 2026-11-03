import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detail } from "@/test/assessmentFixtures";
import { ExamClock } from "./ExamClock";

const running = (over = {}) =>
  detail({ phase: "RUNNING", startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T11:00:00-03:00", startedAt: "2026-10-21T09:05:00-03:00", ...over });

let room: BroadcastChannel;
const heard: Record<string, unknown>[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T10:00:00-03:00"));
  heard.length = 0;
  room = new BroadcastChannel("exam-room:a-1");
  room.onmessage = (e) => heard.push(e.data);
});
afterEach(() => {
  room.close();
  cleanup();
  vi.useRealTimers();
});

// SPEC-092 CA-09: the clock for the class, big, with the end of the exam.
describe("ExamClock, the time", () => {
  it("shows the title, the time to the end and the hour of the end", () => {
    render(<ExamClock assessment={running()} />);
    expect(screen.getByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
    expect(screen.getByText("Termina em")).toBeDefined();
    expect(screen.getByRole("timer").textContent).toBe("01:00:00");
    expect(screen.getByText("às 11:00")).toBeDefined();
  });

  it("says the exam has not begun, and counts once the room tells the start", async () => {
    render(<ExamClock assessment={running({ startedAt: undefined })} />);
    expect(screen.getByText("A prova ainda não começou.")).toBeDefined();
    expect(screen.queryByRole("timer")).toBeNull();
    room.postMessage({ type: "state", startedAt: "2026-10-21T09:05:00-03:00", endsAt: "2026-10-21T11:00:00-03:00", offset: 0, hands: [] });
    expect((await screen.findByRole("timer")).textContent).toBe("01:00:00");
  });

  it("says the time is over after the end", () => {
    vi.setSystemTime(new Date("2026-10-21T11:30:00-03:00"));
    render(<ExamClock assessment={running({ serverNow: "2026-10-21T11:30:00-03:00" })} />);
    expect(screen.getByText("Tempo esgotado.")).toBeDefined();
    expect(screen.queryByRole("timer")).toBeNull();
  });
});

// SPEC-092 CA-10: the raised hands, by name only, as the room tells them.
describe("ExamClock, the raised hands", () => {
  it("asks the room for the state and shows the names of the raised hands", async () => {
    render(<ExamClock assessment={running()} />);
    await waitFor(() => expect(heard).toContainEqual({ type: "hello" }));
    expect(screen.queryByText(/Mão levantada/)).toBeNull();
    act(() => room.postMessage({ type: "state", startedAt: "2026-10-21T09:05:00-03:00", endsAt: "2026-10-21T11:00:00-03:00", offset: 0, hands: ["Ana", "Bruno"] }));
    expect(await screen.findByText("Mão levantada: Ana, Bruno")).toBeDefined();
    act(() => room.postMessage({ type: "state", startedAt: "2026-10-21T09:05:00-03:00", endsAt: "2026-10-21T11:00:00-03:00", offset: 0, hands: [] }));
    await waitFor(() => expect(screen.queryByText(/Mão levantada/)).toBeNull());
  });
});
