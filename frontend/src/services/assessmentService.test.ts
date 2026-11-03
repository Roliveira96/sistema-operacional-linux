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

  // SPEC-090 section 5: the attempt of the student and the list of the teacher.
  it("enters, reads, answers, checks and delivers the attempt, and lists the attempts", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    const base = "/classes/c-1/assessments/a-1";
    vi.mocked(c.post).mockResolvedValue({ id: "t-1" });
    await expect(svc.enterAttempt("c-1", "a-1")).resolves.toEqual({ id: "t-1" });
    expect(c.post).toHaveBeenLastCalledWith(`${base}/attempt`);
    vi.mocked(c.get).mockResolvedValue({ id: "t-1" });
    await svc.myAttempt("c-1", "a-1");
    expect(c.get).toHaveBeenLastCalledWith(`${base}/attempt`);
    await svc.saveAnswer("c-1", "a-1", 3, { choice: "a" });
    expect(c.put).toHaveBeenLastCalledWith(`${base}/attempt/items/3`, { answer: { choice: "a" } });
    vi.mocked(c.post).mockResolvedValue({ solved: true });
    await expect(svc.checkAnswer("c-1", "a-1", 4, { cwd: "/" })).resolves.toBe(true);
    expect(c.post).toHaveBeenLastCalledWith(`${base}/attempt/items/4/check`, { snapshot: { cwd: "/" } });
    vi.mocked(c.post).mockResolvedValue({ id: "t-1", status: "SUBMITTED" });
    await svc.submitAttempt("c-1", "a-1");
    expect(c.post).toHaveBeenLastCalledWith(`${base}/attempt/submit`);
    vi.mocked(c.get).mockResolvedValue({ items: [], serverNow: "x" });
    await expect(svc.attempts("c-1", "a-1")).resolves.toEqual({ items: [], serverNow: "x" });
    expect(c.get).toHaveBeenLastCalledWith(`${base}/attempts`);
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

// SPEC-076 section 5 with SPEC-091 RN-03: the own access of the student, and no route of the clearance any more.
describe("assessmentService: the own access (SPEC-091)", () => {
  it("reads the own access of the student, and has nothing of the clearance", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    vi.mocked(c.get).mockResolvedValue({ allowed: false, reason: "NOT_STARTED", modality: "IN_PERSON", serverNow: "x" });
    await expect(svc.myAccess("c-1", "a-1")).resolves.toMatchObject({ reason: "NOT_STARTED" });
    expect(c.get).toHaveBeenCalledWith("/classes/c-1/assessments/a-1/my-access");
    expect("clearances" in svc).toBe(false);
    expect("decideClearances" in svc).toBe(false);
  });
});

// SPEC-083 section 5: the start of an in-person exam has its own route, with no body, and the new reasons are explained.
describe("assessmentService: start of the exam (SPEC-083)", () => {
  it("starts the exam on its own route", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    await svc.start("c-1", "a-1");
    expect(c.post).toHaveBeenCalledWith("/classes/c-1/assessments/a-1/start");
  });

  it("explains the errors of the start and of the clearance before it", () => {
    expect(describeAssessmentError(problem("assessment-already-started", 409))).toBe("A prova já foi iniciada.");
    expect(describeAssessmentError(problem("assessment-not-open-yet", 409))).toBe("Ainda não chegou o horário de início da prova.");
    expect(describeAssessmentError(problem("assessment-not-started", 409))).toBe("A prova ainda não foi iniciada. A habilitação começa quando você a inicia.");
  });
});

// SPEC-084 CA-14 (section 5): the machine a question of the assessment starts from has its own route, and a question without one gives none.
describe("assessmentService: scenario of a question (SPEC-084)", () => {
  it("reads the scenario of a question of the assessment and gives its machine", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    vi.mocked(c.get).mockResolvedValueOnce({ questionId: "q-1", snapshot: { files: { "/a": "x" } } });
    await expect(svc.questionScenario("c-1", "a-1", "q-1")).resolves.toEqual({ files: { "/a": "x" } });
    expect(c.get).toHaveBeenCalledWith("/classes/c-1/assessments/a-1/questions/q-1/scenario");
  });

  it("gives null when the question has no scenario of its own, so the default machine applies", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    vi.mocked(c.get).mockResolvedValueOnce({ questionId: "q-1" });
    await expect(svc.questionScenario("c-1", "a-1", "q-1")).resolves.toBeNull();
  });
});

// SPEC-085 section 5: the check of the machine of a question has its own route, takes the state and gives only whether it passed.
describe("assessmentService: check of a question (SPEC-085)", () => {
  it("sends the state of the machine and gives whether the question was met", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    vi.mocked(c.post).mockResolvedValueOnce({ passed: true });
    await expect(svc.checkQuestion("c-1", "a-1", "q-1", { formato: "exame-so/maquina" })).resolves.toBe(true);
    expect(c.post).toHaveBeenCalledWith("/classes/c-1/assessments/a-1/questions/q-1/check", { snapshot: { formato: "exame-so/maquina" } });
    vi.mocked(c.post).mockResolvedValueOnce({ passed: false });
    await expect(svc.checkQuestion("c-1", "a-1", "q-1", {})).resolves.toBe(false);
  });
});

// SPEC-091 section 5: the room of the exam, on its own socket, and the end of the exam of a student.
describe("assessmentService: the room (SPEC-091)", () => {
  it("opens the socket of the room on the same origin and hands over its messages", () => {
    const created: string[] = [];
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket & Record<string, unknown>;
    const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
    const room = assessmentService.openRoom("c-1", "a-1", handlers, (url) => {
      created.push(url);
      return socket;
    });
    expect(created).toEqual([`ws://${window.location.host}/api/v1/classes/c-1/assessments/a-1/room/ws`]);
    (socket.onopen as () => void)();
    expect(handlers.onOpen).toHaveBeenCalled();
    (socket.onmessage as (e: { data: string }) => void)({ data: JSON.stringify({ type: "room:admitted", data: {} }) });
    (socket.onmessage as (e: { data: string }) => void)({ data: "not json" });
    expect(handlers.onMessage).toHaveBeenCalledTimes(1);
    room.send("help:lower", {});
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "help:lower", data: {} }));
  });

  it("ends the exam of a student with the reason", async () => {
    const c = client();
    const svc = createAssessmentService(c);
    await svc.endAttempt("c-1", "a-1", "t-1", "Flagrante de cola");
    expect(c.post).toHaveBeenLastCalledWith("/classes/c-1/assessments/a-1/attempts/t-1/end", { reason: "Flagrante de cola" });
  });
});
