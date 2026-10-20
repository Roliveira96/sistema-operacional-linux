import type { CalendarData, Session } from "@/services/scheduleService";

/** October 2026 of a class with meetings on Monday (08:20) and Wednesday (13:50), used by the schedule tests (SPEC-042). */
export function session(over: Partial<Session> & Pick<Session, "id" | "date">): Session {
  return {
    classId: "c-1",
    meetingId: "m-1",
    startTime: "08:20",
    endTime: "10:00",
    lessonCount: 2,
    mode: "IN_PERSON",
    room: "B-204",
    status: "SCHEDULED",
    origin: "WEEKLY",
    overridden: false,
    onHoliday: false,
    ...over,
  };
}

export function octoberCalendar(): CalendarData {
  return {
    classes: [
      { id: "c-1", name: "Sistemas Operacionais", courseCode: "SO34E", color: "orange", startDate: "2026-10-01", endDate: "2026-10-31" },
    ],
    sessions: [
      session({ id: "s-14", date: "2026-10-14", startTime: "13:50", endTime: "15:30", meetingId: "m-2" }),
      session({ id: "s-19", date: "2026-10-19", status: "CANCELED", overridden: true, changeReason: "Recesso", onHoliday: true }),
      session({ id: "s-21", date: "2026-10-21", startTime: "13:50", endTime: "15:30", meetingId: "m-2", mode: "ONLINE", room: undefined, onlineUrl: "https://meet.google.com/abc", overridden: true }),
      session({ id: "s-26", date: "2026-10-26" }),
      session({ id: "s-28", date: "2026-10-28", startTime: "13:50", endTime: "15:30", meetingId: "m-2" }),
      session({ id: "s-24", date: "2026-10-24", meetingId: undefined, origin: "EXTRA", startTime: "08:00", endTime: "11:40", lessonCount: 4, room: "Lab 3" }),
    ],
    events: [{ id: "e-1", classId: "c-1", title: "Palestra: o kernel", description: "", date: "2026-10-22", allDay: false, startTime: "19:00", endTime: "21:00", location: "Auditório" }],
    periods: [{ id: "p-1", classId: "c-1", firstDay: "2026-10-26", lastDay: "2026-10-28", action: "ONLINE", label: "Semana online", onlineUrl: "https://meet.google.com/xyz" }],
    holidays: [{ id: "h-1", date: "2026-10-12", name: "Nossa Senhora Aparecida", scope: "NATIONAL", active: true }],
    assessments: [],
    meetings: [
      { id: "m-1", classId: "c-1", weekday: 1, startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "IN_PERSON", room: "B-204" },
      { id: "m-2", classId: "c-1", weekday: 3, startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "IN_PERSON", room: "B-204" },
    ],
  };
}
