import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeacherAttempt } from "@/services/assessmentService";
import { StudentAnswers } from "./StudentAnswers";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const attempt = (over: Partial<TeacherAttempt> = {}): TeacherAttempt => ({
  attemptId: "t-1",
  studentId: "s-ana",
  studentName: "Ana",
  status: "IN_PROGRESS",
  startedAt: "2026-10-21T09:10:00-03:00",
  serverNow: "2026-10-21T09:30:00-03:00",
  items: [
    {
      position: 1,
      kind: "THEORETICAL_SINGLE",
      weight: 2,
      title: "Permissões",
      studentView: {
        title: "Permissões",
        statement: "<p>Qual?</p>",
        choices: [
          { id: "chown", html: "<p><code>chown</code></p>" },
          { id: "chmod", html: "<p><code>chmod</code></p>" },
        ],
      },
      answer: { choice: "chown" },
      answerKey: { correct: "chmod" },
    },
    {
      position: 2,
      kind: "THEORETICAL_BOOLEAN",
      weight: 1,
      title: "Apagar com rm",
      studentView: { title: "Apagar com rm", statement: "" },
      answer: { value: true },
      answerKey: { correct: true },
    },
    {
      position: 3,
      kind: "THEORETICAL_MATCHING",
      weight: 2,
      title: "Comandos",
      studentView: {
        title: "Comandos",
        statement: "",
        columns: {
          left: [
            { id: "cd", text: "cd" },
            { id: "ls", text: "ls" },
          ],
          right: [
            { id: "enter", text: "Entra numa pasta" },
            { id: "list", text: "Lista" },
          ],
        },
      },
      answer: {
        links: [
          { left: "cd", right: "enter" },
          { left: "ls", right: "enter" },
        ],
      },
      answerKey: {
        pairs: [
          { left: "cd", right: "enter" },
          { left: "ls", right: "list" },
        ],
      },
    },
    { position: 4, kind: "DISCURSIVE", weight: 1, title: "O 755", studentView: { title: "O 755", statement: "" }, answer: { html: "<p>Dono lê e escreve</p>" } },
    { position: 5, kind: "PRACTICAL", weight: 1, title: "Criar pastas", studentView: { title: "Criar pastas", statement: "" }, checkedSolved: true },
    { position: 6, kind: "THEORETICAL_SINGLE", weight: 1, title: "Sem marcar", studentView: { title: "Sem marcar", statement: "", choices: [] } },
  ],
  ...over,
});

// SPEC-095 CA-03: what the student answered in each question, beside the key of the objective ones, and the question the student is in.
describe("StudentAnswers", () => {
  it("shows each answer by kind, the key, no answer, and the question the student is in", async () => {
    render(<StudentAnswers load={() => Promise.resolve(attempt())} current={3} />);
    const single = await screen.findByRole("listitem", { name: "Questão 1: Permissões" });
    expect(single.textContent).toContain("Marcou: chown");
    expect(single.textContent).toContain("Correta: chmod");
    const boolean = screen.getByRole("listitem", { name: "Questão 2: Apagar com rm" });
    expect(boolean.textContent).toContain("Marcou: Verdadeiro");
    expect(boolean.textContent).toContain("Correta: Verdadeiro");
    const matching = screen.getByRole("listitem", { name: "Questão 3: Comandos" });
    expect(matching.textContent).toContain("Está nesta");
    expect(matching.textContent).toContain("cd → Entra numa pasta (certo)");
    expect(matching.textContent).toContain("ls → Entra numa pasta (errado)");
    expect(screen.getByRole("listitem", { name: "Questão 4: O 755" }).textContent).toContain("Dono lê e escreve");
    const practical = screen.getByRole("listitem", { name: "Questão 5: Criar pastas" });
    expect(practical.textContent).toContain("Conferida: resolvida");
    expect(practical.textContent).toContain("O terminal está na aba Aluno.");
    expect(screen.getByRole("listitem", { name: "Questão 6: Sem marcar" }).textContent).toContain("Sem resposta");
  });

  // SPEC-095 CA-04: it reads again every 10 seconds while it is shown and when the teacher presses Atualizar, and not while the page is hidden.
  it("reads again every 10 seconds, on Atualizar, and not while the page is hidden", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(attempt());
    render(<StudentAnswers load={load} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(load).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(load).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(load).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
});

// SPEC-095 CA-03, polished in the manual script of 05/11/2026: a summary on top and a tag with the verdict on each question, in words and not only
// in color.
describe("StudentAnswers, the summary and the tags", () => {
  it("sums up the answers and tags each question", async () => {
    render(<StudentAnswers load={() => Promise.resolve(attempt())} />);
    const summary = await screen.findByRole("group", { name: "Resumo das respostas" });
    expect(summary.textContent).toContain("Respondidas: 5 de 6");
    expect(summary.textContent).toContain("Certas: 1");
    expect(summary.textContent).toContain("Com erro: 2");
    expect(summary.textContent).toContain("Práticas resolvidas: 1 de 1");
    const tag = (n: number, title: string) => screen.getByRole("listitem", { name: `Questão ${n}: ${title}` }).querySelector("[data-tag]")?.textContent;
    expect(tag(1, "Permissões")).toBe("Errada");
    expect(tag(2, "Apagar com rm")).toBe("Certa");
    expect(tag(3, "Comandos")).toBe("Parcial: 1 de 2 pares");
    expect(tag(4, "O 755")).toBe("Para corrigir");
    expect(tag(5, "Criar pastas")).toBe("Resolvida");
    expect(tag(6, "Sem marcar")).toBe("Sem resposta");
  });
});
