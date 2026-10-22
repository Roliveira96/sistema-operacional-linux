import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detail, simulation } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import type { AssessmentDetail, PreviewData } from "@/services/assessmentService";
import { AssessmentSimulator } from "./AssessmentSimulator";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

const BACK = "/app/classes/c-1/assessments/a-1";
const loadScenario = () => Promise.resolve(null);

beforeEach(() => mount.mockImplementation(terminalMount().mount));

async function open(over: Partial<AssessmentDetail> = {}, data: PreviewData = simulation()) {
  const load = vi.fn(() => Promise.resolve(data));
  render(<AssessmentSimulator detail={detail({ durationMinutes: 60, description: "<p>Leia com atenção.</p>", ...over })} load={load} loadScenario={loadScenario} backHref={BACK} />);
  const student = await screen.findByRole("tabpanel", { name: "Visão do aluno" });
  return { student, load };
}
const begin = (student: HTMLElement) => fireEvent.click(within(student).getByRole("button", { name: "Começar" }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

// SPEC-081 section 3.1: the simulator of the exam, with the view of the teacher and the view of the student side by side.
describe("AssessmentSimulator", () => {
  // SPEC-081 CA-02, CA-03, RN-04: two views from 48 rem; below it only the notice, and the preview is not even read.
  describe("the window", () => {
    // SPEC-084 CA-02: two tabs, the student first; the banner and the real situation stay above them.
    it("shows the tabs Aluno and Professor with the student first, and the banner that nothing is sent", async () => {
      await open();
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["Aluno", "Professor"]);
      expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
      expect(screen.getByRole("tabpanel", { name: "Visão do aluno" })).toBeDefined();
      expect(screen.queryByRole("tabpanel", { name: "Visão do professor" })).toBeNull();
      fireEvent.click(tabs[1]!);
      expect(screen.getByRole("tabpanel", { name: "Visão do professor" })).toBeDefined();
      expect(screen.queryByRole("tabpanel", { name: "Visão do aluno" })).toBeNull();
      expect(screen.getByRole("note").textContent).toBe("Simulação: nada é enviado nem gravado");
      expect(screen.getByText("Situação real: Agendada")).toBeDefined();
    });

    it("below 48 rem shows only the notice and the way back, with no view and no reading of the preview", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
      const load = vi.fn(() => Promise.resolve(simulation()));
      render(<AssessmentSimulator detail={detail()} load={load} loadScenario={loadScenario} backHref={BACK} />);
      expect(screen.getByText("O simulador, como a prova, precisa de uma tela maior. Abra no computador ou no tablet.")).toBeDefined();
      expect(screen.getByRole("link", { name: "Voltar à avaliação" }).getAttribute("href")).toBe(BACK);
      expect(screen.queryByRole("tabpanel", { name: "Visão do aluno" })).toBeNull();
      expect(screen.queryByRole("tabpanel", { name: "Visão do professor" })).toBeNull();
      expect(load).not.toHaveBeenCalled();
      expect(mount).not.toHaveBeenCalled();
      expect(window.matchMedia).toHaveBeenCalledWith("(min-width: 48rem)");
    });

    it("says it could not load the preview and tries again", async () => {
      const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(simulation());
      render(<AssessmentSimulator detail={detail()} load={load} loadScenario={loadScenario} backHref={BACK} />);
      expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar a pré-visualização.");
      fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
      expect(await screen.findByRole("tabpanel", { name: "Visão do aluno" })).toBeDefined();
    });
  });

  // SPEC-081 CA-04: before starting, the student reads what the exam is.
  describe("before starting", () => {
    it("shows the title, the formatted instructions, the duration, the maximum score and the number of questions", async () => {
      const { student } = await open();
      expect(within(student).getByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
      expect(within(student).getByText("Leia com atenção.")).toBeDefined();
      expect(within(student).getByText("60 minutos")).toBeDefined();
      expect(within(student).getByText("10,00")).toBeDefined();
      expect(within(student).getByText("5 questões")).toBeDefined();
      expect(within(student).getByRole("button", { name: "Começar" })).toBeDefined();
    });

    it("says the whole period when there is no individual duration", async () => {
      const { student } = await open({ durationMinutes: undefined });
      expect(within(student).getByText("Até o fim do período")).toBeDefined();
    });
  });

  // SPEC-081 CA-05, CA-07, D-06: the first question, the navigator, the countdown and the value of each question.
  describe("answering", () => {
    it("shows the first question with its place, its value, the navigator and the countdown that ticks", async () => {
      const { student } = await open();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      begin(student);
      expect(within(student).getByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
      expect(within(student).getByText("O rm sozinho apaga uma pasta?")).toBeDefined();
      expect(within(student).getByText("2,00 pontos")).toBeDefined();
      expect(within(student).getByRole("timer", { name: "Tempo restante" }).textContent).toBe("01:00:00");
      const nav = within(student).getByRole("list", { name: "Questões" });
      expect(within(nav).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
        "Questão 1, sem resposta",
        "Questão 2, sem resposta",
        "Questão 3, sem resposta",
        "Questão 4, sem resposta",
        "Questão 5, sem resposta",
      ]);
      act(() => void vi.advanceTimersByTime(1000));
      expect(within(student).getByRole("timer", { name: "Tempo restante" }).textContent).toBe("00:59:59");
    });

    it("has no countdown when there is no individual duration", async () => {
      const { student } = await open({ durationMinutes: undefined });
      begin(student);
      expect(within(student).queryByRole("timer")).toBeNull();
    });

    it("moves with Previous, Next and the navigator, keeps the answers and marks the answered ones", async () => {
      const { student } = await open();
      begin(student);
      const previous = within(student).getByRole("button", { name: "Anterior" }) as HTMLButtonElement;
      expect(previous.disabled).toBe(true);
      fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
      fireEvent.click(within(student).getByRole("button", { name: "Próxima" }));
      expect(within(student).getByRole("heading", { name: "Questão 2 de 5" })).toBeDefined();
      expect(within(student).getByRole("button", { name: "Questão 1, respondida" })).toBeDefined();
      expect(within(student).getByRole("button", { name: "Questão 2, sem resposta" }).getAttribute("aria-current")).toBe("step");

      fireEvent.click(within(student).getByRole("button", { name: "Questão 1, respondida" }));
      expect(within(student).getByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
      expect(within(student).getByRole("radio", { name: "Falso" }).getAttribute("aria-checked")).toBe("true");

      fireEvent.click(within(student).getByRole("button", { name: "Questão 5, sem resposta" }));
      expect((within(student).getByRole("button", { name: "Próxima" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("lets the answer change at any time", async () => {
      const { student } = await open();
      begin(student);
      fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
      fireEvent.click(within(student).getByRole("radio", { name: "Verdadeiro" }));
      expect(within(student).getByRole("radio", { name: "Verdadeiro" }).getAttribute("aria-checked")).toBe("true");
      expect(within(student).getByRole("radio", { name: "Falso" }).getAttribute("aria-checked")).toBe("false");
    });
  });

  // SPEC-081 CA-08, CA-09, CA-10: the delivery, the end of the time and the redo.
  describe("delivering", () => {
    it("asks first, with the number of questions left blank, and goes back to the exam when the teacher keeps answering", async () => {
      const { student } = await open();
      begin(student);
      fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
      fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
      const dialog = screen.getByRole("dialog", { name: "Entregar a simulação?" });
      expect(within(dialog).getByText("4 questões sem resposta. Entregar mesmo?")).toBeDefined();
      fireEvent.click(within(dialog).getByRole("button", { name: "Continuar respondendo" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(within(student).getByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
    });

    it("ends the simulation after the confirmation, saying that nothing was sent and how many were answered", async () => {
      const { student } = await open();
      begin(student);
      fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
      fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
      expect(within(student).getByRole("heading", { name: "Simulação entregue" })).toBeDefined();
      expect(within(student).getByText("Nada foi enviado.")).toBeDefined();
      expect(within(student).getByText("Você respondeu 1 de 5 questões.")).toBeDefined();
      expect(within(student).getByRole("button", { name: "Refazer" })).toBeDefined();
      expect(within(student).getByRole("link", { name: "Voltar à avaliação" }).getAttribute("href")).toBe(BACK);
    });

    it("ends by itself when the countdown reaches zero, saying that the time is over", async () => {
      const { student } = await open({ durationMinutes: 1 });
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      begin(student);
      act(() => void vi.advanceTimersByTime(60_000));
      expect(within(student).getByRole("heading", { name: "Simulação entregue" })).toBeDefined();
      expect(within(student).getByText("O tempo acabou.")).toBeDefined();
      expect(within(student).getByText("Você respondeu 0 de 5 questões.")).toBeDefined();
    });

    it("goes back to the beginning on Redo, with no answers and the alternatives shuffled again", async () => {
      const shuffled = simulation();
      shuffled.questions = shuffled.questions.map((q) => (q.questionId === "q-single" ? { ...q, studentView: { ...q.studentView, shuffle: true } } : q));
      const random = vi.spyOn(Math, "random").mockReturnValue(0);
      const { student } = await open({}, shuffled);
      begin(student);
      fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
      fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
      const drawn = random.mock.calls.length;
      expect(drawn).toBeGreaterThan(0);

      fireEvent.click(within(student).getByRole("button", { name: "Refazer" }));
      expect(within(student).getByRole("button", { name: "Começar" })).toBeDefined();
      begin(student);
      expect(within(student).getByRole("radio", { name: "Falso" }).getAttribute("aria-checked")).toBe("false");
      expect(within(student).getByRole("button", { name: "Questão 1, sem resposta" })).toBeDefined();
      expect(random.mock.calls.length).toBeGreaterThan(drawn);
    });
  });
});
