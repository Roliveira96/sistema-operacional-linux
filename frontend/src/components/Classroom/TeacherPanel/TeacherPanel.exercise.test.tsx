import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type AdmissionEntry, type ExerciseProgressEntry, type LiveExercise, type LiveModuleContent, type LiveSession } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { TeacherPanel } from "./TeacherPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("@/services/moduleService", () => ({ moduleService: { listModules: vi.fn() } }));
vi.mock("../SlideThumbnails/SlideThumbnails", async () => {
  const React = await import("react");
  return { SlideThumbnails: () => React.createElement("div", { "data-testid": "thumbs" }) };
});
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

const START = "2026-10-14T10:00:00Z";
const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "MODULE", currentSlide: 1, startedAt: START };

const ana: AdmissionEntry = { studentId: "u-1", name: "Ana Souza" };
const bruno: AdmissionEntry = { studentId: "u-2", name: "Bruno Lima" };

const condition = { kind: "FILE_EXISTS", path: "/home/a" };
const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: {},
  blocks: [
    { id: "b-2", type: "EXERCISES", position: 2, payload: { items: [{ title: "Mudar permissões", difficulty: "HARD", conditions: [condition, condition], hints: [{ text: "Use o chmod", command: "chmod 644 a" }, { text: "Veja o ls -l" }] }, { title: "Sem fim", difficulty: "EASY" }] } },
    { id: "b-1", type: "TEXT", position: 1, payload: { html: "Primeiro" } },
  ],
};

const running = (over: Partial<LiveExercise> = {}): LiveExercise => ({
  runId: "r-1",
  blockId: "b-2",
  index: 0,
  title: "Mudar permissões",
  difficulty: "HARD",
  durationSeconds: 300,
  startedAt: START,
  endsAt: "2026-10-14T10:05:00Z",
  status: "RUNNING",
  resultVisible: false,
  skewMs: 0,
  ...over,
});
const entry = (studentId: string, over: Partial<ExerciseProgressEntry> = {}): ExerciseProgressEntry => ({ studentId, met: 1, total: 2, last: "ls", at: START, ...over });

function live(over: Record<string, unknown> = {}, room: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, deck: null, strokes: [], cursor: null, online: 2, blank: false, ...room },
    admissions: { waiting: [], admitted: [ana, bruno] },
    onlineStudents: ["u-1", "u-2"],
    hands: [],
    chat: [],
    startedAt: START,
    presenterConnected: true,
    fullscreenRequested: false,
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    exercise: null,
    exerciseProgress: {},
    watchedScreen: null,
    watching: null,
    changeSlide: vi.fn(), switchMode: vi.fn(), moderate: vi.fn(), acceptStudent: vi.fn(), acceptAll: vi.fn(), removeStudent: vi.fn(), focusBlock: vi.fn(),
    sendStageFullscreen: vi.fn(),
    sendChat: vi.fn(() => true),
    startExercise: vi.fn(), endExercise: vi.fn(), revealExercise: vi.fn(), watchStudent: vi.fn(),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value;
}

const element = () => <TeacherPanel classId="c-1" session={session} beep={vi.fn()} />;
const panel = () => render(element());
const flush = () => act(async () => void (await Promise.resolve()));
const board = () => within(screen.getByRole("region", { name: "Exercício ao vivo" }));
const conversation = () => within(screen.getByRole("heading", { level: 2, name: "Conversa" }).closest("section")!);
const card = (name: string) => within(board().getByText(name).closest("li")!);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(START));
  vi.mocked(moduleService.listModules).mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 } as never);
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-065 3.3: the section "Exercício ao vivo", in the main column
describe("TeacherPanel, the live exercise: where it is and what it lists", () => {
  it("is in the main column, after the online students and before the control of the class", async () => {
    live();
    panel();
    await flush();
    const online = screen.getByRole("region", { name: "Alunos online" });
    const section = screen.getByRole("region", { name: "Exercício ao vivo" });
    const stage = screen.getByRole("region", { name: "Controle da aula" });
    expect(online.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.parentElement).toBe(online.parentElement);
    expect(screen.getByRole("complementary").contains(section)).toBe(false);
  });

  it("lists the practical exercises of the blocks of the module, in the order of the blocks", async () => {
    live();
    panel();
    await flush();
    const items = board().getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Bloco 2 · Exercício 1")).toBeDefined();
    expect(within(items[0]!).getByText("Mudar permissões")).toBeDefined();
    expect(within(items[0]!).getByText("Nível difícil")).toBeDefined();
    expect(within(items[1]!).getByText("Sem condições de finalização")).toBeDefined();
  });

  it("starts the exercise of the row for the minutes of the field", async () => {
    const l = live();
    panel();
    await flush();
    const row = within(board().getByText("Mudar permissões").closest("li")!);
    fireEvent.click(row.getByRole("button", { name: /^Iniciar exercício/ }));
    expect(l.startExercise).toHaveBeenLastCalledWith("b-2", 0, 5);
    fireEvent.change(row.getByRole("spinbutton", { name: /^Minutos/ }), { target: { value: "2" } });
    fireEvent.click(row.getByRole("button", { name: /^Iniciar exercício/ }));
    expect(l.startExercise).toHaveBeenLastCalledWith("b-2", 0, 2);
  });

  it("has the start off when this panel cannot control the class", async () => {
    live({ canControl: false });
    panel();
    await flush();
    expect((board().getAllByRole("button", { name: /^Iniciar exercício/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no section with no module in the room, as on the slides of a class with only a presentation", async () => {
    live({}, { mode: "SLIDES", moduleId: null });
    panel();
    await flush();
    expect(screen.queryByRole("region", { name: "Exercício ao vivo" })).toBeNull();
  });

  it("has the section on the slides when the class has a module, where the exercises are", async () => {
    live({}, { mode: "SLIDES" });
    panel();
    await flush();
    expect(board().getAllByRole("listitem")).toHaveLength(2);
  });

  it("says the module has no practical exercises", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue({ ...module_, blocks: [module_.blocks[1]!] });
    live();
    panel();
    await flush();
    expect(board().getByText("Este módulo não tem exercícios práticos.")).toBeDefined();
  });

  it("has no list until the module is read", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockReturnValue(new Promise(() => undefined));
    live();
    panel();
    await flush();
    expect(screen.queryByRole("region", { name: "Exercício ao vivo" })).toBeNull();
  });

  it("lists only the exercises of the module the room is in, not the ones of the module read before", async () => {
    live({}, { moduleId: "m-1" });
    const view = panel();
    await flush();
    expect(board().getAllByRole("listitem")).toHaveLength(2);
    live({}, { moduleId: "m-2" });
    vi.spyOn(classroomService, "getLiveModule").mockReturnValue(new Promise(() => undefined));
    view.rerender(element());
    expect(screen.queryByRole("region", { name: "Exercício ao vivo" })).toBeNull();
  });

  it("asks for the module once more when the room changes it", async () => {
    live({}, { moduleId: "m-1" });
    const view = panel();
    await flush();
    live({}, { moduleId: "m-2" });
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue({ ...module_, moduleId: "m-2", blocks: [] });
    view.rerender(element());
    await flush();
    expect(board().getByText("Este módulo não tem exercícios práticos.")).toBeDefined();
  });
});

// SPEC-065 CA-06, CA-07: the cards, the terminal of a student, the end
describe("TeacherPanel, the live exercise: the round", () => {
  it("shows the round with its clock and a card for each student who is online, with his progress", async () => {
    live({ exercise: running(), exerciseProgress: { "u-1": entry("u-1", { met: 1, total: 2, last: "ls -l" }) } });
    panel();
    await flush();
    expect(board().getByRole("heading", { level: 3, name: "Mudar permissões" })).toBeDefined();
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("05:00");
    expect(board().getByText("0 de 2 concluíram")).toBeDefined();
    expect(card("Ana Souza").getByText("Fazendo")).toBeDefined();
    expect(card("Ana Souza").getByText("1 de 2 condições")).toBeDefined();
    expect(card("Ana Souza").getByText("ls -l")).toBeDefined();
    expect(card("Bruno Lima").getByText("Ainda sem andamento.")).toBeDefined();
    expect(board().queryByRole("button", { name: /^Iniciar exercício/ })).toBeNull();
  });

  it("has a card only for the students who are accepted and online", async () => {
    live({ exercise: running(), onlineStudents: ["u-2", "u-9"] });
    panel();
    await flush();
    expect(board().queryByText("Ana Souza")).toBeNull();
    expect(board().getByText("Bruno Lima")).toBeDefined();
  });

  it("goes by the clock, so a student with no progress gets to 'Sem sinal'", async () => {
    live({ exercise: running() });
    panel();
    await flush();
    act(() => void vi.advanceTimersByTime(16_000));
    expect(card("Ana Souza").getByText("Sem sinal")).toBeDefined();
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("04:44");
  });

  it("watches the terminal of a student with 'Ver terminal', and stops with the same button", async () => {
    const l = live({ exercise: running() });
    const view = panel();
    await flush();
    fireEvent.click(card("Ana Souza").getByRole("button", { name: "Ver terminal de Ana Souza" }));
    expect(l.watchStudent).toHaveBeenCalledWith("u-1");
    live({ exercise: running(), watching: "u-1", watchStudent: l.watchStudent });
    view.rerender(element());
    expect(card("Ana Souza").getByRole("button", { name: "Ver terminal de Ana Souza" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(card("Ana Souza").getByRole("button", { name: "Ver terminal de Ana Souza" }));
    expect(l.watchStudent).toHaveBeenLastCalledWith(null);
  });

  it("shows the terminal of the student watched as the picture comes, and stops with 'Parar de ver'", async () => {
    const l = live({ exercise: running(), watching: "u-1" });
    const view = panel();
    await flush();
    const terminal = () => within(screen.getByRole("region", { name: "Terminal de Ana Souza" }));
    expect(terminal().getByText("Carregando o terminal…")).toBeDefined();
    const picture = { tag: "div", attrs: { class: "janela" }, children: [{ tag: "div", attrs: { class: "term-linha" }, children: ["whoami"] }] };
    live({ exercise: running(), watching: "u-1", watchedScreen: { studentId: "u-1", screen: picture }, watchStudent: l.watchStudent });
    view.rerender(element());
    expect(screen.getByTestId("terminal-mirror").querySelector(".term-linha")!.textContent).toBe("whoami");
    fireEvent.click(terminal().getByRole("button", { name: "Parar de ver" }));
    expect(l.watchStudent).toHaveBeenCalledWith(null);
  });

  it("ends the round with 'Encerrar agora'", async () => {
    const l = live({ exercise: running() });
    panel();
    await flush();
    fireEvent.click(board().getByRole("button", { name: "Encerrar agora" }));
    expect(l.endExercise).toHaveBeenCalledTimes(1);
  });

  it("tells the teacher that the class is on the slides while the students are in the exercise", async () => {
    live({ exercise: running() }, { mode: "SLIDES" });
    panel();
    await flush();
    expect(board().getByText("A aula está nas lâminas, mas os alunos continuam no exercício até o fim.")).toBeDefined();
  });

  it("does not tell it while the class is on the module", async () => {
    live({ exercise: running() });
    panel();
    await flush();
    expect(board().queryByText("A aula está nas lâminas, mas os alunos continuam no exercício até o fim.")).toBeNull();
  });
});

// SPEC-065 CA-08: the tips go by the chat
describe("TeacherPanel, the live exercise: the tips", () => {
  it("opens the private conversation of the student with 'Enviar dica', with the tips as suggestions", async () => {
    live({ exercise: running() });
    panel();
    await flush();
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
    fireEvent.click(card("Bruno Lima").getByRole("button", { name: "Enviar dica para Bruno Lima" }));
    expect(conversation().getByRole("heading", { level: 3, name: "Conversa com Bruno Lima" })).toBeDefined();
    const tips = within(screen.getByRole("group", { name: "Dicas do exercício" }));
    expect(tips.getAllByRole("listitem")).toHaveLength(2);
    expect(tips.getByRole("button", { name: "Usar dica 1" })).toBeDefined();
  });

  it("fills the field with the tip and sends it in private to the student", async () => {
    const l = live({ exercise: running() });
    panel();
    await flush();
    fireEvent.click(card("Ana Souza").getByRole("button", { name: "Enviar dica para Ana Souza" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar dica 1" }));
    const field = screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;
    expect(field.value).toBe("Dica: Use o chmod\nComando: chmod 644 a");
    fireEvent.click(screen.getByRole("button", { name: "Enviar só para Ana Souza" }));
    expect(l.sendChat).toHaveBeenCalledWith("Dica: Use o chmod\nComando: chmod 644 a", { studentId: "u-1" });
  });

  it("sends a tip of the list to everybody, by the chat, with its text and its command", async () => {
    const l = live({ exercise: running() });
    panel();
    await flush();
    fireEvent.click(board().getByRole("button", { name: "Enviar para todos: dica 1" }));
    expect(l.sendChat).toHaveBeenCalledTimes(1);
    expect(l.sendChat).toHaveBeenCalledWith("Dica: Use o chmod\nComando: chmod 644 a", "all");
    expect(board().getByText("Dica enviada para todos os alunos.")).toBeDefined();
    fireEvent.click(board().getByRole("button", { name: "Enviar para todos: dica 2" }));
    expect(l.sendChat).toHaveBeenLastCalledWith("Dica: Veja o ls -l", "all");
  });

  it("says when the tip did not go", async () => {
    live({ exercise: running(), sendChat: vi.fn(() => false) });
    panel();
    await flush();
    fireEvent.click(board().getByRole("button", { name: "Enviar para todos: dica 1" }));
    expect(board().getByText("Não foi possível enviar a dica. Confira a conexão.")).toBeDefined();
  });

  it("has no suggestions in the conversation when the round is over, nor when there is none", async () => {
    const l = live({ exercise: running({ status: "ENDED", endedBy: "TEACHER" }) });
    const view = panel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Conversar com Ana Souza" }));
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
    live({ exercise: null, sendChat: l.sendChat });
    view.rerender(element());
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
  });

  it("has no suggestions of the tips of another exercise: a round of an exercise with no tips gives none", async () => {
    live({ exercise: running({ blockId: "b-2", index: 1, title: "Sem fim", difficulty: "EASY" }) });
    panel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Conversar com Ana Souza" }));
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
  });
});

// SPEC-065 CA-10: when it ends, the summary and the result
describe("TeacherPanel, the live exercise: the end", () => {
  const over = { exercise: running({ status: "ENDED", endedBy: "TIMER" }), exerciseProgress: { "u-1": entry("u-1", { met: 2, completedAt: "2026-10-14T10:03:25Z", elapsedSeconds: 205, points: 36, attempts: 2 }) } };

  it("shows the summary of the round: who finished, with time and points, and how many did not", async () => {
    live(over);
    panel();
    await flush();
    expect(board().getByRole("heading", { level: 3, name: "Exercício encerrado" })).toBeDefined();
    expect(board().getByText("O tempo acabou.")).toBeDefined();
    const done = within(board().getByRole("list", { name: "Quem concluiu" }));
    expect(done.getByText("Ana Souza")).toBeDefined();
    expect(done.getByText("03:25")).toBeDefined();
    expect(done.getByText("+36 pontos")).toBeDefined();
    expect(board().getByText("1 aluno não concluiu.")).toBeDefined();
  });

  it("shows and hides the result to the students, as the room tells it", async () => {
    const l = live(over);
    const view = panel();
    await flush();
    fireEvent.click(board().getByRole("button", { name: "Mostrar resultado aos alunos" }));
    expect(l.revealExercise).toHaveBeenCalledWith(true);
    live({ ...over, exercise: running({ status: "ENDED", endedBy: "TIMER", resultVisible: true }), revealExercise: l.revealExercise });
    view.rerender(element());
    fireEvent.click(board().getByRole("button", { name: "Ocultar resultado" }));
    expect(l.revealExercise).toHaveBeenLastCalledWith(false);
  });

  it("goes back to the list with 'Nova rodada', and starts another exercise from it", async () => {
    const l = live({ ...over, exercise: running({ status: "CLOSED", endedBy: "TIMER", closedAt: "2026-10-14T10:06:00Z" }) }); // SPEC-071: after going back to the lesson
    panel();
    await flush();
    fireEvent.click(board().getByRole("button", { name: "Nova rodada" }));
    expect(board().queryByText("Exercício encerrado")).toBeNull();
    fireEvent.click(board().getAllByRole("button", { name: /^Iniciar exercício/ })[0]!);
    expect(l.startExercise).toHaveBeenCalledWith("b-2", 0, 5);
  });
});
