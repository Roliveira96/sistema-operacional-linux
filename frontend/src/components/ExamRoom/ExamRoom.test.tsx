import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentService, type RoomHandlers } from "@/services/assessmentService";
import { SERVER_NOW, STARTED, detail, summary } from "@/test/assessmentFixtures";
import { ExamRoom } from "./ExamRoom";

const ANA = "s-ana";
const BRUNO = "s-bruno";

let handlers: RoomHandlers;
const sent: { type: string; data: unknown }[] = [];
const beep = vi.fn();

beforeEach(() => {
  sent.length = 0;
  beep.mockReset();
  vi.spyOn(assessmentService, "openRoom").mockImplementation((_c, _a, h) => {
    handlers = h;
    queueMicrotask(() => h.onOpen());
    return { send: (type, data) => void sent.push({ type, data }), close: vi.fn() };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = (over: Record<string, unknown> = {}) => ({
  studentId: ANA, name: "Ana", academicId: "1000001", status: "ABSENT", online: false, waiting: false, answered: 0, total: 5, solved: 0, ...over,
});
const snapshot = (over: Record<string, unknown> = {}) => ({
  endsAt: "2026-10-21T11:00:00-03:00", serverNow: SERVER_NOW, startedByName: "",
  cards: [card({ online: true, waiting: true }), card({ studentId: BRUNO, name: "Bruno", academicId: "1000002" })], queue: [], ...over,
});
const receive = (type: string, data: unknown) => act(() => handlers.onMessage({ type, data }));

async function setup(over: Record<string, unknown> = {}, exam = detail({ phase: "RUNNING", modality: "ONLINE" })) {
  render(<ExamRoom classId="c-1" assessment={exam} beep={beep} />);
  await waitFor(() => expect(assessmentService.openRoom).toHaveBeenCalledWith("c-1", "a-1", expect.anything()));
  receive("room:snapshot", snapshot(over));
}

// SPEC-091 CA-11: the room shows the exam, the counters and a card for each student.
describe("ExamRoom, the cards", () => {
  it("shows the title, the counters and the cards with the situation", async () => {
    await setup();
    expect(screen.getByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
    expect(screen.getByText("Na sala de espera: 1")).toBeDefined();
    const ana = screen.getByRole("button", { name: /Ana/ });
    expect(ana.textContent).toContain("Na sala de espera");
    expect(screen.getByRole("button", { name: /Bruno/ }).textContent).toContain("Ausente");
  });

  it("updates a card when the student changes, with the progress and the time left", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00", startedByName: "Profa. Sediane" });
    receive("room:student", card({ status: "IN_PROGRESS", online: true, answered: 4, total: 9, solved: 2, deadlineAt: "2026-10-21T11:00:00-03:00", attemptId: "t-1" }));
    const ana = screen.getByRole("button", { name: /Ana/ });
    expect(ana.textContent).toContain("Fazendo");
    expect(ana.textContent).toContain("4 de 9 respondidas · 2 práticas resolvidas");
    expect(screen.getByText("Fazendo: 1")).toBeDefined();
    receive("room:student", card({ status: "IN_PROGRESS", online: false, attemptId: "t-1" }));
    expect(screen.getByRole("button", { name: /Ana/ }).textContent).toContain("sem conexão");
  });
});

// SPEC-091 CA-10, CA-11 (RN-02): the start from the room, with the same dialog, admits everybody.
describe("ExamRoom, the start", () => {
  it("starts the exam from the header, after the confirmation, and then says who started it", async () => {
    const start = vi.spyOn(assessmentService, "start").mockResolvedValue({ ...summary({ ...STARTED }), serverNow: SERVER_NOW });
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar a prova" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Iniciar a prova agora?" })).getByRole("button", { name: "Iniciar a prova" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("c-1", "a-1"));
    receive("room:started", { startedAt: "2026-10-21T09:07:00-03:00", startedByName: "Profa. Sediane" });
    expect(screen.getByText("Prova iniciada às 09:07 por Profa. Sediane.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Iniciar a prova" })).toBeNull();
  });
});

// SPEC-091 CA-12: the open student, with the question, the terminal live and the commands as they come.
describe("ExamRoom, watching a student", () => {
  it("asks to watch the student, shows the commands, the screen, and stops when closed", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    receive("room:student", card({ status: "IN_PROGRESS", online: true, attemptId: "t-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Ana/ }));
    expect(sent).toContainEqual({ type: "room:watch", data: { studentId: ANA } });
    const panel = screen.getByRole("region", { name: "Ana" });
    expect(within(panel).getByText("O aluno está numa questão sem terminal.")).toBeDefined();

    receive("room:commands", { studentId: ANA, commands: [{ position: 4, command: "pwd", output: "/root", executedAt: "2026-10-21T09:10:00-03:00" }] });
    receive("room:command", { studentId: ANA, command: { position: 4, command: "mkdir /a", output: "", executedAt: "2026-10-21T09:11:00-03:00" } });
    receive("room:command", { studentId: BRUNO, command: { position: 1, command: "ls", output: "", executedAt: "2026-10-21T09:11:00-03:00" } });
    const lines = within(within(panel).getByRole("list", { name: "Comandos" })).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual([expect.stringContaining("mkdir /a"), expect.stringContaining("pwd")]);

    receive("room:screen", { studentId: ANA, position: 4, title: "Criar pasta", screen: { tag: "div", children: ["$ ls"] } });
    expect(within(panel).getByText("Questão 4: Criar pasta")).toBeDefined();
    expect(within(panel).queryByText("O aluno está numa questão sem terminal.")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Fechar" }));
    expect(sent).toContainEqual({ type: "room:watch", data: { studentId: null } });
  });
});

// SPEC-091 CA-07, CA-11 (D-03): the queue of help, with the sound, and the answer that goes to the student.
describe("ExamRoom, the help", () => {
  it("shows the queue with the sound and answers a request with a text", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    receive("help:queue", { queue: [{ id: "h-1", studentId: ANA, position: 2, question: "Posso usar o manual?", status: "OPEN", createdAt: "2026-10-21T09:31:00-03:00" }] });
    expect(beep).toHaveBeenCalledWith("hand");
    const queue = screen.getByRole("region", { name: "Pedidos de ajuda" });
    expect(within(queue).getByText("Posso usar o manual?")).toBeDefined();
    expect(within(queue).getByText(/Ana · Questão 2/)).toBeDefined();
    fireEvent.change(within(queue).getByLabelText("Resposta ao aluno"), { target: { value: "Não, só o terminal." } });
    fireEvent.click(within(queue).getByRole("button", { name: "Atendido" }));
    expect(sent).toContainEqual({ type: "help:answer", data: { requestId: "h-1", answer: "Não, só o terminal." } });
    receive("help:queue", { queue: [] });
    expect(within(queue).getByText("Nenhum pedido de ajuda.")).toBeDefined();
  });
});

// SPEC-091 CA-13: ending the exam of a student asks for the reason.
describe("ExamRoom, ending the exam of a student", () => {
  it("asks the reason and ends the attempt", async () => {
    const end = vi.spyOn(assessmentService, "endAttempt").mockResolvedValue({
      attemptId: "t-1", studentId: ANA, studentName: "Ana", academicId: "1000001", status: "ENDED_BY_TEACHER", startedAt: "2026-10-21T09:10:00-03:00",
    });
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    receive("room:student", card({ status: "IN_PROGRESS", online: true, attemptId: "t-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Ana/ }));
    fireEvent.click(screen.getByRole("button", { name: "Encerrar a prova deste aluno" }));
    const dialog = screen.getByRole("dialog", { name: "Encerrar a prova de Ana?" });
    const confirm = within(dialog).getByRole("button", { name: "Encerrar a prova" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Flagrante de cola" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(end).toHaveBeenCalledWith("c-1", "a-1", "t-1", "Flagrante de cola"));
    receive("room:student", card({ status: "ENDED_BY_TEACHER", online: true, attemptId: "t-1" }));
    expect(screen.getByRole("button", { name: /Ana/ }).textContent).toContain("Encerrada pela docente");
  });
});

// The connection that falls says so and comes back.
describe("ExamRoom, the connection", () => {
  it("says it is reconnecting when the room falls", async () => {
    await setup();
    act(() => handlers.onClose());
    expect(screen.getByRole("status", { name: "Conexão" }).textContent).toBe("Reconectando…");
  });
});
