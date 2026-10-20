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
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function setup(over: Partial<AssessmentQuestionPickerProps> = {}) {
  const load = vi.fn().mockResolvedValue(questions());
  const onChange = vi.fn();
  const props: AssessmentQuestionPickerProps = { moduleId: "mod-1", load, selected: [], onChange, ...over };
  const view = render(<AssessmentQuestionPicker {...props} />);
  await flush();
  return { ...view, load, onChange };
}

const picked = (id: string, title: string, weight: number): PickedQuestion => ({ questionId: id, title, kind: "PRACTICAL", difficulty: "EASY", weight });

// SPEC-075 CA-24: the manual composition lists the eligible questions, with a filter by level and kind and a search.
describe("AssessmentQuestionPicker", () => {
  it("asks for the questions of the module and lists them with their kind and level", async () => {
    const { load } = await setup();
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ moduleId: "mod-1", page: 1 }));
    const row = screen.getByText("Dono e grupo").closest("li")!;
    expect(within(row).getByText("Escolha única")).toBeDefined();
    expect(within(row).getByText("Difícil")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("includes a question with the checkbox, with weight zero, and leaves it out again", async () => {
    const { onChange, rerender, load } = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Criar a pasta" }));
    expect(onChange).toHaveBeenLastCalledWith([{ questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 0 }]);

    const selected = [picked("q-1", "Criar a pasta", 2.5)];
    rerender(<AssessmentQuestionPicker moduleId="mod-1" load={load} selected={selected} onChange={onChange} />);
    expect((screen.getByRole("checkbox", { name: "Incluir Criar a pasta" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Criar a pasta" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("shows the weight of each question that is in, and changes it", async () => {
    const selected = [picked("q-1", "Criar a pasta", 2.5), picked("q-3", "Mudar a permissão", 7.5)];
    const { onChange } = await setup({ selected });
    expect(screen.queryByLabelText("Peso de Apagar a pasta")).toBeNull();
    const weight = screen.getByLabelText("Peso de Criar a pasta") as HTMLInputElement;
    expect(weight.value).toBe("2.5");
    fireEvent.change(weight, { target: { value: "3.34" } });
    expect(onChange).toHaveBeenLastCalledWith([picked("q-1", "Criar a pasta", 3.34), picked("q-3", "Mudar a permissão", 7.5)]);
  });

  it("filters by level and by kind, from the first page", async () => {
    const { load } = await setup();
    fireEvent.change(screen.getByLabelText("Nível"), { target: { value: "HARD" } });
    await flush();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ moduleId: "mod-1", difficulty: "HARD", page: 1 }));
    fireEvent.change(screen.getByLabelText("Tipo de questão"), { target: { value: "PRACTICAL" } });
    await flush();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ difficulty: "HARD", kind: "PRACTICAL", page: 1 }));
  });

  it("searches by the title after the typing stops", async () => {
    const { load } = await setup();
    const calls = load.mock.calls.length;
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar pelo título" }), { target: { value: "pas" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar pelo título" }), { target: { value: "pasta" } });
    await advance(100);
    expect(load.mock.calls.length).toBe(calls); // still typing
    await advance(300);
    expect(load.mock.calls.length).toBe(calls + 1);
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ q: "pasta", page: 1 }));
  });

  it("keeps the questions that are in when the filter hides them", async () => {
    const selected = [picked("q-1", "Criar a pasta", 5)];
    const load = vi.fn().mockResolvedValue(questions({ items: [], total: 0 }));
    await setup({ selected, load });
    expect(screen.getByText("Nenhuma questão elegível encontrada")).toBeDefined();
    expect(screen.getByLabelText("Peso de Criar a pasta")).toBeDefined();
  });

  it("moves through the pages", async () => {
    const load = vi.fn().mockResolvedValue(questions({ total: 45 }));
    await setup({ load });
    expect(screen.getByText("Página 1 de 3")).toBeDefined();
    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await flush();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByText("Página 2 de 3")).toBeDefined();
  });

  it("says it failed and tries again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(questions());
    await setup({ load });
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar as questões.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await flush();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("is read-only when it is disabled", async () => {
    await setup({ selected: [picked("q-1", "Criar a pasta", 5)], disabled: true });
    expect((screen.getByRole("checkbox", { name: "Incluir Criar a pasta" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Peso de Criar a pasta") as HTMLInputElement).disabled).toBe(true);
  });
});
