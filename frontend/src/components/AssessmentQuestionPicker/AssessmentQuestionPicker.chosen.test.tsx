import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { questions } from "@/test/assessmentFixtures";
import type { PickedQuestion } from "@/services/assessmentService";
import { AssessmentQuestionPicker, type AssessmentQuestionPickerProps } from "./AssessmentQuestionPicker";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

const picked = (id: string, title: string, weight: number): PickedQuestion => ({ questionId: id, title, kind: "PRACTICAL", difficulty: "EASY", weight });

async function setup(selected: PickedQuestion[], over: Partial<AssessmentQuestionPickerProps> = {}) {
  const load = vi.fn().mockResolvedValue(questions());
  const onChange = vi.fn();
  const props: AssessmentQuestionPickerProps = { moduleId: "mod-1", load, selected, onChange, maxScore: 10, ...over };
  const view = render(<AssessmentQuestionPicker {...props} />);
  await flush();
  return { ...view, load, onChange, props };
}

const table = () => screen.getByRole("table", { name: /^Questões da avaliação/ });
/** The rows of the body of the table of the chosen questions. */
const rows = () => within(table()).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const problem = "Informe o peso: de 0,01 a 100, com até 2 casas.";

// SPEC-079 (section 3.1): the chosen questions as a table with visible column headers, the order, a notice on the row and a clear "Remover".
describe("AssessmentQuestionPicker chosen questions", () => {
  // CA-01
  it("shows a table tied to its title, with the column headers always visible and the weight named for each question", async () => {
    await setup([picked("q-1", "Criar a pasta", 5), picked("q-3", "Mudar a permissão", 5)]);

    expect(screen.getByRole("heading", { name: "Questões da avaliação (2)" })).toBeDefined();
    expect(screen.getByRole("table", { name: "Questões da avaliação (2)" })).toBeDefined();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["#", "Questão", "Nível", "Peso (pontos)", "% da nota", "Ações"]);
    expect(screen.getByRole("columnheader", { name: "Posição na prova" })).toBeDefined();

    const weight = within(cells(rows()[0]!)[3]!).getByLabelText("Peso de Criar a pasta") as HTMLInputElement;
    expect(weight.value).toBe("5");
  });

  // CA-02
  it("numbers the questions in the order of the exam, and the numbers start over without holes when one leaves", async () => {
    const three = [picked("q-1", "Criar a pasta", 3), picked("q-2", "Apagar a pasta", 3), picked("q-3", "Mudar a permissão", 4)];
    const { onChange, rerender, load } = await setup(three);
    expect(rows().map((r) => cells(r)[0]!.textContent)).toEqual(["1", "2", "3"]);
    expect(rows().map((r) => cells(r)[1]!.textContent)).toEqual(["Criar a pasta", "Apagar a pasta", "Mudar a permissão"]);

    fireEvent.click(screen.getByRole("button", { name: "Remover Apagar a pasta" }));
    const left = [three[0]!, three[2]!];
    expect(onChange).toHaveBeenLastCalledWith(left);

    rerender(<AssessmentQuestionPicker moduleId="mod-1" load={load} selected={left} onChange={onChange} maxScore={10} />);
    expect(rows().map((r) => cells(r)[0]!.textContent)).toEqual(["1", "2"]);
    expect(rows().map((r) => cells(r)[1]!.textContent)).toEqual(["Criar a pasta", "Mudar a permissão"]);
  });

  // CA-03
  it("marks the row of a weight that is zero, above 100 or with more than 2 decimals, with the reason tied to the box", async () => {
    const mixed = [picked("q-1", "Criar a pasta", 5), picked("q-2", "Apagar a pasta", 0), picked("q-3", "Mudar a permissão", 100.01), picked("q-4", "Dono e grupo", 3.456)];
    await setup(mixed);

    const [valid, zero, above, decimals] = rows() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const box = (row: HTMLElement) => within(row).getByRole("spinbutton");

    expect(box(valid).getAttribute("aria-invalid")).not.toBe("true");
    expect(within(valid).queryByText(problem)).toBeNull();
    for (const row of [zero, above, decimals]) {
      expect(box(row).getAttribute("aria-invalid")).toBe("true");
      const reason = within(row).getByText(problem);
      expect(box(row).getAttribute("aria-describedby")).toBe(reason.id);
    }
  });

  it("takes the mark away when the weight becomes valid", async () => {
    const { rerender, load, onChange } = await setup([picked("q-1", "Criar a pasta", 0)]);
    expect(screen.getByText(problem)).toBeDefined();

    rerender(<AssessmentQuestionPicker moduleId="mod-1" load={load} selected={[picked("q-1", "Criar a pasta", 2.5)]} onChange={onChange} maxScore={10} />);
    expect(screen.queryByText(problem)).toBeNull();
    expect(screen.getByLabelText("Peso de Criar a pasta").getAttribute("aria-invalid")).not.toBe("true");
  });

  // CA-04
  it("shows the share of the maximum score, and a dash when the weight or the maximum score does not hold", async () => {
    const { rerender, load, onChange } = await setup([picked("q-1", "Criar a pasta", 2.5), picked("q-2", "Apagar a pasta", 7.5), picked("q-3", "Mudar a permissão", 0)]);
    expect(rows().map((r) => cells(r)[4]!.textContent)).toEqual(["25 %", "75 %", "—"]);

    rerender(<AssessmentQuestionPicker moduleId="mod-1" load={load} selected={[picked("q-1", "Criar a pasta", 2.5)]} onChange={onChange} maxScore={0} />);
    expect(rows().map((r) => cells(r)[4]!.textContent)).toEqual(["—"]);
  });

  // CA-05
  it("has a Remover button with its name written, that takes the question out", async () => {
    const { onChange } = await setup([picked("q-1", "Criar a pasta", 5), picked("q-3", "Mudar a permissão", 5)]);
    const remove = screen.getByRole("button", { name: "Remover Criar a pasta" });
    expect(remove.textContent).toBe("Remover");

    fireEvent.click(remove);
    expect(onChange).toHaveBeenLastCalledWith([picked("q-3", "Mudar a permissão", 5)]);
  });

  // CA-06
  it("keeps the table in view, with the boxes and the buttons off, when the assessment has started", async () => {
    await setup([picked("q-1", "Criar a pasta", 5)], { disabled: true });
    expect(table()).toBeDefined();
    expect((screen.getByLabelText("Peso de Criar a pasta") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remover Criar a pasta" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows no table while no question is chosen", async () => {
    await setup([]);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
