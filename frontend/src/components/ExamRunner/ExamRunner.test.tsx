import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { studentAttempt } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import type { StudentAttempt } from "@/services/assessmentService";
import { ExamRunner } from "./ExamRunner";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
vi.mock("@/components/RichTextEditor/RichTextEditor", () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea aria-label="Sua resposta" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

let terminal: ReturnType<typeof terminalMount>;
beforeEach(() => {
  terminal = terminalMount();
  mount.mockImplementation(terminal.mount);
});
afterEach(() => {
  cleanup();
  mount.mockReset();
});

function setup(attempt: StudentAttempt = studentAttempt(), over: Partial<{ save: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> }> = {}) {
  const save = over.save ?? vi.fn().mockResolvedValue(undefined);
  const check = over.check ?? vi.fn().mockResolvedValue(false);
  const submit = over.submit ?? vi.fn().mockResolvedValue({ ...attempt, status: "SUBMITTED", submittedAt: "2026-10-21T10:15:00-03:00" });
  render(<ExamRunner attempt={attempt} title="Prova de teste" save={save as never} check={check as never} submit={submit as never} />);
  return { save, check, submit };
}
const goTo = (n: number) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Questão ${n},`) }));

// SPEC-090 CA-12: the window of the exam, with the time by the clock of the server, the questions, and the answers saved as the student works.
describe("ExamRunner, answering", () => {
  it("shows the time left by the clock of the server, the questions and the first one", () => {
    setup();
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("01:00:00");
    expect(screen.getByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
    expect(screen.getByText("O rm -r apaga a pasta.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Questão 1, sem resposta" })).toBeDefined();
  });

  it("saves an answer as soon as it changes, in the form of the server, and says it was saved", async () => {
    const { save } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Verdadeiro" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, { value: true }));
    expect(await screen.findByText("Salvo")).toBeDefined();
    expect(screen.getByRole("button", { name: "Questão 1, respondida" })).toBeDefined();
    goTo(2);
    fireEvent.click(screen.getByRole("radio", { name: "chmod" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(2, { choice: "a" }));
  });

  it("says when it cannot save and keeps the answer to send later", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    setup(studentAttempt(), { save });
    fireEvent.click(screen.getByRole("radio", { name: "Falso" }));
    expect(await screen.findByText("Sem conexão: suas respostas serão enviadas quando ela voltar.")).toBeDefined();
    save.mockResolvedValue(undefined);
    await waitFor(() => expect(save.mock.calls.length).toBeGreaterThan(1), { timeout: 7000 });
    expect(await screen.findByText("Salvo")).toBeDefined();
  }, 10000);

  it("saves the machine of the practical question after a command, and the Conferir button checks it and celebrates", async () => {
    const check = vi.fn().mockResolvedValue(true);
    const { save } = setup(studentAttempt(), { check });
    goTo(4);
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ cwd: "/root" }));
    terminal.callbacks[0]!.onCommand({ cwd: "/root", made: "/a" });
    await waitFor(() => expect(save).toHaveBeenCalledWith(4, { cwd: "/root", made: "/a" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferir" }));
    await waitFor(() => expect(check).toHaveBeenCalledWith(4, { cwd: "/root", made: "/a" }));
    expect(await screen.findByText("Questão resolvida!")).toBeDefined();
    expect(screen.getByRole("button", { name: "Questão 4, resolvida" })).toBeDefined();
  });

  it("does not offer Conferir in a question that is not practical, and never says whether an answer is right", async () => {
    const { save } = setup();
    expect(screen.queryByRole("button", { name: "Conferir" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Verdadeiro" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.queryByText(/acertou|errou|correta/i)).toBeNull();
  });
});

// SPEC-090 CA-14: the window opened again brings the answers and each machine as they were saved.
describe("ExamRunner, coming back", () => {
  it("shows the answers saved and puts the saved machine in the terminal", async () => {
    const attempt = studentAttempt();
    attempt.items[0]!.answer = { value: false };
    attempt.items[3]!.answer = { cwd: "/root", made: "/a" };
    attempt.items[3]!.checkedSolved = true;
    setup(attempt);
    expect((screen.getByRole("radio", { name: "Falso" }) as HTMLElement).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Questão 4, resolvida" })).toBeDefined();
    goTo(4);
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ cwd: "/root", made: "/a" }));
  });
});

// SPEC-090 CA-13: delivering asks first, with the count of the blank questions, and the end of the time delivers alone.
describe("ExamRunner, delivering", () => {
  it("asks before delivering, with the questions without answer, and then locks", async () => {
    const { submit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Entregar a prova" }));
    const dialog = screen.getByRole("dialog", { name: "Entregar a prova?" });
    expect(within(dialog).getByText("5 questões estão sem resposta. Depois de entregar, não dá para mudar nada.")).toBeDefined();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Entregar" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Prova entregue.")).toBeDefined();
    expect(screen.queryByRole("radio", { name: "Verdadeiro" })).toBeNull();
  });

  it("delivers alone when the time is over, and says so", async () => {
    const { submit } = setup(studentAttempt({ deadlineAt: "2026-10-21T10:00:00-03:00" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("O tempo acabou. Sua prova foi entregue.")).toBeDefined();
  });
});

// SPEC-090 revision 2 (CA-18): what the server did not confirm and the line typed without Enter stay in the browser and come back over the server.
describe("ExamRunner, the copy in the browser", () => {
  const KEY = "exam-attempt:a-1";
  const local = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as { pending?: Record<string, unknown>; typed?: Record<string, string> } | null;
  beforeEach(() => localStorage.clear());

  it("keeps an answer in the browser until the server confirms it", async () => {
    let confirm = () => {};
    const save = vi.fn(() => new Promise<void>((done) => (confirm = done)));
    setup(studentAttempt(), { save });
    fireEvent.click(screen.getByRole("radio", { name: "Verdadeiro" }));
    expect(local()?.pending).toEqual({ 1: { value: true } });
    await waitFor(() => expect(save).toHaveBeenCalled());
    confirm();
    await waitFor(() => expect(local()?.pending ?? {}).toEqual({}));
  });

  it("comes back with what the server did not confirm, over what came from the server, and sends it", async () => {
    localStorage.setItem(KEY, JSON.stringify({ pending: { 1: { value: false }, 4: { cwd: "/root", made: "/b" } } }));
    const attempt = studentAttempt();
    attempt.items[0]!.answer = { value: true };
    const { save } = setup(attempt);
    expect((screen.getByRole("radio", { name: "Falso" }) as HTMLElement).getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, { value: false }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(4, { cwd: "/root", made: "/b" }));
    goTo(4);
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalledWith({ cwd: "/root", made: "/b" }));
  });

  it("keeps the line typed without Enter and puts it back in the terminal", async () => {
    const attempt = studentAttempt();
    attempt.items[3]!.answer = { cwd: "/root" };
    setup(attempt);
    goTo(4);
    await waitFor(() => expect(terminal.windows[0]!.reset).toHaveBeenCalled());
    terminal.windows[0]!.typedLine.mockReturnValue("ls -");
    fireEvent.keyDown(screen.getByRole("region", { name: "Terminal" }), { key: "-" });
    await waitFor(() => expect(local()?.typed).toEqual({ 4: "ls -" }));

    cleanup();
    setup(attempt);
    goTo(4);
    await waitFor(() => expect(terminal.windows.at(-1)!.restoreTerminal).toHaveBeenCalledWith({ linha: "ls -" }));
  });

  it("clears the copy when the exam is delivered", async () => {
    localStorage.setItem(KEY, JSON.stringify({ typed: { 4: "ls" } }));
    const { submit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Entregar a prova" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("goes on with the server alone when the browser does not let it keep anything", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { save } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Verdadeiro" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, { value: true }));
    setItem.mockRestore();
  });
});
