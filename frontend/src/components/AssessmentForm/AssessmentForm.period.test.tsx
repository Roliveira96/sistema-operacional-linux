import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm, type AssessmentFormInitial, type AssessmentFormProps } from "./AssessmentForm";

afterEach(cleanup);

const saved: AssessmentFormInitial = {
  title: "Prova 1",
  type: "EXAM",
  maxScore: 10,
  durationMinutes: 60,
  moduleId: "mod-1",
  startsAt: "2026-10-23T09:00:00-03:00",
  endsAt: "2026-10-23T11:00:00-03:00",
  composition: "MANUAL",
  items: [{ questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 10 }],
  audience: "ALL_CLASS",
};

function setup(over: Partial<AssessmentFormProps> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <AssessmentForm
      mode="create"
      modules={[{ id: "mod-1", title: "Permissões de arquivos" }]}
      students={[]}
      loadQuestions={vi.fn().mockResolvedValue(questions())}
      onSubmit={onSubmit}
      {...over}
    />,
  );
  return { onSubmit };
}

const open = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const panelOf = (name: string) => document.getElementById(screen.getByRole("tab", { name }).getAttribute("aria-controls")!)!;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const range = "A duração vai de 5 minutos até o tamanho do período (120 minutos).";
const help = "Sem duração, o aluno usa o período inteiro.";

// SPEC-077 CA-08, CA-09 and CA-10: the individual duration lives in the Period tab, next to the dates it depends on.
describe("AssessmentForm duration", () => {
  it("has the duration in the Period tab, below the start and the end, and not in the Data tab", () => {
    setup();
    expect(within(panelOf("Dados")).queryByLabelText(/^Duração individual/)).toBeNull();
    const duration = within(panelOf("Período")).getByLabelText(/^Duração individual/);
    const ends = within(panelOf("Período")).getByLabelText(/^Término/);
    expect(ends.compareDocumentPosition(duration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panelOf("Período")).getByText(help)).toBeDefined();
  });

  it("shows the range with the length of the period next to the field, in the same tab", () => {
    setup();
    open("Período");
    type(screen.getByLabelText(/^Início/), "2026-10-23T09:00");
    type(screen.getByLabelText(/^Término/), "2026-10-23T11:00");
    const duration = screen.getByLabelText(/^Duração individual/);

    type(duration, "4");
    expect(within(panelOf("Período")).getByText(range)).toBeDefined();
    expect(within(panelOf("Dados")).queryByText(range)).toBeNull();
    type(duration, "121");
    expect(within(panelOf("Período")).getByText(range)).toBeDefined();
    type(duration, "60");
    expect(within(panelOf("Período")).queryByText(range)).toBeNull();
    expect(within(panelOf("Período")).getByText(help)).toBeDefined();
  });

  it("locks the save with the reason of the duration, whichever tab is open", () => {
    setup({ initial: saved });
    const save = screen.getByRole("button", { name: "Agendar avaliação" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    open("Período");
    type(screen.getByLabelText(/^Duração individual/), "4");
    open("Dados");
    expect(save.disabled).toBe(true);
    expect(document.getElementById(save.getAttribute("aria-describedby")!)!.textContent).toContain("duração válida");
  });

  it("when editing, shows the period as text, the hint to reschedule and the duration editable", () => {
    setup({ mode: "edit", initial: saved });
    const period = panelOf("Período");
    expect(within(period).getByText("23/10/2026, 09:00–11:00")).toBeDefined();
    expect(within(period).getByText("Para mudar as datas, use Reagendar.")).toBeDefined();
    const duration = within(period).getByLabelText(/^Duração individual/) as HTMLInputElement;
    expect(duration.value).toBe("60");
    expect(duration.disabled).toBe(false);
    expect(within(panelOf("Dados")).queryByLabelText(/^Duração individual/)).toBeNull();
  });

  it("when the assessment has started, locks the duration and says why in the Period tab", () => {
    setup({ mode: "edit", initial: saved, frozen: true });
    const period = panelOf("Período");
    expect((within(period).getByLabelText(/^Duração individual/) as HTMLInputElement).disabled).toBe(true);
    expect(within(period).getByText("A avaliação já começou; a composição não pode mais mudar.")).toBeDefined();
  });
});
