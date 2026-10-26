import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detail, drawSimulation, simulation } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import type { AssessmentDetail, PreviewData } from "@/services/assessmentService";
import { AssessmentSimulator } from "./AssessmentSimulator";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
vi.mock("@/components/RichTextEditor/RichTextEditor", () => ({
  RichTextEditor: ({ label, onChange }: { label: string; onChange: (html: string) => void }) => (
    <textarea aria-label={label} onChange={(e) => onChange(e.target.value ? `<p>${e.target.value}</p>` : "")} />
  ),
}));

beforeEach(() => mount.mockImplementation(terminalMount().mount));

/** The simulator opens on the tab of the student; the teacher reads the other one, which is kept as it was while the student view is used. */
async function open(data: PreviewData = simulation(), over: Partial<AssessmentDetail> = {}, load = vi.fn(() => Promise.resolve(data))) {
  render(<AssessmentSimulator detail={detail(over)} load={load} loadScenario={() => Promise.resolve(null)} checkQuestion={() => Promise.resolve(false)} onExit={() => {}} />);
  await screen.findByRole("tabpanel", { name: "Visão do aluno" });
  const showStudent = () => {
    fireEvent.click(screen.getByRole("tab", { name: "Aluno" }));
    return screen.getByRole("tabpanel", { name: "Visão do aluno" });
  };
  const showTeacher = () => {
    fireEvent.click(screen.getByRole("tab", { name: "Professor" }));
    return screen.getByRole("tabpanel", { name: "Visão do professor" });
  };
  return { showStudent, showTeacher, load };
}
const questionOf = (teacher: HTMLElement, n: number) => within(teacher).getAllByRole("listitem").filter((li) => li.getAttribute("data-question"))[n - 1]!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mount.mockReset();
});

// SPEC-081 CA-11, as SPEC-084 CA-12 keeps it: the view of the teacher lists the questions in the order of the student, with the key and the simulated
// answer, and gives no grade; it is now the other tab.
describe("AssessmentSimulator, view of the teacher", () => {
  it("lists the questions in order with the place, the title, the kind, the level, the value, the statement, the key and the explanation", async () => {
    const { showTeacher } = await open();
    const teacher = showTeacher();
    const first = questionOf(teacher, 1);
    expect(within(first).getByText("1")).toBeDefined();
    expect(within(first).getByText("Apagar a pasta")).toBeDefined();
    expect(within(first).getByText("Verdadeiro ou falso")).toBeDefined();
    expect(within(first).getByText("Fácil")).toBeDefined();
    expect(within(first).getByText("2,00 pontos")).toBeDefined();
    expect(within(first).getByText("O rm sozinho apaga uma pasta?")).toBeDefined();
    expect(within(first).getByText("false")).toBeDefined();
    expect(within(first).getByText("Faltou o -r.")).toBeDefined();
    expect(within(teacher).getAllByRole("listitem").filter((li) => li.getAttribute("data-question")).map((li) => li.getAttribute("data-question"))).toEqual([
      "q-bool",
      "q-single",
      "q-match",
      "q-disc",
      "q-prac",
    ]);
  });

  it("says the question is not answered until the student view answers it, and then shows the simulated answer of each kind next to the key", async () => {
    const { showStudent, showTeacher } = await open();
    const teacherAtFirst = showTeacher();
    expect(within(teacherAtFirst).getAllByText("Não respondida")).toHaveLength(4);
    expect(within(teacherAtFirst).getAllByText("Não resolvida")).toHaveLength(1);
    expect(within(teacherAtFirst).getAllByText("Resposta simulada")).toHaveLength(5);

    let student = showStudent();
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
    fireEvent.click(within(student).getByRole("button", { name: /^Questão 2,/ }));
    fireEvent.click(within(student).getByRole("radio", { name: /quem criou/ }));
    fireEvent.click(within(student).getByRole("button", { name: /^Questão 3,/ }));
    fireEvent.click(within(within(student).getByRole("list", { name: "Coluna da esquerda" })).getByRole("button", { name: "cd" }));
    fireEvent.click(within(within(student).getByRole("list", { name: "Coluna da direita" })).getByRole("button", { name: "muda" }));
    fireEvent.click(within(student).getByRole("button", { name: /^Questão 4,/ }));
    fireEvent.change(within(student).getByRole("textbox", { name: "Sua resposta" }), { target: { value: "muda a permissão" } });

    const teacher = showTeacher();
    expect(within(within(questionOf(teacher, 1)).getByTestId("simulated")).getByText("Falso")).toBeDefined();
    expect(within(within(questionOf(teacher, 2)).getByTestId("simulated")).getByText("quem criou")).toBeDefined();
    expect(within(questionOf(teacher, 3)).getByText("cd → muda")).toBeDefined();
    expect(within(within(questionOf(teacher, 4)).getByTestId("simulated")).getByText("muda a permissão")).toBeDefined();
    expect(within(teacher).queryAllByText("Não respondida")).toHaveLength(0);
    expect(within(teacher).getAllByText("Não resolvida")).toHaveLength(1);
    student = showStudent();
    expect(within(student).getByRole("heading", { name: "Questão 4 de 5" })).toBeDefined();
  });

  it("marks the question that is open in the view of the student", async () => {
    const { showStudent, showTeacher } = await open();
    const student = showStudent();
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    let teacher = showTeacher();
    expect(questionOf(teacher, 1).getAttribute("aria-current")).toBe("true");
    expect(questionOf(teacher, 2).getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(showStudent()).getByRole("button", { name: "Próxima" }));
    teacher = showTeacher();
    expect(questionOf(teacher, 1).getAttribute("aria-current")).toBeNull();
    expect(questionOf(teacher, 2).getAttribute("aria-current")).toBe("true");
  });

  it("gives no grade, no score and no mark of right or wrong, even when the answer is the key", async () => {
    const { showStudent, showTeacher } = await open();
    const student = showStudent();
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
    fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
    const teacher = showTeacher();
    expect(teacher.textContent).not.toMatch(/acertou|errou|\bcerto\b|\berrado\b|pontuação|nota (final|da simulação)|% de acerto/i);
    expect(within(teacher).queryByRole("meter")).toBeNull();
  });
});

// SPEC-081 CA-12, D-04: in a draw, the teacher sees the rules and the student gets the sample; Draw again asks for another and restarts.
describe("AssessmentSimulator, draw", () => {
  it("shows the rules for the teacher and uses the sample as the questions of the student, with the points of the level", async () => {
    const { showStudent, showTeacher } = await open(drawSimulation(), { composition: "DRAW", items: [] });
    expect(within(showTeacher()).getByRole("table", { name: "Regras do sorteio" })).toBeDefined();
    const student = showStudent();
    expect(within(student).getByText("2 questões")).toBeDefined();
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    expect(within(student).getByText("O rm sozinho apaga uma pasta?")).toBeDefined();
    expect(within(student).getByText("3,00 pontos")).toBeDefined();
    fireEvent.click(within(student).getByRole("button", { name: "Próxima" }));
    expect(within(student).getByText("7,00 pontos")).toBeDefined();
  });

  it("asks for another sample and restarts the simulation on Draw again", async () => {
    const load = vi.fn().mockResolvedValueOnce(drawSimulation()).mockResolvedValue(drawSimulation({ sample: drawSimulation().sample!.slice(0, 1) }));
    const { showStudent } = await open(drawSimulation(), { composition: "DRAW", items: [] }, load);
    const student = showStudent();
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
    fireEvent.click(screen.getByRole("button", { name: "Sortear de novo" }));
    expect(await within(student).findByText("1 questão")).toBeDefined();
    expect(within(student).getByRole("button", { name: "Começar" })).toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("has no Draw again button when the questions were chosen one by one", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Sortear de novo" })).toBeNull();
  });
});
