import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detail, simulation } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import { AssessmentSimulator } from "./AssessmentSimulator";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
vi.mock("@/components/RichTextEditor/RichTextEditor", () => ({ RichTextEditor: () => <textarea aria-label="Sua resposta" /> }));

let terminal: ReturnType<typeof terminalMount>;
const check = vi.fn<(questionId: string, snapshot: unknown) => Promise<boolean>>();

beforeEach(() => {
  terminal = terminalMount();
  mount.mockImplementation(terminal.mount);
  check.mockReset().mockResolvedValue(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mount.mockReset();
});

/** The exam of the fixture, with the practical question as the fifth; the clock is the fake one after the render, so the 1 second of the wait can be told. */
async function start() {
  render(
    <AssessmentSimulator
      detail={detail({ durationMinutes: 60 })}
      load={() => Promise.resolve(simulation())}
      loadScenario={(id) => Promise.resolve({ machine: id })}
      checkQuestion={check}
      onExit={() => {}}
    />,
  );
  const student = await screen.findByRole("tabpanel", { name: "Visão do aluno" });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
  return student;
}
const goTo = (student: HTMLElement, n: number) => fireEvent.click(within(student).getByRole("button", { name: new RegExp(`^Questão ${n},`) }));
/** The practical question is open and its machine is loaded. */
async function practical() {
  const student = await start();
  goTo(student, 5);
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  return student;
}
const typed = (machine: unknown) => act(() => terminal.callbacks[0]!.onCommand(machine));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

// SPEC-085 CA-05 to CA-10: the simulator asks the server whether the machine of the practical question meets its conditions, after the commands, and
// marks the question as solved; it only marks it.
describe("AssessmentSimulator, the check of the practical question", () => {
  it("waits one second without a new command and then sends the last state of the machine", async () => {
    await practical();
    await typed({ step: 1 });
    await wait(600);
    await typed({ step: 2 });
    await wait(999);
    expect(check).not.toHaveBeenCalled();
    await wait(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith("q-prac", { step: 2 });
  });

  it("does not check before the first command, and not the machine that was just loaded", async () => {
    await practical();
    await wait(5000);
    expect(check).not.toHaveBeenCalled();
  });

  it("marks the question as solved when the server says it passed, with the mark in the navigator and the notice, and counts it as answered", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();
    expect(within(student).getByText("Questão resolvida no terminal.")).toBeDefined();
    expect(within(student).getByRole("heading", { name: "Questão 5 de 5" })).toBeDefined();
    expect((within(student).getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
    expect(within(screen.getByRole("dialog")).getByText("4 questões sem resposta. Entregar mesmo?")).toBeDefined();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
    expect(within(student).getByText("Você respondeu 1 de 5 questões.")).toBeDefined();
  });

  it("does not check a solved question again", async () => {
    check.mockResolvedValue(true);
    await practical();
    await typed({ step: 1 });
    await wait(1000);
    await typed({ step: 2 });
    await wait(3000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the question is not solved: no verdict, no hint, and it stays without answer", async () => {
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(within(student).getByRole("button", { name: "Questão 5, sem resposta" })).toBeDefined();
    expect(student.textContent).not.toMatch(/resolvida|errou|errad|falta|incorret|acertou/i);
  });

  it("checks one at a time: a new state that comes while one is being checked waits for it and then goes alone", async () => {
    let finish!: (passed: boolean) => void;
    check.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
    await practical();
    await typed({ step: 1 });
    await wait(1000);
    expect(check).toHaveBeenCalledTimes(1);
    await typed({ step: 2 });
    await wait(1000);
    expect(check).toHaveBeenCalledTimes(1);
    finish(false);
    await wait(0);
    await wait(1000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenLastCalledWith("q-prac", { step: 2 });
  });

  it("says the check failed, without bothering the terminal, and tries again at the next command", async () => {
    check.mockRejectedValueOnce(new Error("down")).mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    expect(within(student).getByText("Não foi possível conferir agora.")).toBeDefined();
    expect(within(student).getByRole("region", { name: "Terminal" })).toBeDefined();
    await typed({ step: 2 });
    await wait(1000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(within(student).queryByText("Não foi possível conferir agora.")).toBeNull();
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();
  });

  it("takes the mark off when the machine of the question is formatted, and the question can be solved again", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Reset Máquina/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Formatar a máquina" }));
    await wait(0);
    expect(within(student).getByRole("button", { name: "Questão 5, sem resposta" })).toBeDefined();
    expect(within(student).queryByText("Questão resolvida no terminal.")).toBeNull();

    await typed({ step: 3 });
    await wait(1000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();
  });

  it("takes every mark off when the exam is done again", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
    fireEvent.click(within(student).getByRole("button", { name: "Refazer" }));
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    goTo(student, 5);
    expect(within(student).getByRole("button", { name: "Questão 5, sem resposta" })).toBeDefined();
  });

  it("tells the teacher, in the other tab, that the question was solved in the terminal, and that it was not", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    fireEvent.click(screen.getByRole("tab", { name: "Professor" }));
    const before = screen.getByRole("tabpanel", { name: "Visão do professor" });
    expect(within(before).getByText("Não resolvida")).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: "Aluno" }));
    await typed({ step: 1 });
    await wait(1000);
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Professor" }));
    const after = screen.getByRole("tabpanel", { name: "Visão do professor" });
    expect(within(after).getByText("Resolvida no terminal")).toBeDefined();
    expect(within(after).queryByText("Não resolvida")).toBeNull();
    expect(after.textContent).not.toMatch(/acertou|errou|pontuação|% de acerto/i);
  });
});

// SPEC-087 CA-06 to CA-09 (D-03): the celebration when the server gives the open question as solved, and only then.
describe("AssessmentSimulator, the celebration of the solved question", () => {
  const celebration = () => screen.queryByRole("dialog", { name: "Questão resolvida!" });

  it("celebrates over the column of the question, with the terminal still active, and offers Entregar on the last question", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    const dialog = celebration();
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Era a última questão. Você pode entregar a prova.");
    expect(within(dialog!).queryByRole("region", { name: "Terminal" })).toBeNull();
    const terminal = within(student).getByRole("region", { name: "Terminal" });
    expect(terminal.querySelector("[inert]")).toBeNull();
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();
    expect(within(student).getByText("Questão resolvida no terminal.")).toBeDefined();

    fireEvent.click(within(dialog!).getByRole("button", { name: "Entregar" }));
    expect(celebration()).toBeNull();
    expect(screen.getByRole("dialog", { name: "Entregar a simulação?" })).toBeDefined();
  });

  it("offers Próxima questão when the solved question is not the last, and opens the next one", async () => {
    check.mockResolvedValue(true);
    const data = simulation();
    // the practical question first, so there is a next one
    data.questions = [{ ...data.questions[4]!, position: 1 }, ...data.questions.slice(0, 4).map((q, i) => ({ ...q, position: i + 2 }))];
    render(<AssessmentSimulator detail={detail({ durationMinutes: 60 })} load={() => Promise.resolve(data)} loadScenario={(id) => Promise.resolve({ machine: id })} checkQuestion={check} onExit={() => {}} />);
    const student = await screen.findByRole("tabpanel", { name: "Visão do aluno" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    await typed({ step: 1 });
    await wait(1000);
    const dialog = celebration();
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Você pode ir para a próxima questão.");
    const next = within(dialog!).getByRole("button", { name: "Próxima questão" });
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    expect(celebration()).toBeNull();
    expect(within(student).getByRole("heading", { name: "Questão 2 de 5" })).toBeDefined();
    expect(within(student).getByRole("button", { name: "Questão 1, resolvida" })).toBeDefined();
  });

  it("only closes with Continuar nesta questão, and does not lock the question nor come back for more commands", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    fireEvent.click(within(celebration()!).getByRole("button", { name: "Continuar nesta questão" }));
    expect(celebration()).toBeNull();
    expect(within(student).getByRole("heading", { name: "Questão 5 de 5" })).toBeDefined();
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();
    await typed({ step: 2 });
    await wait(3000);
    expect(celebration()).toBeNull();
  });

  it("only marks the question when the answer of the server comes with another question open", async () => {
    let finish!: (passed: boolean) => void;
    check.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    goTo(student, 4);
    finish(true);
    await wait(0);
    expect(celebration()).toBeNull();
    expect(within(student).getByRole("button", { name: "Questão 5, resolvida" })).toBeDefined();
    goTo(student, 5);
    expect(celebration()).toBeNull();
  });

  it("celebrates again after Reset Máquina, when the question is solved again", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    fireEvent.keyDown(celebration()!, { key: "Escape" });
    expect(celebration()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reset Máquina/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Formatar a máquina" }));
    await wait(0);
    expect(within(student).getByRole("button", { name: "Questão 5, sem resposta" })).toBeDefined();
    await typed({ step: 3 });
    await wait(1000);
    expect(celebration()).not.toBeNull();
  });

  it("goes away when the teacher moves to another question", async () => {
    check.mockResolvedValue(true);
    const student = await practical();
    await typed({ step: 1 });
    await wait(1000);
    expect(celebration()).not.toBeNull();
    goTo(student, 4);
    expect(celebration()).toBeNull();
  });
});
