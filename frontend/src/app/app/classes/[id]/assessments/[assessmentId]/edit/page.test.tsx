import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentService } from "@/services/assessmentService";
import { classService, type ClassMember } from "@/services/classService";
import { moduleService } from "@/services/moduleService";
import { SERVER_NOW, detail, summary } from "@/test/assessmentFixtures";
import EditAssessmentPage from "./page";

const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));

// The form has its own tests; here it is a stub that shows what the page gave it and sends what it is told to.
vi.mock("@/components/AssessmentForm/AssessmentForm", () => ({
  AssessmentForm: (p: { mode: string; frozen?: boolean; initial?: unknown; onSubmit: (v: unknown) => Promise<void> }) => (
    <div>
      <output data-testid="mode">{p.mode}</output>
      <output data-testid="frozen">{String(Boolean(p.frozen))}</output>
      <output data-testid="initial">{JSON.stringify(p.initial)}</output>
      <button type="button" onClick={() => void p.onSubmit({ title: "Prova 1 (2ª chamada)", teacherPrivateNotes: "Conferir o lab 02" }).catch(() => undefined)}>
        enviar com notas novas
      </button>
      <button type="button" onClick={() => void p.onSubmit({ title: "Prova 1 (2ª chamada)", teacherPrivateNotes: "" }).catch(() => undefined)}>
        enviar com as mesmas notas
      </button>
    </div>
  ),
}));

const params = Promise.resolve({ id: "c-1", assessmentId: "a-1" });
const member = (userId: string, userName: string): ClassMember => ({
  id: `m-${userId}`, classId: "c-1", userId, userName, userEmail: `${userId}@x.br`, status: "ACTIVE", origin: "DIRECT_BY_TEACHER", requestedAt: "",
});
const read = (id: string) => JSON.parse(screen.getByTestId(id).textContent!);

function mockReads(d = detail()) {
  vi.spyOn(assessmentService, "get").mockResolvedValue(d);
  vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [{ id: "mod-1", title: "Permissões de arquivos" }] as never, total: 1, page: 1, limit: 100 });
  vi.spyOn(classService, "listMembers").mockResolvedValue([member("s-1", "Ana Souza")]);
}

beforeEach(() => pushMock.mockClear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-075 section 3.1: the edit of an assessment, and RN-10 and RN-13 (the notes have a route of their own).
describe("edit assessment page", () => {
  it("opens the form to edit, starting from what is saved", async () => {
    mockReads(detail({ teacherPrivateNotes: "Conferir o lab", students: [{ studentId: "s-1", name: "Ana Souza", academicId: "1000001" }], audience: "SELECTED" }));
    render(<EditAssessmentPage params={params} />);
    await screen.findByTestId("mode");
    expect(screen.getByTestId("mode").textContent).toBe("edit");
    expect(screen.getByTestId("frozen").textContent).toBe("false");
    expect(read("initial")).toEqual({
      title: "Prova 1: permissões",
      description: "Traga o documento com foto.",
      type: "EXAM",
      maxScore: 10,
      durationMinutes: 60,
      moduleId: "mod-1",
      startsAt: "2026-10-23T09:00:00-03:00",
      endsAt: "2026-10-23T11:00:00-03:00",
      composition: "MANUAL",
      modality: "IN_PERSON",
      requiresClearance: true,
      items: [
        { questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 3.34 },
        { questionId: "q-2", title: "Apagar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 3.33 },
        { questionId: "q-3", title: "Mudar a permissão", kind: "PRACTICAL", difficulty: "MEDIUM", weight: 3.33 },
      ],
      drawRules: [],
      audience: "SELECTED",
      studentIds: ["s-1"],
      teacherPrivateNotes: "Conferir o lab",
    });
  });

  it("tells the form the assessment already started, so it locks the composition", async () => {
    mockReads(detail({ frozen: true, phase: "RUNNING" }));
    render(<EditAssessmentPage params={params} />);
    await screen.findByTestId("mode");
    expect(screen.getByTestId("frozen").textContent).toBe("true");
  });

  it("changes the assessment, saves the notes on their own route when they changed, and goes back to the page", async () => {
    mockReads();
    const update = vi.spyOn(assessmentService, "update").mockResolvedValue({ ...summary(), serverNow: SERVER_NOW });
    const saveNotes = vi.spyOn(assessmentService, "saveNotes").mockResolvedValue("Conferir o lab 02");
    render(<EditAssessmentPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: "enviar com notas novas" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("c-1", "a-1", { title: "Prova 1 (2ª chamada)" }));
    expect(saveNotes).toHaveBeenCalledWith("c-1", "a-1", "Conferir o lab 02");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/c-1/assessments/a-1"));
  });

  it("does not touch the route of the notes when they did not change", async () => {
    mockReads();
    const update = vi.spyOn(assessmentService, "update").mockResolvedValue({ ...summary(), serverNow: SERVER_NOW });
    const saveNotes = vi.spyOn(assessmentService, "saveNotes");
    render(<EditAssessmentPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: "enviar com as mesmas notas" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(saveNotes).not.toHaveBeenCalled();
  });

  it("does not save the notes, nor leave, when the server refuses the change", async () => {
    mockReads();
    vi.spyOn(assessmentService, "update").mockRejectedValue(new Error("refused"));
    const saveNotes = vi.spyOn(assessmentService, "saveNotes");
    render(<EditAssessmentPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: "enviar com notas novas" }));
    await waitFor(() => expect(assessmentService.update).toHaveBeenCalled());
    expect(saveNotes).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("only reads a canceled assessment: no form, and the way back", async () => {
    mockReads(detail({ status: "CANCELED", cancelReason: "Falta de energia", frozen: true }));
    render(<EditAssessmentPage params={params} />);
    expect(await screen.findByText("Uma avaliação cancelada só pode ser lida.")).toBeDefined();
    expect(screen.queryByTestId("mode")).toBeNull();
    expect(screen.getByRole("link", { name: "Voltar para a avaliação" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
  });

  it("says when it could not read what it needs, and tries again", async () => {
    mockReads();
    vi.spyOn(assessmentService, "get").mockRejectedValueOnce(new Error("down")).mockResolvedValue(detail());
    render(<EditAssessmentPage params={params} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar os dados da avaliação.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByTestId("mode")).toBeDefined();
  });
});
