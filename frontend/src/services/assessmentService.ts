import { messages } from "@/messages/pt-BR";
import { ApiProblemError, httpClient, NetworkError, type HttpClient } from "./httpClient";

const m = messages.assessments;

export type AssessmentType = "EXAM" | "ASSIGNMENT";
export type AssessmentStatus = "SCHEDULED" | "CANCELED";
export type AssessmentPhase = "UPCOMING" | "RUNNING" | "ENDED";
export type Composition = "MANUAL" | "DRAW";
export type Audience = "ALL_CLASS" | "SELECTED";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";

/** What every reader of an assessment gets (SPEC-075, section 5.1); the times are ISO 8601 in Brasília. */
export interface AssessmentBase {
  id: string;
  classId: string;
  classSessionId?: string;
  title: string;
  description: string;
  type: AssessmentType;
  status: AssessmentStatus;
  phase: AssessmentPhase;
  startsAt: string;
  endsAt: string;
  durationMinutes?: number;
  maxScore: number;
  cancelReason?: string;
}

/** What the student reads: only this, never a question, an answer, a weight or a note (RN-09). serverNow is the clock of the countdown. */
export interface AssessmentPublic extends AssessmentBase {
  serverNow: string;
}

/** An assessment of the calendar; the teacher also gets the count and the composition. */
export interface CalendarAssessment extends AssessmentBase {
  eligibleStudents?: number;
  composition?: Composition;
}

/** What the teacher and the administrator read in the list. */
export interface AssessmentSummary extends AssessmentBase {
  moduleId: string;
  moduleTitle: string;
  composition: Composition;
  audience: Audience;
  eligibleStudents: number;
  totalQuestions: number;
  frozen: boolean;
  teacherPrivateNotes: string | null;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
  canceledBy?: string;
  canceledAt?: string;
}

export interface AssessmentItem {
  questionId: string;
  position: number;
  weight: number;
  title: string;
  kind: string;
  difficulty: Difficulty;
}

export interface DrawRule {
  difficulty: Difficulty;
  quantity: number;
  pointsPerQuestion: number;
}

export interface AssessmentStudent {
  studentId: string;
  name: string;
  academicId: string;
}

export interface AssessmentEvent {
  kind: "CREATED" | "UPDATED" | "RESCHEDULED" | "CANCELED";
  actorName: string;
  createdAt: string;
  reason?: string;
  oldStartsAt?: string;
  oldEndsAt?: string;
  newStartsAt?: string;
  newEndsAt?: string;
  changedFields?: string[];
}

export interface AssessmentDetail extends AssessmentSummary {
  items: AssessmentItem[];
  drawRules: DrawRule[];
  students: AssessmentStudent[];
  events: AssessmentEvent[];
  serverNow: string;
}

/** A question of the bank that may enter the assessment, and one that was chosen with its weight. */
export interface EligibleQuestion {
  questionId: string;
  title: string;
  kind: string;
  difficulty: Difficulty;
}
export interface PickedQuestion extends EligibleQuestion {
  weight: number;
}
export type Stock = Partial<Record<Difficulty, number>>;
export interface EligibleQuestions {
  items: EligibleQuestion[];
  total: number;
  stock: Stock;
}
export interface QuestionQuery {
  moduleId: string;
  difficulty?: Difficulty;
  kind?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** A question of the preview, with what only the teacher reads. */
export interface PreviewContent {
  questionId: string;
  title: string;
  kind: string;
  difficulty: Difficulty;
  statement: string;
  answerKey: string;
  explanation: string;
}
export interface PreviewQuestion extends PreviewContent {
  position: number;
  weight: number;
}
export interface PreviewData {
  questions: PreviewQuestion[];
  rules?: DrawRule[];
  stock?: Stock;
  sample?: PreviewContent[];
}

export interface AssessmentInput {
  classSessionId?: string;
  moduleId: string;
  title: string;
  description?: string;
  type: AssessmentType;
  maxScore: number;
  durationMinutes?: number;
  startsAt: string;
  endsAt: string;
  composition: Composition;
  items?: { questionId: string; weight: number }[];
  draw?: { total: number; rules: DrawRule[] };
  audience?: Audience;
  studentIds?: string[];
  teacherPrivateNotes?: string;
}

/** What may change by the PATCH: the dates and the notes have routes of their own (RN-11, RN-13). */
export type AssessmentPatch = Partial<Omit<AssessmentInput, "startsAt" | "endsAt" | "classSessionId" | "teacherPrivateNotes">>;

export interface RescheduleInput {
  startsAt: string;
  endsAt: string;
  reason?: string;
}

type Now<T> = T & { serverNow: string };

/** API client of the assessments of a class (SPEC-075, section 5.2). */
export function createAssessmentService(client: HttpClient = httpClient) {
  const base = (classId: string) => `/classes/${classId}/assessments`;
  return {
    /** The list brings the clock of the server once, outside the items; the student gets the public form of each. */
    list: (classId: string, filter: { phase?: AssessmentPhase; status?: AssessmentStatus } = {}) => {
      const query = new URLSearchParams();
      if (filter.phase) query.set("phase", filter.phase);
      if (filter.status) query.set("status", filter.status);
      const qs = query.toString();
      return client.get<{ items: Array<AssessmentSummary | AssessmentBase>; serverNow: string }>(`${base(classId)}${qs ? `?${qs}` : ""}`);
    },
    /** The detail for the teacher, the public form for the student: the server decides by who asks. */
    get: (classId: string, id: string) => client.get<AssessmentDetail | AssessmentPublic>(`${base(classId)}/${id}`),
    create: (classId: string, input: AssessmentInput) => client.post<Now<AssessmentSummary>>(base(classId), input),
    update: (classId: string, id: string, patch: AssessmentPatch) => client.patch<Now<AssessmentSummary>>(`${base(classId)}/${id}`, patch),
    reschedule: (classId: string, id: string, input: RescheduleInput) => client.put<Now<AssessmentSummary>>(`${base(classId)}/${id}/schedule`, input),
    cancel: (classId: string, id: string, reason: string) => client.post<Now<AssessmentSummary>>(`${base(classId)}/${id}/cancel`, { reason }),
    saveNotes: async (classId: string, id: string, notes: string) =>
      (await client.put<{ teacherPrivateNotes: string }>(`${base(classId)}/${id}/private-notes`, { teacherPrivateNotes: notes })).teacherPrivateNotes,
    preview: (classId: string, id: string) => client.get<PreviewData>(`${base(classId)}/${id}/preview`),
    /** The questions that may enter and the stock of each level, for the form (RN-05, RN-07). */
    eligibleQuestions: (classId: string, query: QuestionQuery) => {
      const qs = new URLSearchParams({ moduleId: query.moduleId });
      for (const key of ["difficulty", "kind", "q", "page", "pageSize"] as const) {
        const value = query[key];
        if (value !== undefined && value !== "") qs.set(key, String(value));
      }
      return client.get<EligibleQuestions>(`/classes/${classId}/assessment-questions?${qs}`);
    },
  };
}

export type AssessmentService = ReturnType<typeof createAssessmentService>;
export const assessmentService = createAssessmentService();

/** Translates an error of the assessment routes into the sentence the teacher reads. */
export function describeAssessmentError(error: unknown): string {
  if (error instanceof NetworkError) return m.networkError;
  if (error instanceof ApiProblemError) {
    if (error.type === "insufficient-stock") {
      const shortages = Array.isArray(error.extensions.shortages) ? (error.extensions.shortages as { difficulty: string; asked: number; available: number }[]) : [];
      const levels = shortages.map((s) => m.stockLevel((m.difficulty[s.difficulty] ?? s.difficulty).toLowerCase(), s.asked, s.available));
      if (levels.length) return m.stockError(levels.join("; "));
    }
    const text = m.errors[error.type];
    if (text) return text;
  }
  return m.unexpectedError;
}
