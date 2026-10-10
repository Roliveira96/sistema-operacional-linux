import { httpClient, type HttpClient } from "./httpClient";

export interface CheckResult {
  passed: boolean;
  completedAt: string | null;
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
}

/** Practice endpoints of SPEC-014. */
export function createPracticeService(client: HttpClient = httpClient) {
  return {
    scenario: async (questionId: string) =>
      (await client.get<{ snapshot: unknown }>(`/questions/${encodeURIComponent(questionId)}/scenario`)).snapshot,
    check: (questionId: string, snapshot: unknown) =>
      client.post<CheckResult>(`/questions/${encodeURIComponent(questionId)}/check`, { snapshot }),
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
