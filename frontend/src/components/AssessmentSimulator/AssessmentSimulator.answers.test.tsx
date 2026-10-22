import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detail, simulation } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import type { PreviewData } from "@/services/assessmentService";
import { AssessmentSimulator } from "./AssessmentSimulator";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

// The editor of the answer is a rich text one; here a plain field stands in for it, so the test writes the answer.
vi.mock("@/components/RichTextEditor/RichTextEditor", () => ({
  RichTextEditor: ({ label, onChange }: { label: string; onChange: (html: string) => void }) => (
    <textarea aria-label={label} onChange={(e) => onChange(e.target.value ? `<p>${e.target.value}</p>` : "")} />
  ),
}));

beforeEach(() => mount.mockImplementation(terminalMount().mount));

async function start(data: PreviewData = simulation()) {
  render(<AssessmentSimulator detail={detail()} load={() => Promise.resolve(data)} loadScenario={() => Promise.resolve(null)} checkQuestion={() => Promise.resolve(false)} backHref="/x" />);
  const student = await screen.findByRole("tabpanel", { name: "Visão do aluno" });
  fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
  return student;
}
const goTo = (student: HTMLElement, n: number) => fireEvent.click(within(student).getByRole("button", { name: new RegExp(`^Questão ${n},`) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-081 CA-06, CA-13: each kind of question with the component of its kind in the mode of an assessment, and nothing says if it is right.
describe("AssessmentSimulator answers", () => {
  it("true or false: two buttons, a choice that changes and no verdict", async () => {
    const student = await start();
    fireEvent.click(within(student).getByRole("radio", { name: "Verdadeiro" }));
    expect(within(student).getByRole("radio", { name: "Verdadeiro" }).getAttribute("aria-checked")).toBe("true");
    expect(student.textContent).not.toMatch(/acertou|errou|resposta correta|faltou o -r/i);
  });

  it("single choice: the alternatives in the order of the teacher when she keeps it, a choice that changes and no mark of the right one", async () => {
    const student = await start();
    goTo(student, 2);
    expect(within(student).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Ao root", "Bquem criou", "Co grupo"]);
    fireEvent.click(within(student).getByRole("radio", { name: /quem criou/ }));
    expect(within(student).getByRole("radio", { name: /quem criou/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(student).getByRole("radio", { name: /o grupo/ }));
    expect(within(student).getByRole("radio", { name: /quem criou/ }).getAttribute("aria-checked")).toBe("false");
    expect(student.textContent).not.toMatch(/alternativa correta|o dono é quem criou/i);
  });

  it("single choice: shuffles the alternatives when the question asks", async () => {
    const data = simulation();
    data.questions = data.questions.map((q) => (q.questionId === "q-single" ? { ...q, studentView: { ...q.studentView, shuffle: true } } : q));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const student = await start(data);
    goTo(student, 2);
    // with the random number always 0, the order a, b, c becomes b, c, a
    expect(within(student).getAllByRole("radio").map((r) => r.textContent?.slice(1))).toEqual(["quem criou", "o grupo", "o root"]);
  });

  it("matching: links an item of each column, and the links change", async () => {
    const student = await start();
    goTo(student, 3);
    expect(within(student).getByText("0 de 2 ligações feitas.")).toBeDefined();
    fireEvent.click(within(within(student).getByRole("list", { name: "Coluna da esquerda" })).getByRole("button", { name: "ls" }));
    fireEvent.click(within(within(student).getByRole("list", { name: "Coluna da direita" })).getByRole("button", { name: "lista" }));
    expect(within(student).getByText("1 de 2 ligações feitas.")).toBeDefined();
    expect(within(student).queryByRole("button", { name: /Conferir/ })).toBeNull();
    expect(within(student).getByRole("button", { name: "Questão 3, respondida" })).toBeDefined();
  });

  it("descriptive: writes the answer with the size of the question and warns when it is too long, with no button to send", async () => {
    const student = await start();
    goTo(student, 4);
    expect(within(student).getByText("0 de 50 caracteres")).toBeDefined();
    expect(within(student).getByText("Escreva com texto e comandos. Você pode mudar a resposta até entregar.")).toBeDefined();
    const field = within(student).getByRole("textbox", { name: "Sua resposta" });
    fireEvent.change(field, { target: { value: "chmod muda a permissão" } });
    expect(within(student).getByText("22 de 50 caracteres")).toBeDefined();
    expect(within(student).getByRole("button", { name: "Questão 4, respondida" })).toBeDefined();
    fireEvent.change(field, { target: { value: "x".repeat(60) } });
    expect(within(student).getByRole("alert").textContent).toBe("A resposta passa de 50 caracteres. Encurte para entregar.");
    expect(within(student).queryByRole("button", { name: "Enviar resposta" })).toBeNull();
    fireEvent.change(field, { target: { value: "" } });
    expect(within(student).getByRole("button", { name: "Questão 4, sem resposta" })).toBeDefined();
  });

  // SPEC-084 CA-03, CA-12: the practical question is answered in the terminal beside it, and the simulator does not check it.
  it("practical: the statement and the way to answer, in the terminal, with no area of answer and no verdict", async () => {
    const student = await start();
    goTo(student, 5);
    expect(within(student).getByText(/Crie a pasta/)).toBeDefined();
    expect(within(student).getByText("Resolva no terminal.")).toBeDefined();
    expect(within(student).getByRole("region", { name: "Terminal" })).toBeDefined();
    expect(within(student).queryByRole("textbox")).toBeNull();
    expect(student.textContent).not.toMatch(/acertou|errou|concluída|travada|O terminal aparece aqui/i);
  });
});
