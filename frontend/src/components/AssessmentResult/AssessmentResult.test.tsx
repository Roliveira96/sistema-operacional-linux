import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StudentResult } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { ResultSummary, ResultView } from "./AssessmentResult";

afterEach(cleanup);

const result = (over: Partial<StudentResult> = {}): StudentResult => ({
  finalScore: 7.5,
  maxScore: 10,
  studentNote: "Muito bem no terminal.",
  items: [
    {
      position: 1, kind: "THEORETICAL_SINGLE", weight: 2, title: "Permissões",
      studentView: { title: "Permissões", statement: "<p>Qual?</p>", choices: [{ id: "a", html: "<p>chmod</p>" }, { id: "b", html: "<p>chown</p>" }] },
      answer: { choice: "b" }, answerKey: { correct: "a" }, points: 0.5, adjustReason: "Justificou bem",
    },
    { position: 2, kind: "PRACTICAL", weight: 1, title: "Criar pastas", studentView: { title: "Criar pastas", statement: "<p>Crie</p>" }, checkedSolved: true, points: 1 },
    { position: 3, kind: "DISCURSIVE", weight: 1, title: "O 755", studentView: { title: "O 755", statement: "<p>Explique</p>" }, answer: { html: "<p>Dono lê</p>" }, points: 0.5 },
  ],
  ...over,
});

// SPEC-098 CA-05 (T4): in the detail of the assessment, the published grade, the note to the student and the way to the correction; nothing before.
describe("ResultSummary", () => {
  it("shows the grade, the note and the way to the correction once published", async () => {
    render(<ResultSummary href="/app/classes/c-1/assessments/a-1/result" load={() => Promise.resolve(result())} />);
    expect(await screen.findByText("Sua nota: 7,50 de 10,00")).toBeDefined();
    expect(screen.getByText("Muito bem no terminal.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver a correção" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1/result");
  });

  it("shows nothing before the publication or to who did not come", async () => {
    const { container } = render(<ResultSummary href="/x" load={() => Promise.reject(problem("result-not-published", 404))} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});

// SPEC-098 CA-06 (T4): the correction the student reads: each question with the answer, the right one of the objective kinds, the points and the
// reason of an adjustment.
describe("ResultView", () => {
  it("shows each question with the answer, the right one, the points and the reason of the adjustment", () => {
    render(<ResultView result={result()} />);
    expect(screen.getByText("Sua nota: 7,50 de 10,00")).toBeDefined();
    const single = screen.getByRole("article", { name: "Questão 1: Permissões" });
    expect(single.textContent).toContain("Marcou: chown");
    expect(single.textContent).toContain("Correta: chmod");
    expect(single.textContent).toContain("0,50 de 2,00");
    expect(single.textContent).toContain("Motivo do ajuste: Justificou bem");
    const practical = screen.getByRole("article", { name: "Questão 2: Criar pastas" });
    expect(within(practical).getByText(/Resolvida/)).toBeDefined();
    expect(screen.getByRole("article", { name: "Questão 3: O 755" }).textContent).toContain("Dono lê");
    expect(screen.queryByText(/terminal está na aba Aluno/)).toBeNull();
  });
});
