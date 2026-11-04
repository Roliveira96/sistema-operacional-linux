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
    expect(screen.getByRole("button", { name: "Na sala de espera (1)" })).toBeDefined();
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
    expect(screen.getByRole("button", { name: "Fazendo (1)" })).toBeDefined();
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
    // SPEC-092 revision 3 (CA-15): in the order of the terminal, the oldest first
    expect(lines.map((l) => l.textContent)).toEqual([expect.stringContaining("pwd"), expect.stringContaining("mkdir /a")]);

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
    fireEvent.click(screen.getByRole("tab", { name: "Pedidos de ajuda (1)" })); // SPEC-092 revision 3 (CA-16): the queue is a tab of the panel
    const queue = screen.getByRole("region", { name: "Pedidos de ajuda" });
    expect(within(queue).getByText("Posso usar o manual?")).toBeDefined();
    expect(within(queue).getByText(/Ana · Questão 2/)).toBeDefined();
    fireEvent.change(within(queue).getByLabelText("Resposta ao aluno"), { target: { value: "Não, só o terminal." } });
    fireEvent.click(within(queue).getByRole("button", { name: "Atendido" }));
    expect(sent).toContainEqual({ type: "help:answer", data: { requestId: "h-1", answer: "Não, só o terminal." } });
    receive("help:queue", { queue: [] });
    expect(screen.getByText("Pedidos de ajuda: nenhum")).toBeDefined();
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

// SPEC-092: the room shows first who needs the teacher, with the situation readable at a glance.
const BIA = "s-bia";
const CAIO = "s-caio";
const DAVI = "s-davi";
const crowd = () => [
  card({ studentId: ANA, name: "Ana" }),
  card({ studentId: BRUNO, name: "Bruno", academicId: "1000002", status: "IN_PROGRESS", online: true, answered: 4, total: 9, solved: 2, attemptId: "t-2" }),
  card({ studentId: BIA, name: "Bia", academicId: "1000003", status: "SUBMITTED", online: true, attemptId: "t-3" }),
  card({ studentId: CAIO, name: "Caio", academicId: "1000004", online: true, waiting: true }),
  card({
    studentId: DAVI, name: "Davi", academicId: "1000005", status: "IN_PROGRESS", online: true, attemptId: "t-5",
    help: { id: "h-1", studentId: DAVI, question: "", status: "OPEN", createdAt: "2026-10-21T09:31:00-03:00" },
  }),
];
const order = () => within(screen.getByRole("region", { name: "Alunos" })).getAllByRole("listitem").map((li) => li.textContent?.match(/^[A-Z][a-z]+/)?.[0]);

describe("ExamRoom, SPEC-092 the order of the cards (CA-01)", () => {
  it("puts the raised hand first, then who is doing, waiting, delivered and absent", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00", cards: crowd() });
    expect(order()).toEqual(["Davi", "Bruno", "Caio", "Bia", "Ana"]);
  });
});

describe("ExamRoom, SPEC-092 the counters that filter (CA-02)", () => {
  it("filters by a counter and goes back to all when clicked again", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00", cards: crowd() });
    expect(screen.getByRole("button", { name: "Todos (5)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Mãos levantadas (1)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Entregues (1)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Ausentes (1)" })).toBeDefined();
    const doing = screen.getByRole("button", { name: "Fazendo (2)" });
    fireEvent.click(doing);
    expect(doing.getAttribute("aria-pressed")).toBe("true");
    expect(order()).toEqual(["Davi", "Bruno"]);
    fireEvent.click(doing);
    expect(order()).toHaveLength(5);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says when nobody is in the situation", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00", cards: [card({ studentId: BRUNO, name: "Bruno", status: "IN_PROGRESS", online: true })] });
    fireEvent.click(screen.getByRole("button", { name: "Entregues (0)" }));
    expect(screen.getByText("Nenhum aluno nesta situação.")).toBeDefined();
  });
});

describe("ExamRoom, SPEC-092 the card (CA-03)", () => {
  it("shows the situation in words and the progress as a bar", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00", cards: crowd() });
    const bruno = screen.getByRole("button", { name: /Bruno/ });
    expect(bruno.textContent).toContain("Fazendo");
    const bar = within(bruno).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(bar.getAttribute("aria-valuemax")).toBe("9");
    expect(within(screen.getByRole("button", { name: /Ana/ })).queryByRole("progressbar")).toBeNull();
  });
});

describe("ExamRoom, SPEC-092 the side panel (CA-04, CA-05)", () => {
  it("gives a hint with nobody open and a single line for an empty queue", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00", cards: crowd() });
    expect(screen.getByText("Clique num aluno para ver a tela e os comandos dele.")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Pedidos de ajuda (0)" })); // SPEC-092 revision 3 (CA-16)
    expect(screen.getByText("Pedidos de ajuda: nenhum")).toBeDefined();
  });

  it("tells the absent student did not enter and the delivered one has finished", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00", cards: crowd() });
    fireEvent.click(screen.getByRole("button", { name: /Ana/ }));
    let panel = screen.getByRole("region", { name: "Ana" });
    expect(within(panel).getByText("O aluno ainda não entrou na prova.")).toBeDefined();
    expect(within(panel).queryByText("O aluno está numa questão sem terminal.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Bia/ }));
    panel = screen.getByRole("region", { name: "Bia" });
    expect(within(panel).getByText("A prova deste aluno terminou.")).toBeDefined();
    expect(screen.queryByText("Clique num aluno para ver a tela e os comandos dele.")).toBeNull();
  });
});

describe("ExamRoom, SPEC-092 the time (CA-06)", () => {
  it("labels the time and says when the exam ends", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    expect(screen.getByText("Termina em")).toBeDefined();
    expect(screen.getByText("às 11:00")).toBeDefined();
  });
});

// SPEC-092 CA-08, CA-10: the clock for the class opens in a tab of its own and hears the room through the channel of the browser.
describe("ExamRoom, SPEC-092 the clock for the class", () => {
  it("opens the clock in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    fireEvent.click(screen.getByRole("button", { name: /Abrir o relógio para a turma/ }));
    expect(open).toHaveBeenCalledWith("/app/classes/c-1/assessments/a-1/room/clock", "_blank", "noopener");
  });

  it("tells the clock the names of the raised hands, never the question, and answers when the clock asks", async () => {
    const clock = new BroadcastChannel("exam-room:a-1");
    const got: Record<string, unknown>[] = [];
    clock.onmessage = (e) => got.push(e.data);
    try {
      await setup({ startedAt: "2026-10-21T09:05:00-03:00", cards: crowd() });
      receive("help:queue", { queue: [{ id: "h-1", studentId: DAVI, question: "Posso usar o manual?", status: "OPEN", createdAt: "2026-10-21T09:31:00-03:00" }] });
      await waitFor(() => expect(got.at(-1)).toMatchObject({ type: "state", hands: ["Davi"], startedAt: "2026-10-21T09:05:00-03:00" }));
      expect(JSON.stringify(got)).not.toContain("Posso usar o manual?");
      got.length = 0;
      clock.postMessage({ type: "hello" });
      await waitFor(() => expect(got.at(-1)).toMatchObject({ type: "state", hands: ["Davi"], endsAt: "2026-10-21T11:00:00-03:00" }));
      receive("help:queue", { queue: [] });
      await waitFor(() => expect(got.at(-1)).toMatchObject({ type: "state", hands: [] }));
    } finally {
      clock.close();
    }
  });
});

// SPEC-092 CA-13 (revision 2): the card of who is doing shows, first of all, the number of the question she is in, and the title under it.
describe("ExamRoom, SPEC-092 the question on the card", () => {
  it("shows the number and the title of the question of who is doing, and the open student says it with no terminal", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    receive("room:student", card({ status: "IN_PROGRESS", online: true, answered: 3, total: 9, attemptId: "t-1", question: { position: 4, title: "Criar pasta" } }));
    receive("room:student", card({ studentId: BRUNO, name: "Bruno", status: "IN_PROGRESS", online: true, total: 9, attemptId: "t-2" }));
    const ana = screen.getByRole("button", { name: /Ana/ });
    expect(within(ana).getByText("Questão 4 de 9")).toBeDefined();
    expect(within(ana).getByText("Criar pasta")).toBeDefined();
    expect(screen.getByRole("button", { name: /Bruno/ }).textContent).not.toContain("Questão");
    fireEvent.click(ana);
    const panel = screen.getByRole("region", { name: "Ana" });
    expect(within(panel).getByText("Questão 4: Criar pasta")).toBeDefined();
  });
});

// SPEC-092 revision 3: the panel of the student, with a width the teacher sets, the commands by question and the help in a tab.
const doing = (over: Record<string, unknown> = {}) => card({ status: "IN_PROGRESS", online: true, total: 9, attemptId: "t-1", ...over });

describe("ExamRoom, SPEC-092 revision 3 the width of the panel (CA-14)", () => {
  beforeEach(() => localStorage.clear());

  it("changes the width with the arrows on the divider, keeps it between the limits and remembers it", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    const divider = screen.getByRole("separator", { name: "Largura do painel" });
    expect(divider.getAttribute("aria-valuenow")).toBe("512");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider.getAttribute("aria-valuenow")).toBe("544");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider.getAttribute("aria-valuenow")).toBe("352");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    cleanup();
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    expect(screen.getByRole("separator", { name: "Largura do painel" }).getAttribute("aria-valuenow")).toBe("384");
  });

  it("expands the panel over the cards and gives them back with Recolher or Esc", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    fireEvent.click(screen.getByRole("button", { name: "Expandir" }));
    expect(screen.queryByRole("region", { name: "Alunos" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.getByRole("region", { name: "Alunos" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Expandir" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("region", { name: "Alunos" })).toBeDefined();
  });
});

describe("ExamRoom, SPEC-092 revision 3 the commands by question (CA-15)", () => {
  it("lists the commands in the order of the terminal, marks each change of question and filters by question", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    receive("room:student", doing({ question: { position: 4, title: "Criar pasta" } }));
    fireEvent.click(screen.getByRole("button", { name: /Ana/ }));
    receive("room:commands", {
      studentId: ANA,
      commands: [
        { position: 4, command: "pwd", output: "/root", executedAt: "2026-10-21T09:10:00-03:00" },
        { position: 4, command: "mkdir a", output: "", executedAt: "2026-10-21T09:11:00-03:00" },
      ],
    });
    receive("room:command", { studentId: ANA, command: { position: 6, command: "ls", output: "a", executedAt: "2026-10-21T09:12:00-03:00" } });
    const panel = screen.getByRole("region", { name: "Ana" });
    const list = within(panel).getByRole("list", { name: "Comandos" });
    expect(within(list).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
      expect.stringContaining("pwd"),
      expect.stringContaining("mkdir a"),
      expect.stringContaining("ls"),
    ]);
    expect(within(list).getByText("Questão 4: Criar pasta")).toBeDefined();
    expect(within(list).getByText("Questão 6")).toBeDefined();

    const all = within(panel).getByRole("button", { name: "Todas (3)" });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).getByRole("button", { name: "Questão 4 (2)" })).toBeDefined();
    const six = within(panel).getByRole("button", { name: "Questão 6 (1)" });
    fireEvent.click(six);
    expect(six.getAttribute("aria-pressed")).toBe("true");
    const only = within(panel).getByRole("list", { name: "Comandos" });
    expect(within(only).getAllByRole("listitem").map((l) => l.textContent)).toEqual([expect.stringContaining("ls")]);
    expect(within(only).queryByText("Questão 6")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Todas (3)" }));
    expect(within(within(panel).getByRole("list", { name: "Comandos" })).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("ExamRoom, SPEC-092 revision 3 the tabs of the panel (CA-16)", () => {
  it("has the tabs Aluno and Pedidos de ajuda, a new request only changes the count, and opening a student shows Aluno", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    receive("room:student", doing());
    const student = screen.getByRole("tab", { name: "Aluno" });
    expect(student.getAttribute("aria-selected")).toBe("true");
    receive("help:queue", { queue: [{ id: "h-1", studentId: ANA, position: 2, question: "Posso?", status: "OPEN", createdAt: "2026-10-21T09:31:00-03:00" }] });
    const help = screen.getByRole("tab", { name: "Pedidos de ajuda (1)" });
    expect(student.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("region", { name: "Pedidos de ajuda" })).toBeNull();

    fireEvent.click(help);
    expect(help.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Posso?");
    fireEvent.click(screen.getByRole("button", { name: /Ana · Questão 2/ }));
    expect(screen.getByRole("tab", { name: "Aluno" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("region", { name: "Ana" })).toBeDefined();
  });

  it("moves between the tabs with the arrows", async () => {
    await setup({ startedAt: "2026-10-21T09:05:00-03:00" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Aluno" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Pedidos de ajuda (0)" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Pedidos de ajuda (0)" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Aluno" }).getAttribute("aria-selected")).toBe("true");
  });
});
