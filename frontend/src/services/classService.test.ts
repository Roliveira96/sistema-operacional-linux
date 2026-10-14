import { describe, expect, it, vi } from "vitest";
import { createClassService } from "./classService";
import { ApiProblemError, type HttpClient } from "./httpClient";

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

  it("reads the classes of the signed-in user", async () => {
    const body = { items: [{ id: "1", name: "SO", courseCode: "SO1", semester: "2026/2", relation: "TEACHER" }], total: 1 };
    vi.mocked(fakeClient.get).mockResolvedValueOnce(body);
    await expect(service.myClasses()).resolves.toEqual(body);
    expect(fakeClient.get).toHaveBeenCalledWith("/me/classes");
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

  // SPEC-048
  it("reads the links of a class", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce({ links: [{ id: "l-1", name: "Meet", url: "https://a.com", position: 0 }] });
    const links = await service.getLinks("class-1");
    expect(fakeClient.get).toHaveBeenCalledWith("/classes/class-1/links");
    expect(links).toEqual([{ id: "l-1", name: "Meet", url: "https://a.com", position: 0 }]);
  });

  // SPEC-048
  it("replaces the whole list of links of a class", async () => {
    vi.mocked(fakeClient.put).mockResolvedValueOnce({ links: [{ id: "l-1", name: "Meet", url: "https://a.com", position: 0 }] });
    const links = await service.replaceLinks("class-1", [{ name: "Meet", url: "https://a.com" }]);
    expect(fakeClient.put).toHaveBeenCalledWith("/classes/class-1/links", { links: [{ name: "Meet", url: "https://a.com" }] });
    expect(links).toHaveLength(1);
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

  // SPEC-041, section 5.1 (CA-03): enrolls a batch of existing students.
  it("enrolls existing students in a class", async () => {
    const result = { enrolled: ["s-1"], alreadyEnrolled: ["s-2"], rejected: [{ studentId: "s-3", reason: "not-a-student" }] };
    vi.mocked(fakeClient.post).mockResolvedValueOnce(result);

    await expect(service.enrollStudents("c-1", ["s-1", "s-2", "s-3"])).resolves.toEqual(result);
    expect(fakeClient.post).toHaveBeenCalledWith("/classes/c-1/enrollments", { studentIds: ["s-1", "s-2", "s-3"] });
  });

  // SPEC-041, section 5.2 (CA-13, CA-14): reads the class of an enrolled student, and passes the problem on.
  it("reads the class of the signed-in student", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce({ id: "c-1", name: "SO", summary: "Resumo" });
    await expect(service.getMyClass("c-1")).resolves.toEqual({ id: "c-1", name: "SO", summary: "Resumo" });
    expect(fakeClient.get).toHaveBeenCalledWith("/me/classes/c-1");

    const notFound = new ApiProblemError({ type: "class-not-found", status: 404 }, 404);
    vi.mocked(fakeClient.get).mockRejectedValueOnce(notFound);
    await expect(service.getMyClass("c-2")).rejects.toBe(notFound);
  });

  // SPEC-050
  it("deletes a class", async () => {
    vi.mocked(fakeClient.delete).mockResolvedValueOnce(undefined);
    await service.deleteClass("class-1");
    expect(fakeClient.delete).toHaveBeenCalledWith("/classes/class-1");
  });
});
