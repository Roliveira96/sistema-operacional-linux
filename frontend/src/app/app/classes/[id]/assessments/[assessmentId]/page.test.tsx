import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { assessmentService } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { SERVER_NOW, STARTED, detail, myAccess, preview, publicOf, summary } from "@/test/assessmentFixtures";
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

    // SPEC-086 CA-03 (RN-01): "Criada por" is never blank; a removed user is told as such.
    it("says the user was removed when the name of who created the assessment is empty", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ createdByName: "" }));
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(fact("Criada por")).toBe("Usuário removido");
    });

    // SPEC-077 CA-11: the instructions of the teacher view are formatted text too, and a dash when empty.
    it("shows the instructions with their formatting, and a dash when there are none", async () => {
      asRole("TEACHER");
      vi.spyOn(assessmentService, "get").mockResolvedValue(
        detail({ description: '<p>Use <code>ls -l</code> e veja <a href="https://utfpr.edu.br">o site</a>.</p><ol><li>Um</li><li>Dois</li></ol>' }),
      );
      const { container, unmount } = render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      const section = screen.getByRole("heading", { name: "Instruções gerais" }).closest("section")!;
      expect(section.querySelector("code")?.textContent).toBe("ls -l");
      expect(within(section).getByRole("link", { name: "o site" }).getAttribute("href")).toBe("https://utfpr.edu.br");
      expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Um", "Dois"]);
      expect(container.textContent).not.toContain("<code>");
      unmount();

      vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ description: "" }));
      render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { name: "Prova 1: permissões" });
      expect(screen.getByRole("heading", { name: "Instruções gerais" }).closest("section")!.textContent).toContain("—");
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
      expect(screen.getByRole("link", { name: "Voltar para as avaliações" }).getAttribute("href")).toBe("/app/classes/c-1?tab=assessments");
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
      expect(screen.getByRole("link", { name: "Voltar para as avaliações" }).getAttribute("href")).toBe("/app/classes/c-1?tab=assessments");
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

// SPEC-081 CA-01, D-01: the teacher and the administrator get the way to the simulator in the page of the assessment, next to the preview.
describe("assessment page, simulator", () => {
  it("offers Simulate exam to the teacher, as a link to the simulator, also when the assessment is canceled", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
    const { unmount } = render(<AssessmentPage params={params} />);
    await screen.findByRole("heading", { name: "Prova 1: permissões" });
    expect(screen.getByRole("link", { name: "Simular prova (abre em nova aba)" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1/simulate");
    expect(screen.getByRole("link", { name: "Simular prova (abre em nova aba)" }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Simular prova (abre em nova aba)" }).getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeDefined();
    unmount();

    vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ status: "CANCELED", cancelReason: "Feriado" }));
    render(<AssessmentPage params={params} />);
    await screen.findByText("Feriado", { exact: false });
    expect(screen.getByRole("link", { name: "Simular prova (abre em nova aba)" })).toBeDefined();
  });

  it("does not offer it to the student", async () => {
    asRole("STUDENT");
    vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf());
    vi.spyOn(assessmentService, "myAccess").mockResolvedValue(myAccess());
    render(<AssessmentPage params={params} />);
    await screen.findByRole("heading", { name: "Prova 1: permissões" });
    expect(screen.queryByRole("link", { name: "Simular prova (abre em nova aba)" })).toBeNull();
  });
});

// SPEC-083 CA-09 to CA-11: the teacher starts an in-person exam from the page of the assessment.
describe("assessment page, start of the exam", () => {
  const running = { phase: "RUNNING", startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T11:00:00-03:00" } as const;
  const startButton = () => screen.queryByRole("button", { name: "Iniciar a prova" });

  it("starts the exam after the confirmation and then says who started it and when", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail(running));
    const start = vi.spyOn(assessmentService, "start").mockResolvedValue({ ...summary({ ...STARTED }), serverNow: SERVER_NOW });
    render(<AssessmentPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar a prova" }));
    const dialog = screen.getByRole("dialog", { name: "Iniciar a prova agora?" });
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Iniciar a prova" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("c-1", "a-1"));
    expect(await screen.findByText("Prova iniciada às 09:07 por Profa. Sediane.")).toBeDefined();
    expect(startButton()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: "Habilitações" })).toBeDefined();
  });

  it("says why when the server refuses, and keeps the dialog", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail(running));
    vi.spyOn(assessmentService, "start").mockRejectedValue(problem("assessment-already-started", 409));
    render(<AssessmentPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar a prova" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Iniciar a prova" }));
    expect((await screen.findByRole("alert")).textContent).toBe("A prova já foi iniciada.");
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("shows an exam that was already started with who and when, and no button", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ ...STARTED }));
    render(<AssessmentPage params={params} />);
    expect(await screen.findByText("Prova iniciada às 09:07 por Profa. Sediane.")).toBeDefined();
    expect(startButton()).toBeNull();
  });

  // SPEC-086 CA-03 (RN-01): the server gives no name for a removed user, and the page says so instead of leaving a gap.
  it("says the user was removed when the name of who started the exam is empty", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ ...STARTED, startedByName: "" }));
    render(<AssessmentPage params={params} />);
    expect(await screen.findByText("Prova iniciada às 09:07 por Usuário removido.")).toBeDefined();
  });

  it("has the button off before the start time, with the time as the reason tied to it", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
    render(<AssessmentPage params={params} />);
    const button = (await screen.findByRole("button", { name: "Iniciar a prova" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reason = document.getElementById(button.getAttribute("aria-describedby")!);
    expect(reason?.textContent).toBe("A prova pode ser iniciada a partir de 23/10/2026, 09:00.");
  });

  it("says that the exam ended without being started", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ phase: "ENDED", startsAt: "2026-10-20T09:00:00-03:00", endsAt: "2026-10-20T11:00:00-03:00" }));
    render(<AssessmentPage params={params} />);
    expect(await screen.findByText("A prova terminou sem ser iniciada.")).toBeDefined();
    expect(startButton()).toBeNull();
  });

  it("does not offer the start in an online assessment, an assignment or a canceled exam", async () => {
    asRole("TEACHER");
    for (const over of [
      { ...running, modality: "ONLINE", requiresClearance: false },
      { ...running, type: "ASSIGNMENT", modality: "ONLINE", requiresClearance: false },
      { ...running, status: "CANCELED", cancelReason: "Greve" },
    ] as const) {
      vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ ...over }));
      const { unmount } = render(<AssessmentPage params={params} />);
      await screen.findByRole("heading", { level: 1 });
      expect(startButton()).toBeNull();
      expect(screen.queryByText(/Prova iniciada|sem ser iniciada|pode ser iniciada/)).toBeNull();
      unmount();
    }
  });
});
