import { describe, expect, it, vi } from "vitest";
import { createClassService } from "./classService";
import type { HttpClient } from "./httpClient";

describe("classService", () => {
  const fakeClient: HttpClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };

  const service = createClassService(fakeClient);

  it("calls listClasses with query parameters", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce({
      items: [],
      totalCount: 0,
      page: 1,
      limit: 10,
    });

    await service.listClasses({ page: 2, limit: 10, status: "ACTIVE", search: "Sistemas" });

    expect(fakeClient.get).toHaveBeenCalledWith("/classes?page=2&limit=10&status=ACTIVE&search=Sistemas");
  });

  it("calls getClass with id", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce({ id: "123", name: "SO" });

    const result = await service.getClass("123");

    expect(fakeClient.get).toHaveBeenCalledWith("/classes/123");
    expect(result).toEqual({ id: "123", name: "SO" });
  });

  it("calls createClass with payload", async () => {
    const payload = {
      name: "SO",
      courseCode: "SO34E",
      semester: "2026/2",
      startDate: "2026-10-01T00:00:00Z",
      endDate: "2026-12-01T00:00:00Z",
    };
    vi.mocked(fakeClient.post).mockResolvedValueOnce({ id: "class-1", ...payload });

    await service.createClass(payload);

    expect(fakeClient.post).toHaveBeenCalledWith("/classes", payload);
  });

  it("calls updateClass with id and partial payload", async () => {
    vi.mocked(fakeClient.patch).mockResolvedValueOnce({ id: "class-1", name: "Updated" });

    await service.updateClass("class-1", { name: "Updated" });

    expect(fakeClient.patch).toHaveBeenCalledWith("/classes/class-1", { name: "Updated" });
  });

  it("calls archiveClass with reason", async () => {
    vi.mocked(fakeClient.post).mockResolvedValueOnce({ id: "class-1", status: "ARCHIVED" });

    await service.archiveClass("class-1", "Motivo de encerramento");

    expect(fakeClient.post).toHaveBeenCalledWith("/classes/class-1/archive", { reason: "Motivo de encerramento" });
  });

  it("calls joinByToken with token", async () => {
    vi.mocked(fakeClient.post).mockResolvedValueOnce({ enrollmentId: "e-1", className: "SO", status: "PENDING_MODERATION" });

    await service.joinByToken("tok123");

    expect(fakeClient.post).toHaveBeenCalledWith("/classes/join/tok123");
  });

  it("calls listMembers with status filter", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce([]);

    await service.listMembers("class-1", "PENDING_MODERATION");

    expect(fakeClient.get).toHaveBeenCalledWith("/classes/class-1/members?status=PENDING_MODERATION");
  });

  it("calls moderateMember with approval or rejection", async () => {
    vi.mocked(fakeClient.post).mockResolvedValueOnce({ id: "e-1", status: "ACTIVE" });

    await service.moderateMember("class-1", "e-1", true);

    expect(fakeClient.post).toHaveBeenCalledWith("/classes/class-1/members/e-1/moderate", {
      approve: true,
      rejectionReason: undefined,
    });
  });
});
