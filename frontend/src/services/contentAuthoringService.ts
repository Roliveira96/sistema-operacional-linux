import type { BlockType } from "./contentService";
import { parseSetup, setupPayload, type Setup } from "@/lib/setup";
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
  /** When it was created, and the names of who created and last changed it (empty for what came from the initial load). */
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
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

/** One published version of a module (SPEC-021). */
export interface ModuleVersion {
  number: number;
  note: string;
  createdAt: string;
  createdBy: string;
  blockCount: number;
  /** The one students read. */
  current: boolean;
}

/** Authoring endpoints of SPEC-019, for ADMIN and the TEACHER who owns the module. */
export function createContentAuthoringService(client: HttpClient = httpClient) {
  const moduleBlocks = (id: string) => `/teacher/modules/${encodeURIComponent(id)}/blocks`;
  const moduleVersions = (id: string) => `/teacher/modules/${encodeURIComponent(id)}/versions`;
  const moduleCards = (id: string) => `/teacher/modules/${encodeURIComponent(id)}/cards`;

  return {
    list: async (moduleId: string) => (await client.get<{ blocks: AuthoredBlock[] }>(moduleBlocks(moduleId))).blocks,
    /** The blocks and the snapshot of the module (SPEC-021 6). */
    content: async (moduleId: string) => {
      const r = await client.get<{ blocks: AuthoredBlock[]; setup?: unknown }>(moduleBlocks(moduleId));
      return { blocks: r.blocks, setup: parseSetup(r.setup) };
    },
    /** Stores the snapshot of the module, shared by every card (SPEC-021 6). */
    setModuleSetup: async (moduleId: string, setup: Setup) =>
      parseSetup((await client.put<{ setup?: unknown }>(`/teacher/modules/${encodeURIComponent(moduleId)}/setup`, setupPayload(setup))).setup),
    /** The versions, the newest first, and whether the draft differs from the latest (SPEC-021). */
    versions: async (moduleId: string) => {
      const r = await client.get<{ versions: ModuleVersion[]; hasUnpublishedChanges: boolean }>(`${moduleVersions(moduleId)}`);
      return { versions: r.versions, hasUnpublishedChanges: r.hasUnpublishedChanges };
    },
    /** Publishes the draft as the next version; rejects with `no-changes` when it is the same as the latest. */
    publish: async (moduleId: string, note: string) => client.post<{ number: number }>(moduleVersions(moduleId), note.trim() ? { note: note.trim() } : {}),
    /** Copies a version into the draft; it does not publish. */
    restore: async (moduleId: string, number: number) => client.post<{ blocks: AuthoredBlock[] }>(`${moduleVersions(moduleId)}/${number}/restore`, {}),
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
