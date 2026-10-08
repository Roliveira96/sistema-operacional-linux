import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "./httpClient";
import {
  createStudentManual,
  getStudentProfile,
  importStudentsCSV,
  joinByInvite,
  listStudents,
  uploadAvatar,
} from "./studentService";

describe("studentService", () => {
  const fakeClient: HttpClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };

  it("calls createStudentManual with payload", async () => {
    const payload = {
      academicId: "1234567",
      email: "aluno@utfpr.edu.br",
      name: "João Silva",
    };
    vi.mocked(fakeClient.post).mockResolvedValueOnce({
      id: "std-1",
      academicId: "1234567",
      email: "aluno@utfpr.edu.br",
      enrollmentStatus: "NOT_ENROLLED",
      createdAt: "2026-10-08T00:00:00Z",
    });

    const res = await createStudentManual(payload, fakeClient);

    expect(fakeClient.post).toHaveBeenCalledWith("/students", payload);
    expect(res.id).toBe("std-1");
  });

  it("calls importStudentsCSV with file and optional classGroupId", async () => {
    const file = new File(["email,academic_id\na@b.com,1234567"], "alunos.csv", {
      type: "text/csv",
    });
    vi.mocked(fakeClient.post).mockResolvedValueOnce({
      totalRows: 1,
      created: 1,
      enrolled: 1,
      alreadyEnrolled: 0,
      errors: [],
    });

    const res = await importStudentsCSV(file, "class-123", fakeClient);

    expect(fakeClient.post).toHaveBeenCalledWith(
      "/students/import-csv",
      expect.any(FormData)
    );
    expect(res.totalRows).toBe(1);
    expect(res.created).toBe(1);
  });

  it("calls listStudents with query parameters", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce({
      items: [],
      totalCount: 0,
      page: 1,
      perPage: 20,
    });

    await listStudents({ page: 2, perPage: 15, search: "Silva" }, fakeClient);

    expect(fakeClient.get).toHaveBeenCalledWith(
      "/students?page=2&perPage=15&search=Silva"
    );
  });

  it("calls listStudents without query parameters if none provided", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce({
      items: [],
      totalCount: 0,
      page: 1,
      perPage: 20,
    });

    await listStudents({}, fakeClient);

    expect(fakeClient.get).toHaveBeenCalledWith("/students");
  });

  it("calls getStudentProfile", async () => {
    vi.mocked(fakeClient.get).mockResolvedValueOnce({
      id: "std-1",
      academicId: "1234567",
      email: "aluno@utfpr.edu.br",
      name: "João",
      createdAt: "2026-10-08T00:00:00Z",
    });

    const res = await getStudentProfile(fakeClient);

    expect(fakeClient.get).toHaveBeenCalledWith("/students/me");
    expect(res.academicId).toBe("1234567");
  });

  it("calls uploadAvatar with FormData", async () => {
    const file = new File(["fake-image-bytes"], "avatar.png", { type: "image/png" });
    vi.mocked(fakeClient.patch).mockResolvedValueOnce({
      avatarUrl: "http://storage/avatar.webp",
    });

    const res = await uploadAvatar(file, fakeClient);

    expect(fakeClient.patch).toHaveBeenCalledWith(
      "/students/me/avatar",
      expect.any(FormData)
    );
    expect(res.avatarUrl).toBe("http://storage/avatar.webp");
  });

  it("calls joinByInvite with token and payload", async () => {
    const payload = {
      academicId: "1234567",
      email: "aluno@utfpr.edu.br",
      name: "João",
      password: "StrongPassword123!",
    };
    vi.mocked(fakeClient.post).mockResolvedValueOnce({
      userId: "u-1",
      accountStatus: "ACTIVE",
      enrollmentStatus: "PENDING_MODERATION",
    });

    const res = await joinByInvite("tok-abc", payload, fakeClient);

    expect(fakeClient.post).toHaveBeenCalledWith("/invites/tok-abc/join", payload);
    expect(res.enrollmentStatus).toBe("PENDING_MODERATION");
  });
});
