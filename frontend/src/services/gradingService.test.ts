import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpClient } from "./httpClient";
import { createGradingService, parseAnswer } from "./gradingService";

const stored = {
  progressId: "p1",
  questionId: "q1",
  questionTitle: "Permissions",
  statement: "<p>Explain chmod 750.</p>",
  expectedAnswer: "<p>rwx</p>",
  response: "<p>owner rwx</p>",
  studentName: "Ana",
  answeredAt: "2026-10-12T10:00:00Z",
  status: "SUGGESTED",
  suggestion: { score: 75, reason: "misses the group", studentNote: "Look at the group.", at: "2026-10-12T11:00:00Z" },
};

// Covers SPEC-039 5 (correction) on the screen: the routes of the correction and how an answer is read.
describe("gradingService", () => {
  let client: HttpClient;
  let service: ReturnType<typeof createGradingService>;

  beforeEach(() => {
    client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
    service = createGradingService(client);
  });

  it("reads an answer with the suggestion and the grade", () => {
    expect(parseAnswer(stored)).toEqual({
      id: "p1",
      questionId: "q1",
      questionTitle: "Permissions",
      statement: "<p>Explain chmod 750.</p>",
      expectedAnswer: "<p>rwx</p>",
      response: "<p>owner rwx</p>",
      studentName: "Ana",
      answeredAt: "2026-10-12T10:00:00Z",
      status: "SUGGESTED",
      suggestion: { score: 75, reason: "misses the group", studentNote: "Look at the group." },
      grade: null,
    });
    const graded = parseAnswer({ ...stored, status: "GRADED", grade: { score: 50, source: "TEACHER", studentNote: "Ok", privateNote: "check" } });
    expect(graded.grade).toEqual({ score: 50, source: "TEACHER", studentNote: "Ok", privateNote: "check" });
    const bare = parseAnswer({ progressId: "p2", status: "X", suggestion: { score: 60 } });
    expect(bare).toMatchObject({ status: "PENDING", suggestion: null, grade: null, expectedAnswer: "", response: "" });
  });

  it("lists the answers of a module by situation", async () => {
    vi.mocked(client.get).mockResolvedValue({ items: [stored] });
    const items = await service.list("m 1", "SUGGESTED");
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m%201/answers?status=SUGGESTED");
    expect(items[0]!.id).toBe("p1");
    await service.list("m1", "all");
    expect(client.get).toHaveBeenLastCalledWith("/teacher/modules/m1/answers");
  });

  it("confirms the suggestion or a grade of the teacher", async () => {
    vi.mocked(client.put).mockResolvedValue({ ...stored, status: "GRADED", grade: { score: 75, source: "AI_ACCEPTED" } });
    const saved = await service.grade("p1", { useSuggestion: true, studentNote: "Look at the group.", privateNote: "" });
    expect(client.put).toHaveBeenCalledWith("/teacher/answers/p1/grade", { useSuggestion: true, studentNote: "Look at the group.", privateNote: "" });
    expect(saved.grade?.source).toBe("AI_ACCEPTED");
    await service.grade("p1", { score: 100, studentNote: "", privateNote: "", reason: "revised" });
    expect(client.put).toHaveBeenLastCalledWith("/teacher/answers/p1/grade", { score: 100, studentNote: "", privateNote: "", reason: "revised" });
  });
});
