import { describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { NetworkError, type HttpClient } from "./httpClient";
import { assessmentService, createAssessmentService, describeAssessmentError } from "./assessmentService";

function client(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
}

// SPEC-075, section 5.2.
describe("assessmentService", () => {
  it("lists the assessments of a class, with the phase and the status when given", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    vi.mocked(c.get).mockResolvedValue({ items: [], serverNow: "2026-10-21T10:00:00-03:00" });
    await expect(svc.list("c-1")).resolves.toEqual({ items: [], serverNow: "2026-10-21T10:00:00-03:00" });
    expect(c.get).toHaveBeenLastCalledWith("/classes/c-1/assessments");
    await svc.list("c-1", { phase: "UPCOMING", status: "SCHEDULED" });
    expect(c.get).toHaveBeenLastCalledWith("/classes/c-1/assessments?phase=UPCOMING&status=SCHEDULED");
  });

  it("reads the detail, with the serverNow of the countdown", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    vi.mocked(c.get).mockResolvedValue({ id: "a-1", serverNow: "2026-10-21T10:00:00-03:00" });
    await expect(svc.get("c-1", "a-1")).resolves.toMatchObject({ serverNow: "2026-10-21T10:00:00-03:00" });
    expect(c.get).toHaveBeenCalledWith("/classes/c-1/assessments/a-1");
  });

  it("creates and changes an assessment", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    const input = {
      moduleId: "mod-1",
      title: "Prova 1",
      type: "EXAM" as const,
      maxScore: 10,
      startsAt: "2026-10-23T09:00:00-03:00",
      endsAt: "2026-10-23T11:00:00-03:00",
      composition: "MANUAL" as const,
      items: [{ questionId: "q-1", weight: 10 }],
      audience: "ALL_CLASS" as const,
    };
    await svc.create("c-1", input);
    expect(c.post).toHaveBeenCalledWith("/classes/c-1/assessments", input);
    await svc.update("c-1", "a-1", { title: "Prova 1 (2ª chamada)" });
    expect(c.patch).toHaveBeenCalledWith("/classes/c-1/assessments/a-1", { title: "Prova 1 (2ª chamada)" });
  });

  it("reschedules, cancels and saves the private notes on their own routes", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    const when = { startsAt: "2026-10-23T09:00:00-03:00", endsAt: "2026-10-23T12:00:00-03:00", reason: "Lab indisponível" };
    await svc.reschedule("c-1", "a-1", when);
    expect(c.put).toHaveBeenCalledWith("/classes/c-1/assessments/a-1/schedule", when);
    await svc.cancel("c-1", "a-1", "Falta de energia");
    expect(c.post).toHaveBeenCalledWith("/classes/c-1/assessments/a-1/cancel", { reason: "Falta de energia" });
    vi.mocked(c.put).mockResolvedValueOnce({ teacherPrivateNotes: "Conferir o lab" });
    await expect(svc.saveNotes("c-1", "a-1", "Conferir o lab")).resolves.toBe("Conferir o lab");
    expect(c.put).toHaveBeenLastCalledWith("/classes/c-1/assessments/a-1/private-notes", { teacherPrivateNotes: "Conferir o lab" });
  });

  it("reads the preview and the eligible questions, leaving out the filters that are empty", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    await svc.preview("c-1", "a-1");
    expect(c.get).toHaveBeenLastCalledWith("/classes/c-1/assessments/a-1/preview");
    await svc.eligibleQuestions("c-1", { moduleId: "mod-1" });
    expect(c.get).toHaveBeenLastCalledWith("/classes/c-1/assessment-questions?moduleId=mod-1");
    await svc.eligibleQuestions("c-1", { moduleId: "mod-1", difficulty: "HARD", kind: "PRACTICAL", q: "pasta", page: 2, pageSize: 20 });
    expect(c.get).toHaveBeenLastCalledWith("/classes/c-1/assessment-questions?moduleId=mod-1&difficulty=HARD&kind=PRACTICAL&q=pasta&page=2&pageSize=20");
  });

  it("has a service ready for the app", () => {
    expect(assessmentService.list).toBeTypeOf("function");
  });
});

// The RFC 7807 slugs of section 5.2, in Portuguese for the screen.
describe("describeAssessmentError", () => {
  it("names the level that lacks stock, how many were asked and how many there are", () => {
    const error = problem("insufficient-stock", 409, { shortages: [{ difficulty: "HARD", asked: 5, available: 4 }] });
    expect(describeAssessmentError(error)).toBe("Estoque insuficiente: difícil (pediu 5, há 4).");
  });

  it("explains the frozen, canceled and ended assessments", () => {
    expect(describeAssessmentError(problem("assessment-frozen", 409))).toBe("A avaliação já começou; a composição não pode mais mudar.");
    expect(describeAssessmentError(problem("assessment-canceled", 409))).toBe("A avaliação está cancelada.");
    expect(describeAssessmentError(problem("assessment-ended", 409))).toBe("A avaliação já terminou.");
  });

  it("explains the checks of the composition and of the reason", () => {
    expect(describeAssessmentError(problem("weights-mismatch", 400))).toBe("A soma dos pontos precisa ser igual à nota máxima.");
    expect(describeAssessmentError(problem("draw-mismatch", 400))).toBe("As quantidades por nível precisam somar o total de questões.");
    expect(describeAssessmentError(problem("reason-required", 400))).toBe("Informe o motivo.");
    expect(describeAssessmentError(problem("module-not-assigned", 409))).toBe("Este módulo não está atribuído à turma.");
  });

  it("says when the network failed and gives a plain answer to what it does not know", () => {
    expect(describeAssessmentError(new NetworkError(new Error("down")))).toBe("Sem conexão com o servidor. Tente de novo.");
    expect(describeAssessmentError(problem("something-new", 500))).toBe("Não foi possível concluir. Tente de novo.");
    expect(describeAssessmentError(new Error("x"))).toBe("Não foi possível concluir. Tente de novo.");
  });
});
