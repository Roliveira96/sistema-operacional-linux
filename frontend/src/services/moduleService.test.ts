import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModuleService } from "./moduleService";
import type { HttpClient } from "./httpClient";

describe("ModuleService", () => {
  let client: HttpClient;
  let service: ModuleService;

  beforeEach(() => {
    client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as HttpClient;
    service = new ModuleService(client);
  });

  it("calls listPublicModules with correct parameters", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 10 });

    const res = await service.listPublicModules({ page: 2, limit: 5, search: "linux" });
    expect(client.get).toHaveBeenCalledWith("/modules/public?page=2&limit=5&search=linux");
    expect(res.total).toBe(0);
  });

  it("calls listModules with filters", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 10 });

    await service.listModules({ page: 1, status: "ACTIVE", visibility: "PRIVATE", classId: "class-1" });
    expect(client.get).toHaveBeenCalledWith("/modules?page=1&status=ACTIVE&visibility=PRIVATE&classId=class-1");
  });

  it("calls getModuleById with path id", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ id: "mod-1", title: "Mod" });

    const res = await service.getModuleById("mod-1");
    expect(client.get).toHaveBeenCalledWith("/modules/mod-1");
    expect(res.id).toBe("mod-1");
  });

  it("calls createModule with payload", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ id: "mod-1" });

    const payload = { title: "Title", description: "Desc", visibility: "PUBLIC" as const };
    const res = await service.createModule(payload);
    expect(client.post).toHaveBeenCalledWith("/modules", payload);
    expect(res.id).toBe("mod-1");
  });

  it("calls updateModule with payload", async () => {
    vi.mocked(client.patch).mockResolvedValueOnce({ id: "mod-1" });

    const res = await service.updateModule("mod-1", { title: "Updated" });
    expect(client.patch).toHaveBeenCalledWith("/modules/mod-1", { title: "Updated" });
    expect(res.id).toBe("mod-1");
  });

  it("calls reorderExercises with payload", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ message: "ok", reorderedCount: 2 });

    const res = await service.reorderExercises("mod-1", ["ex-1", "ex-2"]);
    expect(client.put).toHaveBeenCalledWith("/modules/mod-1/exercises/order", {
      orderedExerciseIds: ["ex-1", "ex-2"],
    });
    expect(res.reorderedCount).toBe(2);
  });
});
