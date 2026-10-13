import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "./httpClient";
import { createScheduleService } from "./scheduleService";

function client(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
}

// SPEC-042, section 5.
describe("scheduleService", () => {
  it("reads and replaces the weekly meetings", async () => {
    const c = client();
    const svc = createScheduleService(c);
    const meeting = { weekday: 1, startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "IN_PERSON" as const };
    vi.mocked(c.get).mockResolvedValueOnce({ meetings: [meeting] });
    await expect(svc.getMeetings("c-1")).resolves.toEqual([meeting]);
    expect(c.get).toHaveBeenCalledWith("/classes/c-1/meetings");

    vi.mocked(c.put).mockResolvedValueOnce({ meetings: [{ ...meeting, id: "m-1" }] });
    await expect(svc.replaceMeetings("c-1", [meeting])).resolves.toEqual([{ ...meeting, id: "m-1" }]);
    expect(c.put).toHaveBeenCalledWith("/classes/c-1/meetings", { meetings: [meeting] });
  });

  it("reads the calendar of a class and of the user", async () => {
    const c = client();
    const svc = createScheduleService(c);
    const data = { classes: [], sessions: [], events: [], periods: [], holidays: [], meetings: [] };
    vi.mocked(c.get).mockResolvedValue(data);
    await svc.classCalendar("c-1", "2026-10-01", "2026-10-31");
    expect(c.get).toHaveBeenCalledWith("/classes/c-1/calendar?from=2026-10-01&to=2026-10-31");
    await svc.myCalendar("2026-10-01", "2026-10-31");
    expect(c.get).toHaveBeenCalledWith("/me/calendar?from=2026-10-01&to=2026-10-31");
  });

  it("changes, reverts, adds and deletes sessions", async () => {
    const c = client();
    const svc = createScheduleService(c);
    const input = { status: "CANCELED" as const, startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "IN_PERSON" as const, reason: "x" };
    await svc.updateSession("c-1", "s-1", input);
    expect(c.patch).toHaveBeenCalledWith("/classes/c-1/sessions/s-1", input);
    await svc.revertSession("c-1", "s-1");
    expect(c.delete).toHaveBeenCalledWith("/classes/c-1/sessions/s-1/override");
    await svc.createSession("c-1", { ...input, date: "2026-10-24" });
    expect(c.post).toHaveBeenCalledWith("/classes/c-1/sessions", { ...input, date: "2026-10-24" });
    await svc.deleteSession("c-1", "s-2");
    expect(c.delete).toHaveBeenCalledWith("/classes/c-1/sessions/s-2");
  });

  it("creates, changes and deletes events and periods", async () => {
    const c = client();
    const svc = createScheduleService(c);
    const event = { title: "Palestra", date: "2026-10-22", allDay: true };
    await svc.createEvent("c-1", event);
    expect(c.post).toHaveBeenCalledWith("/classes/c-1/events", event);
    await svc.updateEvent("c-1", "e-1", event);
    expect(c.patch).toHaveBeenCalledWith("/classes/c-1/events/e-1", event);
    await svc.deleteEvent("c-1", "e-1");
    expect(c.delete).toHaveBeenCalledWith("/classes/c-1/events/e-1");

    const period = { firstDay: "2026-10-19", lastDay: "2026-10-23", action: "NO_CLASSES" as const, label: "Semana" };
    vi.mocked(c.post).mockResolvedValueOnce({ period: { id: "p-1", ...period }, affectedSessions: 3 });
    await expect(svc.applyPeriod("c-1", period)).resolves.toEqual({ period: { id: "p-1", ...period }, affectedSessions: 3 });
    await svc.deletePeriod("c-1", "p-1");
    expect(c.delete).toHaveBeenCalledWith("/classes/c-1/periods/p-1");
  });

  it("manages holidays and the e-mail preferences", async () => {
    const c = client();
    const svc = createScheduleService(c);
    vi.mocked(c.get).mockResolvedValueOnce({ holidays: [{ id: "h-1" }] });
    await expect(svc.holidays(2026)).resolves.toEqual([{ id: "h-1" }]);
    expect(c.get).toHaveBeenCalledWith("/holidays?year=2026");
    const holiday = { date: "2026-11-03", name: "Recesso", scope: "RECESS" as const, active: true };
    await svc.createHoliday(holiday);
    expect(c.post).toHaveBeenCalledWith("/holidays", holiday);
    await svc.updateHoliday("h-1", holiday);
    expect(c.patch).toHaveBeenCalledWith("/holidays/h-1", holiday);
    await svc.deleteHoliday("h-1");
    expect(c.delete).toHaveBeenCalledWith("/holidays/h-1");

    vi.mocked(c.get).mockResolvedValueOnce({ sessionReminders: true, weeklyDigest: false });
    await expect(svc.getPreferences()).resolves.toEqual({ sessionReminders: true, weeklyDigest: false });
    await svc.setPreferences({ weeklyDigest: true });
    expect(c.patch).toHaveBeenCalledWith("/students/me/notifications", { weeklyDigest: true });
  });
});
