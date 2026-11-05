import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentService, type Review } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { ReviewAttempt } from "./ReviewAttempt";

export const review = (over: Partial<Review> = {}): Review => ({
  attemptId: "t-1",
  studentId: "s-1",
  studentName: "Ana",
  academicId: "1000001",
  status: "ENDED_BY_TEACHER",
  startedAt: "2026-10-21T09:10:00-03:00",
  submittedAt: "2026-10-21T10:00:00-03:00",
  preliminaryScore: 2,
  endedByName: "Profa. Sediane",
  endReason: "A docente finalizou a prova.",
  score: 2.5,
  reviewed: false,
  teacherNote: "",
  studentNote: "",
  serverNow: "2026-10-21T11:00:00-03:00",
  items: [
    {
      position: 1, kind: "THEORETICAL_SINGLE", weight: 2, title: "Permissões",
      studentView: { title: "Permissões", statement: "<p>Qual comando?</p>", choices: [{ id: "a", html: "<p>chmod</p>" }, { id: "b", html: "<p>chown</p>" }] },
      answer: { choice: "a" }, answerKey: { correct: "a" }, points: 2, commands: [],
    },
    {
      position: 2, kind: "PRACTICAL", weight: 1, title: "Criar pastas", studentView: { title: "Criar pastas", statement: "<p>Crie /labs/x</p>" }, checkedSolved: false,
      points: 0, adjustedPoints: 0.5, adjustReason: "Caminho certo, faltou uma pasta",
      commands: [
        { position: 2, command: "mkdir /labs", output: "", executedAt: "2026-10-21T09:20:00-03:00" },
        { position: 2, command: "ls /labs", output: "x", executedAt: "2026-10-21T09:21:00-03:00" },
      ],
    },
    {
      position: 3, kind: "DISCURSIVE", weight: 1, title: "O 755", studentView: { title: "O 755", statement: "<p>Explique</p>" },
      answer: { html: "<p>Dono lê e escreve</p>" }, expectedAnswer: "<p>Dono rwx, grupo r-x</p>", commands: [],
    },
  ],
  helps: [{ id: "h-1", studentId: "s-1", position: 2, question: "Posso usar o man?", status: "ANSWERED", createdAt: "2026-10-21T09:25:00-03:00", answer: "Pode" }],
  ...over,
});

beforeEach(() => {
  vi.spyOn(assessmentService, "attemptChat").mockResolvedValue({
    messages: [{ id: "m-1", scope: "private", studentId: "s-1", from: "STUDENT", text: "Travei na 2", createdAt: "2026-10-21T09:30:00-03:00", senderName: "Ana" }],
  } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-097 CA-06 (T5): the attempt of the chosen student in the correction: the header with the score, each question with the answer, the key,
// the commands of the practical one, the expected answer of the written one and the points; the requests for help; the conversation.
describe("ReviewAttempt", () => {
  it("shows the header with the situation and the score, with the automatic one when it changed", () => {
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review()} />);
    expect(screen.getByRole("heading", { name: "Ana" })).toBeDefined();
    const head = screen.getByRole("group", { name: "Dados da tentativa" });
    expect(head.textContent).toContain("1000001");
    expect(head.textContent).toContain("Encerrada pela docente");
    expect(head.textContent).toContain("A docente finalizou a prova.");
    expect(head.textContent).toContain("2,50 de 10,00");
    expect(head.textContent).toContain("automática: 2,00");
  });

  it("shows each question with the answer, the commands of the practical one and the expected answer of the written one", () => {
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review()} />);
    const single = screen.getByRole("article", { name: "Questão 1: Permissões" });
    expect(single.textContent).toContain("Marcou: chmod");
    expect(single.textContent).toContain("Certa");
    expect(single.textContent).toContain("2,00 de 2,00");
    const practical = screen.getByRole("article", { name: "Questão 2: Criar pastas" });
    const commands = within(practical).getByRole("list", { name: "Comandos da questão" });
    expect(within(commands).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("mkdir /labs"),
      expect.stringContaining("ls /labs"),
    ]);
    expect(practical.textContent).toContain("Ajustada de 0,00 para 0,50: Caminho certo, faltou uma pasta");
    const written = screen.getByRole("article", { name: "Questão 3: O 755" });
    expect(written.textContent).toContain("Dono lê e escreve");
    expect(written.textContent).toContain("Resposta esperada");
    expect(written.textContent).toContain("Dono rwx, grupo r-x");
    expect(written.textContent).toContain("Para corrigir");
  });

  it("shows the requests for help and the conversation", async () => {
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review()} />);
    const helps = screen.getByRole("region", { name: "Pedidos de ajuda" });
    expect(helps.textContent).toContain("Posso usar o man?");
    expect(helps.textContent).toContain("Pode");
    expect(helps.textContent).toContain("Questão 2");
    expect(await screen.findByText("Travei na 2")).toBeDefined();
    expect(assessmentService.attemptChat).toHaveBeenCalledWith("c-1", "a-1", "t-1");
  });

  it("says when there is no request for help", () => {
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review({ helps: [] })} />);
    expect(screen.getByText("Nenhum pedido de ajuda.")).toBeDefined();
  });
});

// SPEC-097 CA-06 (T6): while the review is open, the teacher adjusts the points of a question with the reason, undoes an adjustment, and keeps the
// notes when she leaves the field; a review done has no editing.
describe("ReviewAttempt, adjusting and the notes", () => {
  it("adjusts the points of a question with the reason and gives back the new attempt", async () => {
    const changed = review({ score: 2 });
    const adjust = vi.spyOn(assessmentService, "adjustPoints").mockResolvedValue(changed);
    const onChange = vi.fn();
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review()} onChange={onChange} />);
    const single = screen.getByRole("article", { name: "Questão 1: Permissões" });
    fireEvent.change(within(single).getByLabelText("Pontos nesta questão"), { target: { value: "1,5" } });
    fireEvent.change(within(single).getByLabelText("Motivo do ajuste"), { target: { value: "Ambígua" } });
    fireEvent.click(within(single).getByRole("button", { name: "Salvar pontos" }));
    await waitFor(() => expect(adjust).toHaveBeenCalledWith("c-1", "a-1", "t-1", 1, 1.5, "Ambígua"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(changed));
  });

  it("undoes an adjustment, and says why the points were refused", async () => {
    const adjust = vi.spyOn(assessmentService, "adjustPoints").mockResolvedValue(review());
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review()} onChange={vi.fn()} />);
    const practical = screen.getByRole("article", { name: "Questão 2: Criar pastas" });
    fireEvent.click(within(practical).getByRole("button", { name: "Desfazer o ajuste" }));
    await waitFor(() => expect(adjust).toHaveBeenCalledWith("c-1", "a-1", "t-1", 2, null, ""));

    adjust.mockRejectedValue(problem("invalid-points", 400));
    const single = screen.getByRole("article", { name: "Questão 1: Permissões" });
    fireEvent.change(within(single).getByLabelText("Pontos nesta questão"), { target: { value: "5" } });
    fireEvent.click(within(single).getByRole("button", { name: "Salvar pontos" }));
    expect(await within(single).findByRole("alert")).toBeDefined();
    expect(within(single).getByRole("alert").textContent).toContain("de 0 a 2,00");
  });

  it("keeps the notes when the teacher leaves the field", async () => {
    const save = vi.spyOn(assessmentService, "saveReviewNotes").mockResolvedValue(undefined);
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review({ studentNote: "Muito bem" })} onChange={vi.fn()} />);
    const note = screen.getByLabelText("Anotação privada (só você vê)");
    fireEvent.change(note, { target: { value: "Colou na 3?" } });
    fireEvent.blur(note);
    await waitFor(() => expect(save).toHaveBeenCalledWith("c-1", "a-1", "t-1", "Colou na 3?", "Muito bem"));
    expect(await screen.findByText("Anotações salvas")).toBeDefined();
  });

  it("has no editing once the review is done", () => {
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review({ reviewed: true, finalScore: 2.5 })} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Salvar pontos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desfazer o ajuste" })).toBeNull();
  });
});

// SPEC-097 CA-05, CA-07 (T7): the review is concluded only with every written question graded, and reopened once done.
describe("ReviewAttempt, concluding and reopening", () => {
  const graded = () => {
    const r = review();
    r.items[2] = { ...r.items[2]!, adjustedPoints: 1 };
    return r;
  };

  it("does not conclude while a written question has no points, and says why", () => {
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review()} onChange={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Concluir a revisão" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Dê os pontos das descritivas antes de concluir.")).toBeDefined();
  });

  it("concludes the review and tells the screen", async () => {
    const done = { ...graded(), reviewed: true, finalScore: 3.5 };
    const finish = vi.spyOn(assessmentService, "finishReview").mockResolvedValue(done);
    const onFinished = vi.fn();
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={graded()} onChange={vi.fn()} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole("button", { name: "Concluir a revisão" }));
    await waitFor(() => expect(finish).toHaveBeenCalledWith("c-1", "a-1", "t-1"));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith(done));
  });

  it("reopens a review that is done", async () => {
    const reopen = vi.spyOn(assessmentService, "reopenReview").mockResolvedValue(graded());
    const onChange = vi.fn();
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={{ ...graded(), reviewed: true, finalScore: 3.5 }} onChange={onChange} />);
    expect(screen.getByText("Revisão concluída: nota final 3,50 de 10,00.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reabrir a revisão" }));
    await waitFor(() => expect(reopen).toHaveBeenCalledWith("c-1", "a-1", "t-1"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});

// SPEC-098 CA-04 (T3): once the grades are published, the correction is only read.
describe("ReviewAttempt, after the publication", () => {
  it("has no editing, no concluding and no reopening", () => {
    render(<ReviewAttempt classId="c-1" assessmentId="a-1" maxScore={10} review={review({ reviewed: true, finalScore: 2.5 })} onChange={vi.fn()} locked />);
    expect(screen.queryByRole("button", { name: "Reabrir a revisão" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar pontos" })).toBeNull();
    expect((screen.getByLabelText("Anotação privada (só você vê)") as HTMLTextAreaElement).readOnly).toBe(true);
  });
});
