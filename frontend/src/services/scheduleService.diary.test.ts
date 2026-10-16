import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "./httpClient";
import { createScheduleService, type SessionDiary, type Timeline } from "./scheduleService";

function client(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
}

// SPEC-073, section 5: the timeline of the class, the diary of the lesson and the notes of the teacher in the content
describe("scheduleService: timeline and diary (SPEC-073)", () => {
  it("reads the timeline of the class", async () => {
    const c = client();
    const svc = createScheduleService(c);
    const timeline: Timeline = { now: "2026-10-19T09:00:00-03:00", current: null, past: [], upcoming: [], liveSessionId: null };
    vi.mocked(c.get).mockResolvedValueOnce(timeline);
    await expect(svc.timeline("c-1")).resolves.toEqual(timeline);
    expect(c.get).toHaveBeenCalledWith("/classes/c-1/sessions/timeline");
  });

  it("reads the diary of a lesson", async () => {
    const c = client();
    const svc = createScheduleService(c);
    const diary = { session: { id: "s-1" }, content: { links: [], teacherNotes: "<p>x</p>" }, liveSessions: [] } as unknown as SessionDiary;
    vi.mocked(c.get).mockResolvedValueOnce(diary);
    await expect(svc.getDiary("c-1", "s-1")).resolves.toEqual(diary);
    expect(c.get).toHaveBeenCalledWith("/classes/c-1/sessions/s-1/diary");
  });

  it("saves the notes of the teacher with the content", async () => {
    const c = client();
    const svc = createScheduleService(c);
    const input = { topic: "x", links: [], teacherNotes: "<p>a</p>", teacherPrivateNotes: "<p>b</p>" };
    await svc.saveSessionContent("c-1", "s-1", input);
    expect(c.put).toHaveBeenCalledWith("/classes/c-1/sessions/s-1/content", input);
  });
});
