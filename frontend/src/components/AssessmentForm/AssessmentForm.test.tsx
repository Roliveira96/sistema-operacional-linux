import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm, type AssessmentFormProps } from "./AssessmentForm";

afterEach(cleanup);

const modules = [
  { id: "mod-1", title: "Permissões de arquivos" },
  { id: "mod-2", title: "Processos" },
];
const students = [
  { id: "s-1", name: "Ana Souza", academicId: "1000001" },
  { id: "s-2", name: "Bruno Lima", academicId: "1000002" },
  { id: "s-3", name: "Carla Dias", academicId: "1000003" },
];

function setup(over: Partial<AssessmentFormProps> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const loadQuestions = vi.fn().mockResolvedValue(questions());
  const props: AssessmentFormProps = { mode: "create", modules, students, loadQuestions, onSubmit, ...over };
  return { ...render(<AssessmentForm {...props} />), onSubmit, loadQuestions };
}

const tab = (name: string) => screen.getByRole("tab", { name });
const open = (name: string) => fireEvent.click(tab(name));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const save = (name = "Agendar avaliação") => screen.getByRole("button", { name }) as HTMLButtonElement;

/** Fills the three tabs a manual exam needs, and leaves the questions for each test to choose. */
function fillBasics() {
  type(screen.getByLabelText(/^Título/), "Prova 1");
  open("Período");
  type(screen.getByLabelText(/^Início/), "2026-10-23T09:00");
  type(screen.getByLabelText(/^Término/), "2026-10-23T11:00");
  open("Questões");
  type(screen.getByLabelText(/^Módulo/), "mod-1");
}

async function include(...titles: string[]) {
  for (const title of titles) fireEvent.click(await screen.findByRole("checkbox", { name: `Incluir ${title}` }));
}

const sumText = () => screen.getByText(/^Soma dos (pesos|pontos):/).textContent;

// SPEC-075 section 3.1 (the form in tabs), CA-24, CA-26.
describe("AssessmentForm", () => {
  it("has the five tabs of the form, with the first one open", () => {
    setup();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Dados", "Período", "Questões", "Participantes", "Observações privadas"]);
    expect(tab("Dados").getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("tabpanel")).getByLabelText(/^Título/)).toBeDefined();
    open("Participantes");
    expect(tab("Participantes").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("radio", { name: "Toda a turma" })).toBeDefined();
  });

  it("starts as an exam, with the maximum score and the duration to fill", () => {
    setup();
    expect((screen.getByLabelText("Tipo da avaliação") as HTMLSelectElement).value).toBe("EXAM");
    expect(Array.from((screen.getByLabelText("Tipo da avaliação") as HTMLSelectElement).options).map((o) => o.text)).toEqual(["Prova", "Atividade"]);
    expect(screen.getByLabelText(/^Nota máxima/)).toBeDefined();
    expect(screen.getByLabelText(/^Duração individual/)).toBeDefined();
  });

  it("keeps the save button locked until the checks pass, and says what is missing", () => {
    setup();
    expect(save().disabled).toBe(true);
    const why = document.getElementById(save().getAttribute("aria-describedby")!)!;
    expect(why.textContent).toMatch(/^Para agendar, falta:/);
    for (const missing of ["título", "início e término", "módulo", "questões"]) expect(why.textContent).toContain(missing);
  });

  it("schedules a manual assessment, with the weights shared equally", async () => {
    const { onSubmit } = setup();
    fillBasics();
    await include("Criar a pasta", "Apagar a pasta", "Mudar a permissão");
    expect(sumText()).toBe("Soma dos pesos: 0,00 de 10,00");
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Distribuir igualmente" }));
    expect((screen.getByLabelText("Peso de Criar a pasta") as HTMLInputElement).value).toBe("3.34");
    expect((screen.getByLabelText("Peso de Apagar a pasta") as HTMLInputElement).value).toBe("3.33");
    expect((screen.getByLabelText("Peso de Mudar a permissão") as HTMLInputElement).value).toBe("3.33");
    expect(sumText()).toBe("Soma dos pesos: 10,00 de 10,00");
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        moduleId: "mod-1",
        title: "Prova 1",
        description: "",
        type: "EXAM",
        maxScore: 10,
        startsAt: "2026-10-23T09:00:00-03:00",
        endsAt: "2026-10-23T11:00:00-03:00",
        composition: "MANUAL",
        modality: "IN_PERSON",
        requiresClearance: true,
        items: [
          { questionId: "q-1", weight: 3.34 },
          { questionId: "q-2", weight: 3.33 },
          { questionId: "q-3", weight: 3.33 },
        ],
        audience: "ALL_CLASS",
        teacherPrivateNotes: "",
      }),
    );
  });

  it("locks the save while the weights differ from the maximum score, and says by how much", async () => {
    setup();
    fillBasics();
    await include("Criar a pasta", "Apagar a pasta");
    type(screen.getByLabelText("Peso de Criar a pasta"), "6");
    type(screen.getByLabelText("Peso de Apagar a pasta"), "3");
    expect(sumText()).toBe("Soma dos pesos: 9,00 de 10,00");
    expect(screen.getByText("Faltam 1,00.")).toBeDefined();
    expect(save().disabled).toBe(true);
    type(screen.getByLabelText("Peso de Apagar a pasta"), "5");
    expect(screen.getByText("Passou 1,00.")).toBeDefined();
    expect(save().disabled).toBe(true);
    type(screen.getByLabelText("Peso de Apagar a pasta"), "4");
    expect(sumText()).toBe("Soma dos pesos: 10,00 de 10,00");
    expect(save().disabled).toBe(false);
  });

  it("follows the maximum score: changing it breaks a sum that was closed", async () => {
    setup();
    fillBasics();
    await include("Criar a pasta", "Apagar a pasta");
    fireEvent.click(screen.getByRole("button", { name: "Distribuir igualmente" }));
    expect(save().disabled).toBe(false);
    open("Dados");
    type(screen.getByLabelText(/^Nota máxima/), "8");
    open("Questões");
    expect(sumText()).toBe("Soma dos pesos: 10,00 de 8,00");
    expect(save().disabled).toBe(true);
  });

  describe("draw by level", () => {
    async function chooseDraw() {
      const view = setup();
      fillBasics();
      fireEvent.click(screen.getByRole("radio", { name: "Sorteio por nível" }));
      await screen.findByText("Estoque: 2");
      return view;
    }
    const level = (name: string) => within(screen.getByRole("group", { name }));

    it("shows the stock of each level next to its fields", async () => {
      await chooseDraw();
      expect(level("Fáceis").getByText("Estoque: 2")).toBeDefined();
      expect(level("Médias").getByText("Estoque: 1")).toBeDefined();
      expect(level("Difíceis").getByText("Estoque: 1")).toBeDefined();
    });

    it("adds up the total and the quantity times the points, against the maximum score", async () => {
      const { onSubmit } = await chooseDraw();
      type(level("Fáceis").getByLabelText("Quantidade"), "2");
      type(level("Fáceis").getByLabelText("Pontos por questão"), "2.5");
      type(level("Médias").getByLabelText("Quantidade"), "1");
      type(level("Médias").getByLabelText("Pontos por questão"), "2.5");
      expect(screen.getByText("Total de questões: 3")).toBeDefined();
      expect(sumText()).toBe("Soma dos pontos: 7,50 de 10,00");
      expect(save().disabled).toBe(true);
      type(level("Difíceis").getByLabelText("Quantidade"), "1");
      type(level("Difíceis").getByLabelText("Pontos por questão"), "2.5");
      expect(screen.getByText("Total de questões: 4")).toBeDefined();
      expect(sumText()).toBe("Soma dos pontos: 10,00 de 10,00");
      expect(save().disabled).toBe(false);
      fireEvent.click(save());
      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            composition: "DRAW",
            draw: {
              total: 4,
              rules: [
                { difficulty: "EASY", quantity: 2, pointsPerQuestion: 2.5 },
                { difficulty: "MEDIUM", quantity: 1, pointsPerQuestion: 2.5 },
                { difficulty: "HARD", quantity: 1, pointsPerQuestion: 2.5 },
              ],
            },
          }),
        ),
      );
      expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("items");
    });

    it("sends only the levels that have questions", async () => {
      const { onSubmit } = await chooseDraw();
      type(level("Fáceis").getByLabelText("Quantidade"), "2");
      type(level("Fáceis").getByLabelText("Pontos por questão"), "5");
      expect(save().disabled).toBe(false);
      fireEvent.click(save());
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0]![0].draw).toEqual({ total: 2, rules: [{ difficulty: "EASY", quantity: 2, pointsPerQuestion: 5 }] });
    });

    it("refuses a quantity above the stock and says how much there is", async () => {
      await chooseDraw();
      type(level("Difíceis").getByLabelText("Quantidade"), "3");
      type(level("Difíceis").getByLabelText("Pontos por questão"), "10");
      expect(level("Difíceis").getByText("Estoque insuficiente: há 1.")).toBeDefined();
      expect(save().disabled).toBe(true);
    });
  });

  describe("participants", () => {
    it("is the whole class by default, and picks students by name or by the academic number", async () => {
      const { onSubmit } = setup();
      fillBasics();
      await include("Criar a pasta");
      fireEvent.click(screen.getByRole("button", { name: "Distribuir igualmente" }));
      open("Participantes");
      expect((screen.getByRole("radio", { name: "Toda a turma" }) as HTMLInputElement).checked).toBe(true);
      expect(screen.queryByRole("searchbox")).toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: "Alunos escolhidos" }));
      expect(save().disabled).toBe(true); // nobody chosen yet
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
      type(screen.getByRole("searchbox", { name: "Buscar aluno por nome ou RA" }), "1000002");
      expect(screen.getAllByRole("checkbox")).toHaveLength(1);
      fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Bruno Lima" }));
      type(screen.getByRole("searchbox"), "carla");
      fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Carla Dias" }));
      expect(screen.getByText("2 alunos escolhidos")).toBeDefined();
      expect(save().disabled).toBe(false);
      fireEvent.click(save());
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ audience: "SELECTED", studentIds: ["s-2", "s-3"] })));
    });
  });

  it("sends the private notes along", async () => {
    const { onSubmit } = setup();
    fillBasics();
    await include("Criar a pasta");
    fireEvent.click(screen.getByRole("button", { name: "Distribuir igualmente" }));
    open("Observações privadas");
    type(screen.getByRole("textbox", { name: "Observações privadas" }), "Conferir o lab 02");
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ teacherPrivateNotes: "Conferir o lab 02" })));
  });

  describe("the checks of the data", () => {
    it("refuses a title above 150 characters and a maximum score outside 0 to 100", () => {
      setup();
      expect((screen.getByLabelText(/^Título/) as HTMLInputElement).maxLength).toBe(150);
      const score = screen.getByLabelText(/^Nota máxima/);
      type(score, "0");
      expect(save().disabled).toBe(true);
      expect(document.getElementById(save().getAttribute("aria-describedby")!)!.textContent).toContain("nota máxima");
      type(score, "100.5");
      expect(document.getElementById(save().getAttribute("aria-describedby")!)!.textContent).toContain("nota máxima");
    });

    it("refuses an end that is not after the start, and an exam over two days", () => {
      setup();
      open("Período");
      type(screen.getByLabelText(/^Início/), "2026-10-23T09:00");
      type(screen.getByLabelText(/^Término/), "2026-10-23T08:00");
      expect(screen.getByText("O término deve ser depois do início.")).toBeDefined();
      type(screen.getByLabelText(/^Término/), "2026-10-24T10:00");
      expect(screen.getByText("Uma prova começa e termina no mesmo dia.")).toBeDefined();
      type(screen.getByLabelText("Tipo da avaliação"), "ASSIGNMENT");
      expect(screen.queryByText("Uma prova começa e termina no mesmo dia.")).toBeNull();
    });

    it("holds the duration between 5 minutes and the length of the period", () => {
      setup();
      open("Período");
      type(screen.getByLabelText(/^Início/), "2026-10-23T09:00");
      type(screen.getByLabelText(/^Término/), "2026-10-23T11:00");
      open("Dados");
      const duration = screen.getByLabelText(/^Duração individual/);
      type(duration, "4");
      expect(screen.getByText("A duração vai de 5 minutos até o tamanho do período (120 minutos).")).toBeDefined();
      type(duration, "121");
      expect(screen.getByText("A duração vai de 5 minutos até o tamanho do período (120 minutos).")).toBeDefined();
      type(duration, "60");
      expect(screen.queryByText("A duração vai de 5 minutos até o tamanho do período (120 minutos).")).toBeNull();
    });
  });

  describe("made from a lesson", () => {
    const lesson = { classSessionId: "s-21", title: "Permissões de arquivos", moduleId: "mod-1", startsAt: "2026-10-21T08:20:00-03:00", endsAt: "2026-10-21T10:00:00-03:00" };

    it("opens with the start, end, title and module of the lesson, all editable (CA-25)", () => {
      setup({ initial: lesson });
      expect((screen.getByLabelText(/^Título/) as HTMLInputElement).value).toBe("Permissões de arquivos");
      open("Período");
      expect((screen.getByLabelText(/^Início/) as HTMLInputElement).value).toBe("2026-10-21T08:20");
      expect((screen.getByLabelText(/^Término/) as HTMLInputElement).value).toBe("2026-10-21T10:00");
      open("Questões");
      expect((screen.getByLabelText(/^Módulo/) as HTMLSelectElement).value).toBe("mod-1");
      type(screen.getByLabelText(/^Término/), "2026-10-21T11:00");
      expect((screen.getByLabelText(/^Término/) as HTMLInputElement).value).toBe("2026-10-21T11:00");
    });

    it("sends the lesson with what the teacher made of it", async () => {
      const { onSubmit } = setup({ initial: lesson });
      open("Questões");
      await include("Criar a pasta");
      fireEvent.click(screen.getByRole("button", { name: "Distribuir igualmente" }));
      type(screen.getByLabelText(/^Título/), "Prova 1: permissões");
      fireEvent.click(save());
      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ classSessionId: "s-21", title: "Prova 1: permissões", moduleId: "mod-1", startsAt: "2026-10-21T08:20:00-03:00", endsAt: "2026-10-21T10:00:00-03:00" }),
        ),
      );
    });
  });

  describe("editing", () => {
    const saved = {
      title: "Prova 1",
      description: "Traga o documento.",
      type: "EXAM" as const,
      maxScore: 10,
      moduleId: "mod-1",
      startsAt: "2026-10-23T09:00:00-03:00",
      endsAt: "2026-10-23T11:00:00-03:00",
      composition: "MANUAL" as const,
      items: [
        { questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY" as const, weight: 5 },
        { questionId: "q-2", title: "Apagar a pasta", kind: "PRACTICAL", difficulty: "EASY" as const, weight: 5 },
      ],
      audience: "ALL_CLASS" as const,
      teacherPrivateNotes: null,
    };

    it("starts from the saved assessment, shows the dates without a field and sends them nowhere", async () => {
      const { onSubmit } = setup({ mode: "edit", initial: saved });
      expect((screen.getByLabelText(/^Título/) as HTMLInputElement).value).toBe("Prova 1");
      open("Período");
      expect(screen.queryByLabelText(/^Início/)).toBeNull();
      expect(screen.getByText("23/10/2026, 09:00–11:00")).toBeDefined();
      expect(screen.getByText("Para mudar as datas, use Reagendar.")).toBeDefined();
      open("Questões");
      expect((screen.getByLabelText("Peso de Criar a pasta") as HTMLInputElement).value).toBe("5");
      expect(sumText()).toBe("Soma dos pesos: 10,00 de 10,00");
      fireEvent.click(save("Salvar alterações"));
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      const sent = onSubmit.mock.calls[0]![0];
      expect(sent).not.toHaveProperty("startsAt");
      expect(sent).not.toHaveProperty("endsAt");
      expect(sent).not.toHaveProperty("classSessionId");
      expect(sent.items).toEqual([
        { questionId: "q-1", weight: 5 },
        { questionId: "q-2", weight: 5 },
      ]);
    });
  });

  describe("frozen", () => {
    const saved = {
      title: "Prova 1",
      type: "EXAM" as const,
      maxScore: 10,
      moduleId: "mod-1",
      startsAt: "2026-10-21T09:00:00-03:00",
      endsAt: "2026-10-21T11:00:00-03:00",
      composition: "MANUAL" as const,
      items: [{ questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY" as const, weight: 10 }],
      audience: "SELECTED" as const,
      studentIds: ["s-1"],
    };

    it("warns that the composition cannot change and locks its fields, but not the title", () => {
      setup({ mode: "edit", initial: saved, frozen: true });
      open("Questões");
      expect(screen.getByText("A avaliação já começou; a composição não pode mais mudar.")).toBeDefined();
      for (const label of [/^Módulo/]) expect((screen.getByLabelText(label) as HTMLSelectElement).disabled).toBe(true);
      expect((screen.getByRole("radio", { name: "Sorteio por nível" }) as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Distribuir igualmente" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText("Peso de Criar a pasta") as HTMLInputElement).disabled).toBe(true);
      open("Dados");
      for (const label of [/^Nota máxima/, /^Duração individual/, "Tipo da avaliação"]) expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByLabelText(/^Título/) as HTMLInputElement).disabled).toBe(false);
      expect(screen.getByRole("textbox", { name: "Instruções gerais" }).getAttribute("contenteditable")).toBe("true");
    });

    it("lets the audience grow and never shrink", async () => {
      const { onSubmit } = setup({ mode: "edit", initial: saved, frozen: true });
      open("Participantes");
      expect((screen.getByRole("checkbox", { name: "Incluir Ana Souza" }) as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole("checkbox", { name: "Incluir Ana Souza" }) as HTMLInputElement).checked).toBe(true);
      fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Bruno Lima" }));
      fireEvent.click(save("Salvar alterações"));
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      // only what a started assessment accepts
      expect(onSubmit.mock.calls[0]![0]).toEqual({ title: "Prova 1", description: "", audience: "SELECTED", studentIds: ["s-1", "s-2"], teacherPrivateNotes: "" });
    });

    it("does not let the whole class become a few students", () => {
      setup({ mode: "edit", initial: { ...saved, audience: "ALL_CLASS", studentIds: [] }, frozen: true });
      open("Participantes");
      expect((screen.getByRole("radio", { name: "Alunos escolhidos" }) as HTMLInputElement).disabled).toBe(true);
    });
  });

  it("shows why the server refused and lets the teacher try again", async () => {
    const { onSubmit } = setup();
    onSubmit.mockRejectedValueOnce(problem("weights-mismatch", 400));
    fillBasics();
    await include("Criar a pasta");
    fireEvent.click(screen.getByRole("button", { name: "Distribuir igualmente" }));
    fireEvent.click(save());
    expect((await screen.findByRole("alert")).textContent).toBe("A soma dos pontos precisa ser igual à nota máxima.");
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("has a way back when it is given one", () => {
    const onCancel = vi.fn();
    setup({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
