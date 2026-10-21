import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm, type AssessmentFormInitial, type AssessmentFormProps } from "./AssessmentForm";

afterEach(cleanup);

function setup(over: Partial<AssessmentFormProps> = {}) {
  return render(
    <AssessmentForm
      mode="create"
      modules={[{ id: "mod-1", title: "Permissões de arquivos" }]}
      students={[]}
      loadQuestions={vi.fn().mockResolvedValue(questions())}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      {...over}
    />,
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
const open = (name: string) => fireEvent.click(tab(name));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const invalid = (name: string) => tab(name).getAttribute("data-invalid") === "true";
const note = "Esta aba tem algo a corrigir";
const clearanceHelp = "Com a exigência ligada, só entra na prova o aluno que você habilitar.";

// SPEC-077 CA-12: the modality and the clearance live together, in a section that explains the clearance.
describe("AssessmentForm application section", () => {
  it("groups the modality and the clearance under Aplicação, with the sentence that explains the clearance", () => {
    setup();
    const group = screen.getByRole("group", { name: "Aplicação" });
    expect(within(group).getByLabelText("Modalidade")).toBeDefined();
    const clearance = within(group).getByRole("checkbox", { name: "Exigir habilitação dos alunos" });
    expect(within(group).getByText(clearanceHelp)).toBeDefined();
    expect(document.getElementById(clearance.getAttribute("aria-describedby")!)!.textContent).toBe(clearanceHelp);
  });

  it("behaves as before: no clearance for an online assessment, and everything locked once it started", () => {
    setup({ initial: { title: "Prova", type: "EXAM", modality: "ONLINE", requiresClearance: false } });
    const group = screen.getByRole("group", { name: "Aplicação" });
    expect(within(group).queryByRole("checkbox", { name: "Exigir habilitação dos alunos" })).toBeNull();
    cleanup();

    setup({ mode: "edit", frozen: true, initial: { title: "Prova", type: "EXAM", modality: "IN_PERSON", requiresClearance: true } });
    const frozen = screen.getByRole("group", { name: "Aplicação" });
    expect((within(frozen).getByLabelText("Modalidade") as HTMLSelectElement).disabled).toBe(true);
    expect((within(frozen).getByRole("checkbox", { name: "Exigir habilitação dos alunos" }) as HTMLInputElement).disabled).toBe(true);
    expect(within(frozen).getByText("A avaliação já começou; a modalidade não pode mais mudar.")).toBeDefined();
  });
});

// SPEC-077 CA-13: a tab the teacher opened and left shows what stops the save, and the list of reasons says where each one is.
describe("AssessmentForm tab indicators", () => {
  it("marks a tab only after it was opened and left, and never the tab that is open", () => {
    setup();
    for (const name of ["Dados", "Período", "Questões", "Participantes", "Observações privadas"]) expect(invalid(name)).toBe(false); // nothing at first
    open("Período"); // left Dados, which has no title
    expect(invalid("Dados")).toBe(true);
    expect(invalid("Período")).toBe(false); // open, and it has no dates, but it is where the teacher is
    expect(invalid("Questões")).toBe(false); // never opened

    open("Questões");
    expect(invalid("Período")).toBe(true);
    expect(invalid("Dados")).toBe(true);
    expect(invalid("Questões")).toBe(false);
    expect(invalid("Participantes")).toBe(false); // nothing wrong there
  });

  it("tells a screen reader that the tab has something to fix, without changing the name of the tab", () => {
    setup();
    open("Período");
    const dados = tab("Dados");
    expect(document.getElementById(dados.getAttribute("aria-describedby")!)!.textContent).toBe(note);
    expect(tab("Período").getAttribute("aria-describedby")).toBeNull();
  });

  it("takes the indicator away when the reason goes away", () => {
    setup();
    open("Período");
    type(screen.getByLabelText(/^Início/), "2026-10-23T09:00");
    type(screen.getByLabelText(/^Término/), "2026-10-23T11:00");
    open("Questões");
    expect(invalid("Período")).toBe(false);
    expect(invalid("Dados")).toBe(true);
    open("Dados");
    type(screen.getByLabelText(/^Título/), "Prova 1");
    open("Questões");
    expect(invalid("Dados")).toBe(false);
  });

  it("names the tab of each reason in the list, and each item opens its tab", () => {
    setup();
    const save = screen.getByRole("button", { name: "Agendar avaliação" });
    const list = document.getElementById(save.getAttribute("aria-describedby")!)!;
    const items = within(list).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual([
      "título (aba Dados)",
      "início e término (aba Período)",
      "módulo (aba Questões)",
      "questões (aba Questões)",
    ]);

    fireEvent.click(within(list).getByRole("button", { name: "início e término (aba Período)" }));
    expect(tab("Período").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(list).getByRole("button", { name: "módulo (aba Questões)" }));
    expect(tab("Questões").getAttribute("aria-selected")).toBe("true");
  });

  it("places the reasons of the participants and of the duration in their own tabs", () => {
    const initial: AssessmentFormInitial = {
      title: "Prova 1",
      moduleId: "mod-1",
      startsAt: "2026-10-23T09:00:00-03:00",
      endsAt: "2026-10-23T11:00:00-03:00",
      durationMinutes: 4,
      items: [{ questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 10 }],
      audience: "SELECTED",
      studentIds: [],
    };
    setup({ initial });
    const list = document.getElementById(screen.getByRole("button", { name: "Agendar avaliação" }).getAttribute("aria-describedby")!)!;
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["duração válida (aba Período)", "alunos escolhidos (aba Participantes)"]);
  });
});
