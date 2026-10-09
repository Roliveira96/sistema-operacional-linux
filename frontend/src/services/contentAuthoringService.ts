import type { BlockType } from "./contentService";
import { httpClient, type HttpClient } from "./httpClient";

/** A block as the authoring routes return it (SPEC-019 5.1). */
export interface AuthoredBlock {
  id: string;
  type: BlockType | string;
  position: number;
  payload: Record<string, unknown>;
  /** True once someone edited it, so the initial load leaves it alone. */
  edited: boolean;
  /** False when the block was inactivated and students no longer see it. */
  active: boolean;
  /** The instant to send back when saving, to detect a change by someone else. */
  updatedAt: string;
}

/** One block of a card, as saved (SPEC-019 5.7). A block with an id is updated in place. */
export interface CardBlockInput {
  id?: string;
  updatedAt?: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface SaveCardRequest {
  /** The current blocks of the card; empty for a new one. */
  replaceIds: string[];
  /** A new card goes after this block; without it, at the end. */
  afterBlockId?: string;
  force?: boolean;
  /** An empty list removes the card. */
  blocks: CardBlockInput[];
}

/** Authoring endpoints of SPEC-019, for ADMIN and the TEACHER who owns the module. */
export function createContentAuthoringService(client: HttpClient = httpClient) {
  const moduleBlocks = (id: string) => `/teacher/modules/${encodeURIComponent(id)}/blocks`;
  const moduleCards = (id: string) => `/teacher/modules/${encodeURIComponent(id)}/cards`;

  return {
    list: async (moduleId: string) => (await client.get<{ blocks: AuthoredBlock[] }>(moduleBlocks(moduleId))).blocks,
    /** Records the machine an author prepared and returns its id (SPEC-020 5.1). */
    createEnvironment: async (moduleId: string, snapshot: unknown) =>
      (await client.post<{ scenarioId: string }>(`/teacher/modules/${encodeURIComponent(moduleId)}/environments`, { snapshot })).scenarioId,
    /** Reads a recorded machine, to go on from where another card stopped (SPEC-020 5.2). */
    getEnvironment: async (scenarioId: string) =>
      (await client.get<{ snapshot: unknown }>(`/teacher/environments/${encodeURIComponent(scenarioId)}`)).snapshot,
    saveCard: async (moduleId: string, request: SaveCardRequest) =>
      (await client.put<{ blocks: AuthoredBlock[] }>(moduleCards(moduleId), request)).blocks,
    setCardActive: async (moduleId: string, blockIds: string[], active: boolean) =>
      (await client.put<{ blocks: AuthoredBlock[] }>(`${moduleCards(moduleId)}/active`, { blockIds, active })).blocks,
    reorder: async (moduleId: string, blockIds: string[]) =>
      (await client.put<{ blocks: AuthoredBlock[] }>(`${moduleBlocks(moduleId)}/order`, { blockIds })).blocks,
  };
}

export type ContentAuthoringService = ReturnType<typeof createContentAuthoringService>;

export const contentAuthoringService = createContentAuthoringService();
