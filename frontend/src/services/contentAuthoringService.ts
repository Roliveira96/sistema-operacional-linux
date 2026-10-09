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

/** Authoring endpoints of SPEC-019, for ADMIN and the TEACHER who owns the module. */
export function createContentAuthoringService(client: HttpClient = httpClient) {
  const moduleBlocks = (id: string) => `/teacher/modules/${encodeURIComponent(id)}/blocks`;
  const block = (id: string) => `/teacher/blocks/${encodeURIComponent(id)}`;

  return {
    list: async (moduleId: string) => (await client.get<{ blocks: AuthoredBlock[] }>(moduleBlocks(moduleId))).blocks,
    create: (moduleId: string, type: string, payload: Record<string, unknown>, afterBlockId?: string) =>
      client.post<AuthoredBlock>(moduleBlocks(moduleId), { type, payload, ...(afterBlockId ? { afterBlockId } : {}) }),
    update: (blockId: string, payload: Record<string, unknown>, expectedUpdatedAt: string, force = false) =>
      client.patch<AuthoredBlock>(block(blockId), force ? { payload, force: true } : { payload, expectedUpdatedAt }),
    setActive: (blockId: string, active: boolean) => client.put<AuthoredBlock>(`${block(blockId)}/active`, { active }),
    remove: (blockId: string) => client.delete<void>(block(blockId)),
    reorder: async (moduleId: string, blockIds: string[]) =>
      (await client.put<{ blocks: AuthoredBlock[] }>(`${moduleBlocks(moduleId)}/order`, { blockIds })).blocks,
  };
}

export type ContentAuthoringService = ReturnType<typeof createContentAuthoringService>;

export const contentAuthoringService = createContentAuthoringService();
