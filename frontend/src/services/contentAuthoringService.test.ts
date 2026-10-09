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

  it("creates at the end, or after a block", async () => {
    await service.create("m", "TIP", { html: "x" });
    expect(client.post).toHaveBeenCalledWith("/teacher/modules/m/blocks", { type: "TIP", payload: { html: "x" } });
    await service.create("m", "TIP", { html: "x" }, "b-1");
    expect(client.post).toHaveBeenLastCalledWith("/teacher/modules/m/blocks", { type: "TIP", payload: { html: "x" }, afterBlockId: "b-1" });
  });

  it("updates with the instant it knew, or forces", async () => {
    await service.update("b", { html: "x" }, "2026-10-09T12:00:00Z");
    expect(client.patch).toHaveBeenCalledWith("/teacher/blocks/b", { payload: { html: "x" }, expectedUpdatedAt: "2026-10-09T12:00:00Z" });
    await service.update("b", { html: "x" }, "2026-10-09T12:00:00Z", true);
    expect(client.patch).toHaveBeenLastCalledWith("/teacher/blocks/b", { payload: { html: "x" }, force: true });
  });

  it("removes and reorders", async () => {
    await service.remove("b");
    expect(client.delete).toHaveBeenCalledWith("/teacher/blocks/b");
    vi.mocked(client.put).mockResolvedValueOnce({ blocks: [] });
    await service.reorder("m", ["b2", "b1"]);
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m/blocks/order", { blockIds: ["b2", "b1"] });
  });
});
