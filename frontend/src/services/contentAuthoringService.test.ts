import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContentAuthoringService } from "./contentAuthoringService";
import type { HttpClient } from "./httpClient";

describe("contentAuthoringService", () => {
  let client: HttpClient;
  let service: ReturnType<typeof createContentAuthoringService>;

  beforeEach(() => {
    client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
    service = createContentAuthoringService(client);
  });

  it("lists the blocks of a module", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ blocks: [{ id: "b" }] });
    expect(await service.list("m 1")).toEqual([{ id: "b" }]);
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m%201/blocks");
  });

  it("saves a whole card and returns its blocks", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ blocks: [{ id: "b1" }] });
    const request = { replaceIds: ["b1"], blocks: [{ id: "b1", updatedAt: "2026-10-09T12:00:00Z", type: "TEXT", payload: { html: "x" } }] };
    expect(await service.saveCard("m", request)).toEqual([{ id: "b1" }]);
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m/cards", request);
  });

  it("records an environment and reads it back (SPEC-020)", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ scenarioId: "s-1" });
    expect(await service.createEnvironment("m 1", { formato: "x" })).toBe("s-1");
    expect(client.post).toHaveBeenCalledWith("/teacher/modules/m%201/environments", { snapshot: { formato: "x" } });
    vi.mocked(client.get).mockResolvedValueOnce({ scenarioId: "s-1", snapshot: { formato: "x" } });
    expect(await service.getEnvironment("s-1")).toEqual({ formato: "x" });
    expect(client.get).toHaveBeenLastCalledWith("/teacher/environments/s-1");
  });

  it("inactivates the blocks of a card", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ blocks: [] });
    await service.setCardActive("m", ["a", "b"], false);
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m/cards/active", { blockIds: ["a", "b"], active: false });
  });

  it("reorders the blocks", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ blocks: [] });
    await service.reorder("m", ["b2", "b1"]);
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m/blocks/order", { blockIds: ["b2", "b1"] });
  });
});
