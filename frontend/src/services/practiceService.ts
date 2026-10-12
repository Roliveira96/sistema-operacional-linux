import { httpClient, type HttpClient } from "./httpClient";

export interface CheckResult {
  passed: boolean;
  completedAt: string | null;
}

/** The single answer to a true or false question (SPEC-035 RN-06): the result, the correct answer and the justification. */
export interface AnswerResult {
  passed: boolean;
  completedAt: string | null;
  /** The correct answer of a true or false question. */
  correctAnswer?: boolean;
  /** The id of the correct alternative of a single choice question (SPEC-036 RN-05). */
  correctChoice?: string;
  explanation?: string | null;
}

export interface ModuleCheckResult {
  /** Questions met by the machine state. */
  passed: string[];
  /** Every question the student has already completed in the module. */
  progress: { questionId: string; completedAt: string | null }[];
}

export interface ProgressItem {
  questionId: string;
  completedAt: string | null;
  attempts: number;
  /** An answered true or false question: the answer given, whether it was right, the correct answer and the justification. */
  response?: { value?: boolean; choice?: string };
  passed?: boolean;
  correctAnswer?: boolean;
  correctChoice?: string;
  explanation?: string | null;
}

/** Practice endpoints of SPEC-014. */
export function createPracticeService(client: HttpClient = httpClient) {
  return {
    scenario: async (questionId: string) =>
      (await client.get<{ snapshot: unknown }>(`/questions/${encodeURIComponent(questionId)}/scenario`)).snapshot,
    check: (questionId: string, snapshot: unknown) =>
      client.post<CheckResult>(`/questions/${encodeURIComponent(questionId)}/check`, { snapshot }),
    /** Sends the single answer of the student to a true or false question; a second one is refused with 409 (SPEC-035 RN-08). */
    answer: (questionId: string, value: boolean) =>
      client.post<AnswerResult>(`/questions/${encodeURIComponent(questionId)}/check`, { response: { value } }),
    /** Sends the single answer of the student to a single choice question: the id of the alternative chosen (SPEC-036 RN-06). */
    choose: (questionId: string, choice: string) =>
      client.post<AnswerResult>(`/questions/${encodeURIComponent(questionId)}/check`, { response: { choice } }),
    /** Machine of the module topic (SPEC-016); null means the default machine. */
    topicScenario: async (moduleId: string) =>
      (await client.get<{ snapshot: unknown }>(`/modules/${encodeURIComponent(moduleId)}/scenario`)).snapshot ?? null,
    /** Checks every challenge of the module against the machine state. */
    checkModule: (moduleId: string, snapshot: unknown) =>
      client.post<ModuleCheckResult>(`/modules/${encodeURIComponent(moduleId)}/check`, { snapshot }),
    progress: async (moduleId: string) =>
      (await client.get<{ items: ProgressItem[] }>(`/modules/${encodeURIComponent(moduleId)}/progress`)).items,
  };
}

export type PracticeService = ReturnType<typeof createPracticeService>;

export const practiceService = createPracticeService();
