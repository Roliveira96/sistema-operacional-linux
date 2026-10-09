import { httpClient, type HttpClient } from "./httpClient";

export type BlockType = "TEXT" | "COMMAND" | "TIP" | "CURIOSITY" | "STEP_BY_STEP" | "CARDS" | "WIDGET" | "LEGACY_HTML";

export interface ContentBlock {
  id: string;
  type: BlockType | string;
  position: number;
  payload: Record<string, unknown>;
}

export interface PublicQuestion {
  id: string;
  kind: string;
  usage: "EXERCISE" | "ASSESSMENT";
  difficulty: "EASY" | "MEDIUM" | "HARD";
  title: string;
  statement: string;
  hint?: string;
  choices?: string[];
  /** Reference solution of practical training exercises (SPEC-016 P-02). */
  solution?: Array<{ command: string; terminal?: number; login?: { user: string; password: string }; answers?: string[] }>;
}

export interface AssessmentTemplateSummary {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  questionCount: number;
}

/** Read endpoints of SPEC-012. Answers never reach these responses. */
export function createContentService(client: HttpClient = httpClient) {
  return {
    blocks: async (moduleId: string) =>
      (await client.get<{ blocks: ContentBlock[] }>(`/modules/${encodeURIComponent(moduleId)}/blocks`)).blocks,
    questions: async (moduleId: string, usage?: "EXERCISE" | "ASSESSMENT") =>
      (
        await client.get<{ questions: PublicQuestion[] }>(
          `/modules/${encodeURIComponent(moduleId)}/questions${usage ? `?usage=${usage}` : ""}`,
        )
      ).questions,
    templates: async () => (await client.get<{ items: AssessmentTemplateSummary[] }>("/assessment-templates")).items,
  };
}

export type ContentService = ReturnType<typeof createContentService>;

export const contentService = createContentService();
