import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm, type AssessmentFormInitial } from "./AssessmentForm";

afterEach(cleanup);

const saved: AssessmentFormInitial = {
  title: "Prova 1",
  type: "EXAM",
  maxScore: 10,
  moduleId: "mod-1",
  startsAt: "2026-10-23T09:00:00-03:00",
  endsAt: "2026-10-23T11:00:00-03:00",
  composition: "MANUAL",
  items: [
    { questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 5 },
    { questionId: "q-2", title: "Apagar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 5 },
  ],
  audience: "ALL_CLASS",
};

// SPEC-079 CA-04: the form gives the maximum score to the chosen questions, which show the share of it that each one has.
describe("AssessmentForm chosen questions", () => {
  it("shows the share of the maximum score in each chosen question, and follows the maximum score", () => {
    render(
      <AssessmentForm
        mode="edit"
        modules={[{ id: "mod-1", title: "Permissões de arquivos" }]}
        students={[]}
        loadQuestions={vi.fn().mockResolvedValue(questions())}
        onSubmit={vi.fn()}
        initial={saved}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Questões" }));
    const shares = () => within(screen.getByRole("table", { name: /^Questões da avaliação/ })).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[4]!.textContent);

    expect(shares()).toEqual(["50 %", "50 %"]);
    fireEvent.click(screen.getByRole("tab", { name: "Dados" }));
    fireEvent.change(screen.getByLabelText(/^Nota máxima/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("tab", { name: "Questões" }));
    expect(shares()).toEqual(["25 %", "25 %"]);
  });
});
