import { httpClient, type HttpClient } from "./httpClient";

export interface CheckResult {
  passed: boolean;
  completedAt: string | null;
}

export interface ProgressItem {
  questionId: string;
  completedAt: string | null;
  attempts: number;
}

/** Practice endpoints of SPEC-014. */
export function createPracticeService(client: HttpClient = httpClient) {
  return {
    scenario: async (questionId: string) =>
      (await client.get<{ snapshot: unknown }>(`/questions/${encodeURIComponent(questionId)}/scenario`)).snapshot,
    check: (questionId: string, snapshot: unknown) =>
      client.post<CheckResult>(`/questions/${encodeURIComponent(questionId)}/check`, { snapshot }),
    progress: async (moduleId: string) =>
      (await client.get<{ items: ProgressItem[] }>(`/modules/${encodeURIComponent(moduleId)}/progress`)).items,
  };
}

export type PracticeService = ReturnType<typeof createPracticeService>;

export const practiceService = createPracticeService();
