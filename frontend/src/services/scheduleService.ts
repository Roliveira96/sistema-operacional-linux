import { classroomService } from "./classroomService";
import { httpClient, type HttpClient } from "./httpClient";

/** How a session happens (SPEC-042). */
export type Mode = "IN_PERSON" | "ONLINE";

/** A fixed time of a class on a day of the week (0 = Sunday). */
export interface Meeting {
  id?: string;
  classId?: string;
  weekday: number;
  startTime: string;
  endTime: string;
  lessonCount: number;
  mode: Mode;
  room?: string;
  onlineUrl?: string;
}

/** One session of a class on a date. */
export interface Session {
  id: string;
  classId: string;
  meetingId?: string;
  date: string;
  startTime: string;
  endTime: string;
  lessonCount: number;
  mode: Mode;
  room?: string;
  onlineUrl?: string;
  status: "SCHEDULED" | "CANCELED";
  origin: "WEEKLY" | "EXTRA";
  overridden: boolean;
  changeReason?: string;
  periodId?: string;
  onHoliday: boolean;
  /** The topic of the lesson and whether it has any content; the content itself is read apart (SPEC-053, RN-06). */
  topic?: string;
  hasContent?: boolean;
}

/** A link of a lesson (SPEC-053 RN-01). */
export interface SessionContentLink {
  name: string;
  url: string;
  position?: number;
}

/** What a lesson covers, as the content endpoint reads it (SPEC-053, section 5). Empty when the lesson has none. */
export interface SessionContent {
  topic?: string;
  description?: string;
  module?: { id: string; title: string } | null;
  deck?: { id: string; title: string; pageCount: number; downloadUrl: string } | null;
  links: SessionContentLink[];
}

/** What the teacher saves: an empty or absent field clears the value. */
export interface SessionContentInput {
  topic?: string;
  description?: string;
  moduleId?: string;
  deckId?: string;
  links: { name: string; url: string }[];
}

export interface ClassEvent {
  id: string;
  classId: string;
  title: string;
  description: string;
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  location?: string;
  onlineUrl?: string;
}

export type PeriodAction = "NO_CLASSES" | "ONLINE";

export interface SpecialPeriod {
  id: string;
  classId: string;
  firstDay: string;
  lastDay: string;
  action: PeriodAction;
  label: string;
  onlineUrl?: string;
}

export type HolidayScope = "NATIONAL" | "LOCAL" | "RECESS";

export interface Holiday {
  id: string;
  date: string;
  name: string;
  scope: HolidayScope;
  active: boolean;
}

export interface CalendarClass {
  id: string;
  name: string;
  courseCode: string;
  color: string;
  startDate: string;
  endDate: string;
}

/** Everything a calendar shows for a range of days. */
export interface CalendarData {
  classes: CalendarClass[];
  sessions: Session[];
  events: ClassEvent[];
  periods: SpecialPeriod[];
  holidays: Holiday[];
  meetings: Meeting[];
}

export interface SessionInput {
  date?: string;
  status?: Session["status"];
  startTime: string;
  endTime: string;
  lessonCount: number;
  mode: Mode;
  room?: string;
  onlineUrl?: string;
  reason?: string;
}

export interface EventInput {
  title: string;
  description?: string;
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  location?: string;
  onlineUrl?: string;
}

export interface PeriodInput {
  firstDay: string;
  lastDay: string;
  action: SpecialPeriod["action"];
  label: string;
  onlineUrl?: string;
}

export interface HolidayInput {
  date: string;
  name: string;
  scope: Holiday["scope"];
  active: boolean;
}

export interface NotificationPreferences {
  sessionReminders: boolean;
  weeklyDigest: boolean;
}

/** Schedule of a class API client (SPEC-042, section 5). */
export function createScheduleService(client: HttpClient = httpClient) {
  const range = (from: string, to: string) => `from=${from}&to=${to}`;
  return {
    getMeetings: async (classId: string) => (await client.get<{ meetings: Meeting[] }>(`/classes/${classId}/meetings`)).meetings,
    replaceMeetings: async (classId: string, meetings: Meeting[]) =>
      (await client.put<{ meetings: Meeting[] }>(`/classes/${classId}/meetings`, { meetings })).meetings,
    classCalendar: (classId: string, from: string, to: string) =>
      client.get<CalendarData>(`/classes/${classId}/calendar?${range(from, to)}`),
    myCalendar: (from: string, to: string) => client.get<CalendarData>(`/me/calendar?${range(from, to)}`),
    updateSession: (classId: string, sessionId: string, input: SessionInput) =>
      client.patch<Session>(`/classes/${classId}/sessions/${sessionId}`, input),
    revertSession: (classId: string, sessionId: string) => client.delete<Session>(`/classes/${classId}/sessions/${sessionId}/override`),
    getSessionContent: (classId: string, sessionId: string) => client.get<SessionContent>(`/classes/${classId}/sessions/${sessionId}/content`),
    saveSessionContent: (classId: string, sessionId: string, input: SessionContentInput) =>
      client.put<SessionContent>(`/classes/${classId}/sessions/${sessionId}/content`, input),
    createSession: (classId: string, input: SessionInput) => client.post<Session>(`/classes/${classId}/sessions`, input),
    deleteSession: (classId: string, sessionId: string) => client.delete<void>(`/classes/${classId}/sessions/${sessionId}`),
    createEvent: (classId: string, input: EventInput) => client.post<ClassEvent>(`/classes/${classId}/events`, input),
    updateEvent: (classId: string, eventId: string, input: EventInput) =>
      client.patch<ClassEvent>(`/classes/${classId}/events/${eventId}`, input),
    deleteEvent: (classId: string, eventId: string) => client.delete<void>(`/classes/${classId}/events/${eventId}`),
    applyPeriod: (classId: string, input: PeriodInput) =>
      client.post<{ period: SpecialPeriod; affectedSessions: number }>(`/classes/${classId}/periods`, input),
    deletePeriod: (classId: string, periodId: string) => client.delete<void>(`/classes/${classId}/periods/${periodId}`),
    holidays: async (year: number) => (await client.get<{ holidays: Holiday[] }>(`/holidays?year=${year}`)).holidays,
    createHoliday: (input: HolidayInput) => client.post<Holiday>("/holidays", input),
    updateHoliday: (id: string, input: HolidayInput) => client.patch<Holiday>(`/holidays/${id}`, input),
    deleteHoliday: (id: string) => client.delete<void>(`/holidays/${id}`),
    getPreferences: () => client.get<NotificationPreferences>("/students/me/notifications"),
    setPreferences: (input: Partial<NotificationPreferences>) =>
      client.patch<NotificationPreferences>("/students/me/notifications", input),
  };
}

export type ScheduleService = ReturnType<typeof createScheduleService>;
export const scheduleService = createScheduleService();

/**
 * Starts the live class from a lesson of the calendar (SPEC-053 RN-08, CA-11): the topic is the title (the name of the class when the
 * lesson has none), and the module and the presentation of the lesson come along, tied to it. If the class already has a live class
 * going, the server answers with that one.
 */
export async function startLiveFromSession(classId: string, session: Session, fallbackTitle: string) {
  const content = session.hasContent ? await scheduleService.getSessionContent(classId, session.id) : null;
  return classroomService.startSession(classId, {
    title: content?.topic?.trim() || fallbackTitle,
    classSessionId: session.id,
    ...(content?.deck ? { deckId: content.deck.id } : {}),
    ...(content?.module ? { initialModuleId: content.module.id } : {}),
  });
}
