import { httpClient, type HttpClient } from "./httpClient";

/** The bands of a grade: the percentage of what is right (SPEC-039 RN-05). */
export const SCORE_BANDS = [0, 25, 50, 75, 100] as const;

export type AnswerStatus = "PENDING" | "SUGGESTED" | "GRADED";
export const ANSWER_STATUSES: AnswerStatus[] = ["PENDING", "SUGGESTED", "GRADED"];

/** The suggestion an AI kept through the MCP; never a grade on its own (SPEC-039 RN-04). */
export interface Suggestion {
  score: number;
  reason: string;
  studentNote: string;
}

/** The grade the teacher confirmed, with where it came from and her notes (SPEC-039 RN-05, D-06). */
export interface Grade {
  score: number;
  source: "AI_ACCEPTED" | "TEACHER";
  studentNote: string;
  privateNote: string;
}

/** A descriptive answer as the teacher corrects it. */
export interface DescriptiveAnswer {
  /** The id of the progress of the student on the question. */
  id: string;
  questionId: string;
  questionTitle: string;
  statement: string;
  expectedAnswer: string;
  response: string;
  studentName: string;
  answeredAt: string;
  status: AnswerStatus;
  suggestion: Suggestion | null;
  grade: Grade | null;
}

/** What the teacher confirms: the suggestion as it is or a band of her own, the notes and, when she revises a grade, the reason. */
export interface GradeInput {
  useSuggestion?: boolean;
  score?: number;
  studentNote: string;
  privateNote: string;
  reason?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const band = (v: unknown): number | null => (SCORE_BANDS.find((b) => b === v) ?? null);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);

/** An answer as the server returns it. */
export function parseAnswer(raw: Record<string, unknown>): DescriptiveAnswer {
  const s = obj(raw.suggestion);
  const g = obj(raw.grade);
  const suggested = band(s?.score);
  const graded = band(g?.score);
  return {
    id: str(raw.progressId),
    questionId: str(raw.questionId),
    questionTitle: str(raw.questionTitle),
    statement: str(raw.statement),
    expectedAnswer: str(raw.expectedAnswer),
    response: str(raw.response),
    studentName: str(raw.studentName),
    answeredAt: str(raw.answeredAt),
    status: ANSWER_STATUSES.includes(raw.status as AnswerStatus) ? (raw.status as AnswerStatus) : "PENDING",
    suggestion: s && suggested !== null ? { score: suggested, reason: str(s.reason), studentNote: str(s.studentNote) } : null,
    grade:
      g && graded !== null
        ? { score: graded, source: g.source === "AI_ACCEPTED" ? "AI_ACCEPTED" : "TEACHER", studentNote: str(g.studentNote), privateNote: str(g.privateNote) }
        : null,
  };
}

/** Routes of the correction of descriptive answers (SPEC-039 5), for ADMIN and the TEACHER who owns the module. */
export function createGradingService(client: HttpClient = httpClient) {
  return {
    list: async (moduleId: string, status: AnswerStatus | "all"): Promise<DescriptiveAnswer[]> => {
      const query = status === "all" ? "" : `?status=${status}`;
      const r = await client.get<{ items: Record<string, unknown>[] }>(`/teacher/modules/${encodeURIComponent(moduleId)}/answers${query}`);
      return (r.items ?? []).map(parseAnswer);
    },
    grade: async (answerId: string, input: GradeInput): Promise<DescriptiveAnswer> =>
      parseAnswer(await client.put<Record<string, unknown>>(`/teacher/answers/${encodeURIComponent(answerId)}/grade`, input)),
  };
}

export type GradingService = ReturnType<typeof createGradingService>;

export const gradingService = createGradingService();
