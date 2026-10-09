import { parseSetup } from "@/lib/setup";
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
  /** Reference solution of practical exercises (SPEC-016, P-02); never sent on assessments. */
  solution?: { command: string; terminal?: number }[];
}

export interface AssessmentTemplateSummary {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  questionCount: number;
}

export interface BlockProgressResult {
  blockId: string;
  completed: boolean;
  completedAt?: string;
}

export interface ModuleBlockProgressResult {
  moduleId: string;
  completedBlockIds: string[];
  completedAtByBlock: Record<string, string>;
}

/** Read endpoints of SPEC-012. Answers never reach these responses. */
export function createContentService(client: HttpClient = httpClient) {
  return {
    /** The blocks of the module and its snapshot, as the published version has them; `draft` asks for the version being edited (authors only). */
    content: async (moduleId: string, draft = false) => {
      const r = await client.get<{ blocks: ContentBlock[]; setup?: unknown }>(`/modules/${encodeURIComponent(moduleId)}/blocks${draft ? "?draft=true" : ""}`);
      return { blocks: r.blocks, setup: parseSetup(r.setup) };
    },
    questions: async (moduleId: string, usage?: "EXERCISE" | "ASSESSMENT") =>
      (
        await client.get<{ questions: PublicQuestion[] }>(
          `/modules/${encodeURIComponent(moduleId)}/questions${usage ? `?usage=${usage}` : ""}`,
        )
      ).questions,
    templates: async () => (await client.get<{ items: AssessmentTemplateSummary[] }>("/assessment-templates")).items,
    toggleBlockProgress: async (blockId: string, completed = true) =>
      client.post<BlockProgressResult>(`/blocks/${encodeURIComponent(blockId)}/progress`, { completed }),
    getModuleBlockProgress: async (moduleId: string) =>
      client.get<ModuleBlockProgressResult>(`/modules/${encodeURIComponent(moduleId)}/blocks/progress`),
  };
}

export type ContentService = ReturnType<typeof createContentService>;

export const contentService = createContentService();
