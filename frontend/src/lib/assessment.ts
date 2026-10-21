import { messages } from "@/messages/pt-BR";
import type { AssessmentBase, AssessmentDetail, AssessmentSummary, CalendarAssessment, DrawRule, PickedQuestion } from "@/services/assessmentService";

const m = messages.assessments;

// Points are kept in whole hundredths, so a sum is exact and never an error of a float (SPEC-075 RN-06, D-14).
const cents = (points: number) => Math.round(points * 100);

/** The sum of the weights, in hundredths. */
export const sumWeights = (weights: number[]): number => weights.reduce((sum, w) => sum + cents(w), 0);

/** The maximum score shared by the questions in hundredths: the leftovers of 0.01 go to the first ones, so the sum closes (D-14). */
export function equalWeights(max: number, count: number): number[] {
  if (count < 1) return [];
  const total = cents(max);
  const each = Math.floor(total / count);
  const extra = total - each * count;
  return Array.from({ length: count }, (_, i) => (each + (i < extra ? 1 : 0)) / 100);
}

/** "3,30": two places and a comma. */
export const formatScore = (points: number): string => points.toFixed(2).replace(".", ",");

// The server writes every time in Brasília, with its offset, so the date and the hour are read from the text.
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const hour = (iso: string) => iso.slice(11, 16);

export const formatDay = day;
export const formatHour = hour;
/** "21/10/2026 às 10:00" */
export const formatMoment = (iso: string): string => `${day(iso)} às ${hour(iso)}`;

/** "23/10/2026, 09:00–11:00" for one day; "23/10/2026 09:00 a 30/10/2026 23:59" for several. */
export function formatPeriod(startsAt: string, endsAt: string): string {
  return day(startsAt) === day(endsAt) ? `${day(startsAt)}, ${hour(startsAt)}–${hour(endsAt)}` : `${day(startsAt)} ${hour(startsAt)} a ${day(endsAt)} ${hour(endsAt)}`;
}

/** The fields of date and time hold a local value; Brazil has no daylight saving time, and the server reads Brasília (SPEC-042 RN-13). */
export const fromLocalInput = (value: string): string => `${value}:00-03:00`;
export const toLocalInput = (iso: string | undefined): string => (iso ? iso.slice(0, 16) : "");

/** "01:30:00", or "2 d 03:10:00" with more than a day; it stops at zero. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${days ? `${days} d ` : ""}${two(Math.floor((total % 86400) / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
}

/** The situation of an assessment, as the list and the cards say it: a canceled one is "Cancelada" in any phase. */
export const situationOf = (a: Pick<AssessmentBase, "status" | "phase">): string => m.phase[a.status === "CANCELED" ? "CANCELED" : a.phase] ?? "";

/** The period written for a card of a day: the hours when it is one day, the whole period when it is several. */
export const periodOnDay = (a: Pick<AssessmentBase, "startsAt" | "endsAt">): string =>
  day(a.startsAt) === day(a.endsAt) ? `${hour(a.startsAt)}–${hour(a.endsAt)}` : formatPeriod(a.startsAt, a.endsAt);

/** Whether the assessment is on a day (YYYY-MM-DD): an assignment is on every day from its start to its end. */
export const isOnDay = (a: Pick<AssessmentBase, "startsAt" | "endsAt">, iso: string): boolean => a.startsAt.slice(0, 10) <= iso && iso <= a.endsAt.slice(0, 10);

/** The lessons that became an assessment still scheduled: the calendar draws the assessment in place of the lesson (D-09). */
export const convertedSessionIds = (assessments: Pick<CalendarAssessment, "status" | "classSessionId">[]): Set<string> =>
  new Set(assessments.filter((a) => a.status === "SCHEDULED" && a.classSessionId).map((a) => a.classSessionId!));

/** How long before the start the warning of the students who still wait for the clearance begins (SPEC-076 D-11). */
const WARN_BEFORE_MS = 30 * 60_000;

/**
 * Whether the list warns that students are still not cleared (SPEC-076 RN-13): an in-person assessment that requires the clearance, scheduled, with
 * students waiting, that starts in 30 minutes or less by the clock of the server, or that is running.
 */
export function needsClearanceWarning(a: AssessmentSummary, serverNow?: string): boolean {
  if (a.status !== "SCHEDULED" || a.modality !== "IN_PERSON" || !a.requiresClearance || a.clearanceCounts.pending <= 0) return false;
  if (a.phase === "RUNNING") return true;
  if (a.phase !== "UPCOMING") return false;
  const now = serverNow ? Date.parse(serverNow) : Date.now();
  return Date.parse(a.startsAt) - now <= WARN_BEFORE_MS;
}

/** What the form starts from when the teacher edits an assessment that is saved. */
export function formInitialOf(a: AssessmentDetail) {
  const items: PickedQuestion[] = a.items.map((i) => ({ questionId: i.questionId, title: i.title, kind: i.kind, difficulty: i.difficulty, weight: i.weight }));
  const drawRules: DrawRule[] = a.drawRules;
  return {
    title: a.title,
    description: a.description,
    type: a.type,
    maxScore: a.maxScore,
    durationMinutes: a.durationMinutes,
    moduleId: a.moduleId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    composition: a.composition,
    items,
    drawRules,
    audience: a.audience,
    modality: a.modality,
    requiresClearance: a.requiresClearance,
    studentIds: a.students.map((s) => s.studentId),
    teacherPrivateNotes: a.teacherPrivateNotes,
  };
}

/** The situations a list is divided in, in the order they are shown (SPEC-080 D-02). */
export const SITUATIONS = ["RUNNING", "UPCOMING", "ENDED", "CANCELED"] as const;
export type Situation = (typeof SITUATIONS)[number];

/** The situation of an assessment: a canceled one is "CANCELED" in any phase. */
export const situationKey = (a: Pick<AssessmentBase, "status" | "phase">): Situation => (a.status === "CANCELED" ? "CANCELED" : a.phase);

/**
 * The assessments by situation, with what matters now first (SPEC-080 CA-01, CA-02): the ones that are on and the ones that come are ordered
 * by the start, the next first; the ones that are over and the canceled ones, the latest first. A situation with nothing is left out.
 */
export function groupBySituation<T extends Pick<AssessmentBase, "status" | "phase" | "startsAt">>(items: T[]): { situation: Situation; items: T[] }[] {
  return SITUATIONS.map((situation) => {
    const ahead = situation === "RUNNING" || situation === "UPCOMING";
    const own = items.filter((a) => situationKey(a) === situation).sort((x, y) => (Date.parse(x.startsAt) - Date.parse(y.startsAt)) * (ahead ? 1 : -1));
    return { situation, items: own };
  }).filter((group) => group.items.length > 0);
}
