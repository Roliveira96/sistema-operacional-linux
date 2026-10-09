import { httpClient, type HttpClient } from "./httpClient";

export interface ProgressItem {
  questionId: string;
  completedAt: string | null;
  attempts: number;
}

export interface ModuleCheckResult {
  /** Exercises the submitted machine satisfies now. */
  passed: string[];
  progress: ProgressItem[];
}

/** Practice endpoints of SPEC-014 and SPEC-016. */
export function createPracticeService(client: HttpClient = httpClient) {
  const moduleUrl = (moduleId: string) => `/modules/${encodeURIComponent(moduleId)}`;
  return {
    /** Starting machine of one exercise. */
    scenario: async (questionId: string) =>
      (await client.get<{ snapshot: unknown }>(`/questions/${encodeURIComponent(questionId)}/scenario`)).snapshot,
    /** Prepared machine of the module topic; null means the default machine. */
    topicScenario: async (moduleId: string) => (await client.get<{ snapshot: unknown }>(`${moduleUrl(moduleId)}/scenario`)).snapshot ?? null,
    /** Grades every exercise of the module against the machine. */
    checkModule: (moduleId: string, snapshot: unknown) => client.post<ModuleCheckResult>(`${moduleUrl(moduleId)}/check`, { snapshot }),
    progress: async (moduleId: string) => (await client.get<{ items: ProgressItem[] }>(`${moduleUrl(moduleId)}/progress`)).items,
  };
}

export type PracticeService = ReturnType<typeof createPracticeService>;

export const practiceService = createPracticeService();
