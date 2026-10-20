import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { assessmentService } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { detail, myAccess, preview, publicOf } from "@/test/assessmentFixtures";
import AssessmentPage from "./page";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => searchParams }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

function asRole(role: "TEACHER" | "STUDENT") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}

const params = Promise.resolve({ id: "c-1", assessmentId: "a-1" });
const fact = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;

beforeEach(() => {
  searchParams = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-075 section 3.1: the page of an assessment, for the teacher and for the student.
describe("assessment page", () => {
  describe("teacher", () => {
    it("shows the data, the instructions, the notes, the questions and the history", async () => {
      asRole("TEACHER");
      const get = vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ teacherPrivateNotes: "Conferir o lab 02" }));
      render(<AssessmentPage params={params} />);
      expect(await screen.findByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
      expect(get).toHaveBeenCalledWith("c-1", "a-1");
      expect(fact("Tipo")).toBe("Prova");
      expect(fact("Situação")).toBe("Agendada");
      expect(fact("Período")).toBe("23/10/2026, 09:00–11:00");
      expect(fact("Nota máxima")).toBe("10,00");
      expect(fact("Módulo")).toBe("Permissões de arquivos");
      expect(fact("Composição")).toBe("Manual");
      expect(fact("Alunos elegíveis")).toBe("32");
      expect(fact("Criada por")).toBe("Profa. Sediane");
      expect(screen.getByText("Traga o documento com foto.")).toBeDefined();
      expect(screen.getByText("Conferir o lab 02")).toBeDefined();

      const questions = within(screen.getByRole("list", { name: "Questões da avaliação" })).getAllByRole("listitem");
      expect(questions.map((q) => q.textContent)).toEqual([
        expect.stringContaining("Criar a pasta"),
        expect.stringContaining("Apagar a pasta"),
        expect.stringContaining("Mudar a permissão"),
      ]);
      expect(questions[0]!.textContent).toContain("3,34 pontos");
      expect(screen.getByRole("heading", { name: "Histórico" })).toBeDefined();
      expect(screen.getByText("Criada por Profa. Sediane em 20/10/2026 às 16:00.")).toBeDefined();
    });

    it("says there are no notes, and shows the rules of a draw and the chosen students", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockResolvedValue(
        detail({
          composition: "DRAW",
          audience: "SELECTED",
          items: [],
          drawRules: [{ difficulty: "EASY", quantity: 2, pointsPerQuestion: 5 }],
          students: [{ studentId: "s-1", name: "Ana Souza", academicId: "1000001" }],
        }),
      );
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(screen.getByText("Nenhuma observação.")).toBeDefined();
      expect(fact("Composição")).toBe("Sorteio por nível");
      const rules = screen.getByRole("table", { name: "Regras do sorteio" });
      expect(within(rules).getByText("Fácil")).toBeDefined();
      expect(fact("Público")).toBe("Alunos escolhidos");
      expect(screen.getByText("Ana Souza (1000001)")).toBeDefined();
    });

    // SPEC-076 CA-16
    it("says the modality and has the way to the clearances of an in-person exam that requires it", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ clearanceCounts: { pending: 3, approved: 29, rejected: 0 } }));
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(fact("Modalidade")).toBe("Presencial");
      expect(screen.getByRole("link", { name: "Habilitações" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1/clearances");
      expect(screen.getByText("3 aguardando, 29 habilitados, 0 recusados")).toBeDefined();
    });

    it("has no clearances to show for an online assessment, nor for one that does not require them", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ modality: "ONLINE", requiresClearance: false }));
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(fact("Modalidade")).toBe("Online");
      expect(screen.queryByRole("link", { name: "Habilitações" })).toBeNull();
      cleanup();

      vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ requiresClearance: false }));
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(screen.queryByRole("link", { name: "Habilitações" })).toBeNull();
    });

    it("has the way to edit, and to preview, which reads the answers only when asked", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
      const read = vi.spyOn(assessmentService, "preview").mockResolvedValue(preview());
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(screen.getByRole("link", { name: "Editar" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1/edit");
      expect(screen.getByRole("link", { name: "Voltar para as avaliações" }).getAttribute("href")).toBe("/app/classes/c-1/assessments");
      expect(read).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar" }));
      expect(await screen.findAllByText("Resposta correta")).toHaveLength(2);
      expect(read).toHaveBeenCalledWith("c-1", "a-1");
    });

    it("opens the preview at once when it is asked in the address", async () => {
      asRole("TEACHER");
      searchParams = new URLSearchParams("preview=1");
      vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
      vi.spyOn(assessmentService, "preview").mockResolvedValue(preview());
      render(<AssessmentPage params={params} />);
      expect(await screen.findAllByText("Resposta correta")).toHaveLength(2);
    });

    it("shows a canceled one with the reason, and has no way to edit it", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ status: "CANCELED", cancelReason: "Falta de energia", frozen: true }));
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(screen.getByText("Avaliação cancelada")).toBeDefined();
      expect(screen.getByText("Falta de energia")).toBeDefined();
      expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
      expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeDefined();
    });

    it("says the assessment was not found", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockRejectedValue(problem("assessment-not-found", 404));
      render(<AssessmentPage params={params} />);
      expect((await screen.findByRole("alert")).textContent).toBe("Avaliação não encontrada.");
      expect(screen.getByRole("link", { name: "Voltar para as avaliações" })).toBeDefined();
    });
  });

  describe("student", () => {
    beforeEach(() => {
      vi.spyOn(assessmentService, "myAccess").mockResolvedValue(myAccess());
    });

    // SPEC-076 CA-17
    it("shows the own state of the clearance below the card, from the own access", async () => {
      asRole("STUDENT");
      vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf());
      render(<AssessmentPage params={params} />);
      expect(await screen.findByText("Aguardando a habilitação da professora")).toBeDefined();
      expect(assessmentService.myAccess).toHaveBeenCalledWith("c-1", "a-1");
      expect(screen.getByText("Modalidade: Presencial")).toBeDefined();
    });

    it("shows the card with the countdown and nothing that is the teacher's", async () => {
      asRole("STUDENT");
      const get = vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf({ startsAt: "2026-10-21T11:30:00-03:00", endsAt: "2026-10-21T13:30:00-03:00" }));
      render(<AssessmentPage params={params} />);
      expect(await screen.findByRole("timer")).toBeDefined();
      expect(get).toHaveBeenCalledWith("c-1", "a-1");
      expect(screen.getByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
      expect(screen.queryByText("Observações privadas")).toBeNull();
      expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Pré-visualizar" })).toBeNull();
      expect(screen.getByRole("link", { name: "Voltar para as avaliações" }).getAttribute("href")).toBe("/app/classes/c-1/assessments");
    });

    it("asks for the preview of nobody: the student never reads the questions", async () => {
      asRole("STUDENT");
      vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf());
      const read = vi.spyOn(assessmentService, "preview");
      searchParams = new URLSearchParams("preview=1");
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      await waitFor(() => expect(read).not.toHaveBeenCalled());
    });
  });
});
