import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preview } from "@/test/assessmentFixtures";
import { AssessmentPreview } from "./AssessmentPreview";

afterEach(cleanup);

// SPEC-075 RN-16, CA-22: the teacher sees the whole assessment, with the answers.
describe("AssessmentPreview", () => {
  it("lists the questions in order, with the kind, level, weight, statement, correct answer and explanation", async () => {
    render(<AssessmentPreview load={vi.fn().mockResolvedValue(preview())} />);
    const first = (await screen.findByText("Criar a pasta")).closest("li")!;
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const row = within(first);
    expect(row.getByText("1")).toBeDefined();
    expect(row.getByText("Comando Linux")).toBeDefined();
    expect(row.getByText("Fácil")).toBeDefined();
    expect(row.getByText("5,00 pontos")).toBeDefined();
    expect(row.getByText("Crie a pasta", { exact: false })).toBeDefined();
    expect(row.getByText("Resposta correta")).toBeDefined();
    expect(row.getByText('{"steps":[{"command":"mkdir /a"}]}')).toBeDefined();
    expect(row.getByText("Justificativa")).toBeDefined();
    expect(row.getByText("Use mkdir.")).toBeDefined();
  });

  it("shows the rules, the stock and a sample of the draw, which is not saved", async () => {
    const draw = preview({
      rules: [
        { difficulty: "EASY", quantity: 2, pointsPerQuestion: 2.5 },
        { difficulty: "HARD", quantity: 1, pointsPerQuestion: 5 },
      ],
      stock: { EASY: 8, MEDIUM: 3, HARD: 1 },
      sample: [{ questionId: "q-9", title: "Questão sorteada", kind: "PRACTICAL", difficulty: "EASY", statement: "<p>Enunciado do sorteio</p>", answerKey: "mkdir /b", explanation: "" }],
      questions: [],
    });
    render(<AssessmentPreview load={vi.fn().mockResolvedValue(draw)} />);
    const rules = await screen.findByRole("table", { name: "Regras do sorteio" });
    const rows = within(rules).getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent));
    expect(rows).toEqual([
      ["Fácil", "2", "2,50", "8"],
      ["Difícil", "1", "5,00", "1"],
    ]);
    expect(screen.getByText("Exemplo sorteado (não é gravado)")).toBeDefined();
    expect(screen.getByText("Questão sorteada")).toBeDefined();
  });

  it("says it is loading", () => {
    render(<AssessmentPreview load={() => new Promise(() => {})} />);
    expect(screen.getByRole("status").textContent).toBe("Carregando a pré-visualização…");
  });

  it("says it failed and tries again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(preview());
    render(<AssessmentPreview load={load} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar a pré-visualização.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.getByText("Criar a pasta")).toBeDefined());
  });
});
