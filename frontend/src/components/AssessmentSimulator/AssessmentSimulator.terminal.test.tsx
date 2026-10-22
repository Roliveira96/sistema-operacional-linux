import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detail, simulation } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import type { PreviewData } from "@/services/assessmentService";
import { AssessmentSimulator } from "./AssessmentSimulator";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
vi.mock("@/components/RichTextEditor/RichTextEditor", () => ({ RichTextEditor: () => <textarea aria-label="Sua resposta" /> }));

let terminal: ReturnType<typeof terminalMount>;
beforeEach(() => {
  terminal = terminalMount();
  mount.mockImplementation(terminal.mount);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mount.mockReset();
});

const scenarioOf = (id: string) => ({ machine: id });
const loadScenario = vi.fn((id: string) => Promise.resolve(scenarioOf(id)));

/** The exam of the fixture has, in order: true or false, single choice, matching, descriptive and a practical one (question 5). */
async function start(data: PreviewData = simulation(), over = {}) {
  loadScenario.mockClear();
  render(<AssessmentSimulator detail={detail({ durationMinutes: 60, ...over })} load={() => Promise.resolve(data)} loadScenario={loadScenario} checkQuestion={() => Promise.resolve(false)} backHref="/x" />);
  const student = await screen.findByRole("tabpanel", { name: "Visão do aluno" });
  fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
  return student;
}
const goTo = (student: HTMLElement, n: number) => fireEvent.click(within(student).getByRole("button", { name: new RegExp(`^Questão ${n},`) }));
const reset = () => screen.getByRole("button", { name: /Reset Máquina/ }) as HTMLButtonElement;

// SPEC-084 CA-01, CA-03 to CA-09: the screen of the exam of the student, the question beside the terminal, with the machine of the question.
describe("AssessmentSimulator, the terminal of the exam", () => {
  it("opens the terminal when the exam starts, beside the question, locked while the question is a theoretical one", async () => {
    const data = simulation();
    render(<AssessmentSimulator detail={detail()} load={() => Promise.resolve(data)} loadScenario={loadScenario} checkQuestion={() => Promise.resolve(false)} backHref="/x" />);
    const student = await screen.findByRole("tabpanel", { name: "Visão do aluno" });
    expect(mount).not.toHaveBeenCalled();
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(within(student).getByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
    expect(within(student).getByRole("region", { name: "Terminal" })).toBeDefined();
    expect(within(student).getByText("Esta questão não usa o terminal.")).toBeDefined();
    expect(reset().disabled).toBe(true);
    expect(loadScenario).not.toHaveBeenCalled();
  });

  it("puts the machine of the practical question in the terminal when it opens, and the Reset button works there", async () => {
    const student = await start();
    goTo(student, 5);
    await waitFor(() => expect(loadScenario).toHaveBeenCalledWith("q-prac"));
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ machine: "q-prac" }));
    expect(within(student).getByText("Resolva no terminal.")).toBeDefined();
    expect(within(student).queryByText("Esta questão não usa o terminal.")).toBeNull();
    expect(reset().disabled).toBe(false);

    fireEvent.click(reset());
    fireEvent.click(within(screen.getByRole("dialog", { name: "Reiniciar a máquina?" })).getByRole("button", { name: "Formatar a máquina" }));
    await waitFor(() => expect(terminal.windows[0]!.resetAnimated).toHaveBeenCalledWith({ machine: "q-prac" }));
  });

  it("brings back what the student left in the practical question when the student comes back to it", async () => {
    const student = await start();
    goTo(student, 5);
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledTimes(1));
    terminal.callbacks[0]!.onCommand({ machine: "q-prac", typed: "ls" });
    goTo(student, 1);
    goTo(student, 5);
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenLastCalledWith({ machine: "q-prac", typed: "ls" }));
    expect(loadScenario).toHaveBeenCalledTimes(1);
  });

  it("has the terminal only when the exam has a practical question: otherwise the question has the whole width and there is no Reset", async () => {
    const data = simulation();
    data.questions = data.questions.filter((q) => q.questionId !== "q-prac");
    const student = await start(data);
    expect(within(student).getByRole("heading", { name: "Questão 1 de 4" })).toBeDefined();
    expect(mount).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reset Máquina/ })).toBeNull();
  });

  it("keeps the exam as it is when the teacher looks at the other tab: the same terminal, the answers, and the time that goes on", async () => {
    const data = simulation();
    render(<AssessmentSimulator detail={detail({ durationMinutes: 60 })} load={() => Promise.resolve(data)} loadScenario={loadScenario} checkQuestion={() => Promise.resolve(false)} backHref="/x" />);
    const student = await screen.findByRole("tabpanel", { name: "Visão do aluno" });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));

    fireEvent.click(screen.getByRole("tab", { name: "Professor" }));
    expect(screen.queryByRole("tabpanel", { name: "Visão do aluno" })).toBeNull();
    act(() => void vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole("tab", { name: "Aluno" }));

    expect(mount).toHaveBeenCalledTimes(1);
    expect(terminal.windows[0]!.destroy).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Falso" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("00:59:55");
    expect(screen.getByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
  });

  it("closes the terminal when the exam is delivered and opens a new one, from the scenarios, when it is done again", async () => {
    const student = await start();
    goTo(student, 5);
    await waitFor(() => expect(loadScenario).toHaveBeenCalledTimes(1));
    fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
    expect(terminal.windows[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();

    fireEvent.click(within(student).getByRole("button", { name: "Refazer" }));
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    goTo(student, 5);
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadScenario).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(terminal.windows[1]!.reset).toHaveBeenCalledWith({ machine: "q-prac" }));
  });

  it("has the delivery in the header of the exam and nothing of the study of the module", async () => {
    const student = await start();
    expect(within(student).getAllByRole("button", { name: "Entregar" })).toHaveLength(1);
    expect(within(student).queryByRole("button", { name: /Cola|Som|Mudo|Painel de processos/ })).toBeNull();
  });
});
