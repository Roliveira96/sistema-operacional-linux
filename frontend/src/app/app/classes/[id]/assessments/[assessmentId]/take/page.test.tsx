import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { assessmentService, type RoomHandlers } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { publicOf, studentAttempt } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import TakePage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
vi.mock("@/components/RichTextEditor/RichTextEditor", () => ({ RichTextEditor: () => <textarea aria-label="Sua resposta" /> }));

function asRole(role: "TEACHER" | "STUDENT") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}
const params = Promise.resolve({ id: "c-1", assessmentId: "a-1" });

let terminal: ReturnType<typeof terminalMount>;
/** The connections to the room, in order, with what each one sent; by default the room falls at once, and the page enters the exam anyway. */
let rooms: { handlers: RoomHandlers; sent: { type: string; data: unknown }[] }[] = [];
let roomOpens = false;
beforeEach(() => {
  terminal = terminalMount();
  mount.mockImplementation(terminal.mount);
  vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf());
  rooms = [];
  roomOpens = false;
  vi.spyOn(assessmentService, "openRoom").mockImplementation((_c, _a, handlers) => {
    const room = { handlers, sent: [] as { type: string; data: unknown }[] };
    rooms.push(room);
    queueMicrotask(() => (roomOpens ? handlers.onOpen() : handlers.onClose()));
    return { send: (type, data) => void room.sent.push({ type, data }), close: vi.fn() };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

// SPEC-090 CA-01, CA-12 to CA-14: the window of the exam enters the attempt and shows it to the student.
describe("take page", () => {
  it("enters the exam and shows the questions", async () => {
    asRole("STUDENT");
    const enter = vi.spyOn(assessmentService, "enterAttempt").mockResolvedValue(studentAttempt());
    render(<TakePage params={params} />);
    expect(await screen.findByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
    expect(enter).toHaveBeenCalledWith("c-1", "a-1");
    expect(screen.getByText("Prova 1: permissões")).toBeDefined();
  });

  it("says why the exam cannot be entered", async () => {
    asRole("STUDENT");
    vi.spyOn(assessmentService, "enterAttempt").mockRejectedValue(problem("assessment-not-started", 409));
    render(<TakePage params={params} />);
    expect((await screen.findByRole("alert")).textContent).toBe("A docente ainda não iniciou a prova.");
  });

  it("says the exam was delivered when the attempt is closed", async () => {
    asRole("STUDENT");
    vi.spyOn(assessmentService, "enterAttempt").mockRejectedValue(problem("attempt-already-submitted", 409));
    render(<TakePage params={params} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Você já entregou esta prova.");
  });

  it("sends the teacher back to the assessment", async () => {
    asRole("TEACHER");
    render(<TakePage params={params} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/classes/c-1/assessments/a-1"));
  });
});

const last = () => rooms[rooms.length - 1]!;
const receive = (type: string, data: unknown) => act(() => last().handlers.onMessage({ type, data }));

// SPEC-091 CA-14 (RN-02, D-04): before the start the student waits in the room, and enters the exam alone when the teacher starts.
describe("take page, the waiting room", () => {
  it("waits in the room, says the teacher may see the screen, and enters when admitted", async () => {
    asRole("STUDENT");
    roomOpens = true;
    const enter = vi.spyOn(assessmentService, "enterAttempt").mockResolvedValue(studentAttempt());
    render(<TakePage params={params} />);
    await waitFor(() => expect(rooms).toHaveLength(1));
    receive("room:snapshot", { waiting: true, help: { status: "NONE" } });
    expect(await screen.findByText("Você está na sala de espera. A prova começa quando a docente iniciar.")).toBeDefined();
    expect(screen.getByText("Durante a prova, a docente pode ver a sua tela, os comandos que você executa e as suas respostas.")).toBeDefined();
    expect(enter).not.toHaveBeenCalled();
    receive("room:admitted", {});
    expect(await screen.findByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
    expect(enter).toHaveBeenCalledTimes(1);
  });
});

async function inTheExam() {
  asRole("STUDENT");
  roomOpens = true;
  vi.spyOn(assessmentService, "enterAttempt").mockResolvedValue(studentAttempt());
  render(<TakePage params={params} />);
  await waitFor(() => expect(rooms).toHaveLength(1));
  receive("room:snapshot", { waiting: false, help: { status: "NONE" } });
  await screen.findByRole("heading", { name: "Questão 1 de 5" });
}

// SPEC-091 CA-14 (RN-07, D-03): the student asks for help, can cancel it, and reads the answer of the teacher.
describe("take page, the help", () => {
  it("raises the hand with the question, cancels it, and reads the answer", async () => {
    await inTheExam();
    fireEvent.click(screen.getByRole("button", { name: "Pedir ajuda" }));
    fireEvent.change(screen.getByLabelText("Sua dúvida (opcional)"), { target: { value: "Posso usar o manual?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect(last().sent).toContainEqual({ type: "help:raise", data: { position: 1, question: "Posso usar o manual?" } });
    receive("help:state", { status: "OPEN" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar o pedido" }));
    expect(last().sent).toContainEqual({ type: "help:lower", data: {} });
    receive("help:state", { status: "ANSWERED", answer: "Não, só o terminal." });
    expect(screen.getByText("A docente viu o seu pedido.")).toBeDefined();
    expect(screen.getByText("Não, só o terminal.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pedir ajuda" })).toBeDefined();
  });
});

// SPEC-091 CA-14 (RN-08): the exam ended by the teacher locks, with the reason.
describe("take page, ended by the teacher", () => {
  it("locks the exam and says why", async () => {
    await inTheExam();
    receive("room:ended", { reason: "Flagrante de cola" });
    expect(screen.getByText("Sua prova foi encerrada pela docente.")).toBeDefined();
    expect(screen.getByText("Flagrante de cola")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Questão 1 de 5" })).toBeNull();
  });
});

// SPEC-091 CA-05, CA-06 (RN-05, RN-06, D-05): the commands go to the room as they run; the screen only while the teacher watches; the commands of a
// fall are sent again, with their instant, when the room is back.
describe("take page, what the teacher follows", () => {
  it("sends the commands, and the screen only while watched", async () => {
    await inTheExam();
    fireEvent.click(screen.getByRole("button", { name: /^Questão 4,/ }));
    await waitFor(() => expect(terminal.callbacks).toHaveLength(1));
    const callbacks = terminal.callbacks[0] as unknown as { onCommandRun(run: unknown): void; onScreen(tree: unknown): void };
    act(() => callbacks.onCommandRun({ terminal: 1, command: "mkdir /a", exitStatus: 0, output: "" }));
    expect(last().sent).toContainEqual({ type: "room:command", data: { position: 4, command: "mkdir /a", output: "" } });

    act(() => callbacks.onScreen({ tag: "div", children: ["$ ls"] }));
    expect(last().sent.some((m) => m.type === "room:screen")).toBe(false);
    receive("room:watch-on", {});
    act(() => callbacks.onScreen({ tag: "div", children: ["$ pwd"] }));
    expect(last().sent).toContainEqual({ type: "room:screen", data: { position: 4, title: "Criar pasta", screen: { tag: "div", children: ["$ pwd"] } } });
    receive("room:watch-off", {});
    const before = last().sent.length;
    act(() => callbacks.onScreen({ tag: "div", children: ["$ ls -l"] }));
    expect(last().sent).toHaveLength(before);
  });

  it("keeps the commands of a fall and sends them again with their instant", async () => {
    await inTheExam();
    fireEvent.click(screen.getByRole("button", { name: /^Questão 4,/ }));
    await waitFor(() => expect(terminal.callbacks).toHaveLength(1));
    const callbacks = terminal.callbacks[0] as unknown as { onCommandRun(run: unknown): void };
    act(() => last().handlers.onClose());
    act(() => callbacks.onCommandRun({ terminal: 1, command: "ls", exitStatus: 0, output: "a" }));
    await waitFor(() => expect(rooms).toHaveLength(2), { timeout: 4000 });
    await waitFor(() => expect(last().sent.find((m) => m.type === "room:command")).toBeDefined());
    const resent = last().sent.find((m) => m.type === "room:command")!.data as { command: string; at?: string };
    expect(resent.command).toBe("ls");
    expect(resent.at).toEqual(expect.any(String));
  }, 8000);
});

// SPEC-092 CA-11 (revision 2): the room hears the question the student is in, on entering, on changing it, and again when the room comes back.
describe("take page, the question the student is in", () => {
  it("tells the room the question at the start, on each change and after a fall", async () => {
    await inTheExam();
    await waitFor(() => expect(last().sent).toContainEqual({ type: "room:question", data: { position: 1, title: "Apagar pasta" } }));
    fireEvent.click(screen.getByRole("button", { name: /^Questão 4,/ }));
    await waitFor(() => expect(last().sent).toContainEqual({ type: "room:question", data: { position: 4, title: "Criar pasta" } }));
    act(() => last().handlers.onClose());
    await waitFor(() => expect(rooms).toHaveLength(2), { timeout: 4000 });
    await waitFor(() => expect(last().sent).toContainEqual({ type: "room:question", data: { position: 4, title: "Criar pasta" } }));
  }, 8000);
});

// SPEC-093 CA-08: the student writes to the teacher in the conversation of the exam, reads her messages and knows it is kept with the exam.
describe("take page, SPEC-093 the conversation", () => {
  const AT = "2026-10-21T09:31:00-03:00";

  it("opens the conversation with what was said, sends to the teacher and shows what comes back", async () => {
    await inTheExam();
    receive("room:snapshot", { waiting: false, help: { status: "NONE" }, chat: [{ id: "m-1", scope: "all", from: "TEACHER", text: "Bom dia", createdAt: AT }] });
    const button = screen.getByRole("button", { name: "Conversa" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Bom dia")).toBeDefined();
    expect(screen.getByText("Docente · para todos")).toBeDefined();
    expect(screen.getByText("A conversa fica guardada com a sua prova, e a docente pode usá-la na avaliação.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Posso usar o man?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(last().sent).toContainEqual({ type: "chat:send", data: { text: "Posso usar o man?" } });
    receive("chat:message", { id: "m-2", scope: "private", studentId: "u-1", from: "STUDENT", text: "Posso usar o man?", createdAt: AT });
    expect(screen.getByText("Posso usar o man?")).toBeDefined();
    receive("chat:message", { id: "m-2", scope: "private", studentId: "u-1", from: "STUDENT", text: "Posso usar o man?", createdAt: AT });
    expect(screen.getAllByText("Posso usar o man?")).toHaveLength(1);
  });

  it("counts the new messages of the teacher while it is closed", async () => {
    await inTheExam();
    receive("chat:message", { id: "m-3", scope: "private", studentId: "u-1", from: "TEACHER", text: "Pode", createdAt: AT });
    receive("chat:message", { id: "m-4", scope: "all", from: "TEACHER", text: "Atenção", createdAt: AT });
    const button = screen.getByRole("button", { name: "Conversa, 2 novas" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Conversa" })).toBeDefined();
    expect(screen.getByText("Docente · só para você")).toBeDefined();
  });

  it("says what to do when it is empty, and turns sending off without the room", async () => {
    await inTheExam();
    fireEvent.click(screen.getByRole("button", { name: "Conversa" }));
    expect(screen.getByText("Escreva para a docente. As mensagens dela para a turma também aparecem aqui.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Oi" } });
    act(() => last().handlers.onClose());
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// SPEC-094: the general instructions within reach during the exam and in the waiting room.
describe("take page, SPEC-094 the general instructions", () => {
  it("has the button Instruções only when the exam has instructions (CA-01)", async () => {
    await inTheExam();
    expect(screen.getByRole("button", { name: "Instruções" }).getAttribute("aria-expanded")).toBe("false");
    cleanup();
    rooms = []; // the second window has a room of its own, not the one of the first
    vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf({ description: "<p></p>" }));
    await inTheExam();
    expect(screen.queryByRole("button", { name: "Instruções" })).toBeNull();
  });

  it("opens the instructions beside the question and closes them by the button, Fechar and Esc (CA-02, CA-04)", async () => {
    vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf({ description: "<ul><li>Use <code>ls -l</code></li></ul>" }));
    await inTheExam();
    const mounts = mount.mock.calls.length;
    const button = await screen.findByRole("button", { name: "Instruções" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const column = screen.getByRole("region", { name: "Instruções gerais" });
    expect(column.querySelector("code")?.textContent).toBe("ls -l");
    expect(screen.getByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
    expect(mount.mock.calls.length).toBe(mounts);
    fireEvent.click(button);
    expect(screen.queryByRole("region", { name: "Instruções gerais" })).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("region", { name: "Instruções gerais" })).toBeNull();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("region", { name: "Instruções gerais" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Instruções gerais" })).toBeNull();
  });

  it("keeps one column open at a time (CA-03)", async () => {
    await inTheExam();
    const instructions = await screen.findByRole("button", { name: "Instruções" });
    const chat = screen.getByRole("button", { name: "Conversa" });
    fireEvent.click(chat);
    fireEvent.click(instructions);
    expect(chat.getAttribute("aria-expanded")).toBe("false");
    expect(instructions.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chat);
    expect(instructions.getAttribute("aria-expanded")).toBe("false");
    expect(chat.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the instructions in the waiting room (CA-05)", async () => {
    asRole("STUDENT");
    roomOpens = true;
    render(<TakePage params={params} />);
    await waitFor(() => expect(rooms).toHaveLength(1));
    receive("room:snapshot", { waiting: true, help: { status: "NONE" } });
    expect(await screen.findByRole("heading", { name: "Instruções gerais" })).toBeDefined();
    expect(screen.getByText("Traga o documento com foto.")).toBeDefined();
  });
});

// SPEC-096 CA-08: after the start the student asks to enter and waits for the teacher; the exam finished by the teacher locks the window.
describe("take page, SPEC-096 the admission and the finish", () => {
  it("says the request was sent after the start, also when the start comes while waiting", async () => {
    asRole("STUDENT");
    roomOpens = true;
    vi.spyOn(assessmentService, "enterAttempt").mockResolvedValue(studentAttempt());
    render(<TakePage params={params} />);
    await waitFor(() => expect(rooms).toHaveLength(1));
    receive("room:snapshot", { waiting: true, started: false, help: { status: "NONE" } });
    expect(await screen.findByText("Você está na sala de espera. A prova começa quando a docente iniciar.")).toBeDefined();
    receive("room:started", { startedAt: "2026-10-21T09:05:00-03:00", startedByName: "Profa. Sediane" });
    expect(screen.getByText("Pedido de entrada enviado. Aguarde a docente admitir você.")).toBeDefined();
    receive("room:admitted", {});
    expect(await screen.findByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
  });

  it("asks to enter at once when it comes after the start", async () => {
    asRole("STUDENT");
    roomOpens = true;
    render(<TakePage params={params} />);
    await waitFor(() => expect(rooms).toHaveLength(1));
    receive("room:snapshot", { waiting: true, started: true, help: { status: "NONE" } });
    expect(await screen.findByText("Pedido de entrada enviado. Aguarde a docente admitir você.")).toBeDefined();
  });

  it("locks when the teacher finishes the exam", async () => {
    await inTheExam();
    receive("room:ended", { reason: "A docente finalizou a prova.", finished: true });
    expect(screen.getByText("A docente finalizou a prova. Sua prova foi entregue com o que você fez.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Questão 1 de 5" })).toBeNull();
  });

  it("says why it cannot enter without the admission or after the finish", async () => {
    asRole("STUDENT");
    vi.spyOn(assessmentService, "enterAttempt").mockRejectedValue(problem("attempt-not-admitted", 409));
    render(<TakePage params={params} />);
    expect(await screen.findByText("Aguarde a docente admitir você para começar.")).toBeDefined();
  });
});
