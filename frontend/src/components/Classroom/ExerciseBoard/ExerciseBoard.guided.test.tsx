import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionEntry, ExerciseProgressEntry, LiveChatMessage, LiveExercise } from "@/services/classroomService";
import { ExerciseBoard, type ExerciseBoardProps } from "./ExerciseBoard";
import type { BoardExercise } from "./exercises";

// SPEC-071: the panel of the guided practice

vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

const people: AdmissionEntry[] = [
  { studentId: "u-1", name: "Ana Souza" },
  { studentId: "u-2", name: "Bruno Lima" },
  { studentId: "u-3", name: "Carla Dias" },
  { studentId: "u-4", name: "Davi Reis" },
  { studentId: "u-5", name: "Eva Mota" },
];
const exercises: BoardExercise[] = [{ blockId: "b-1", blockNumber: 1, index: 0, title: "Listar arquivos", difficulty: "EASY", conditions: 2, hints: [] }];
const START = "2026-10-14T10:00:00Z";

const round = (over: Partial<LiveExercise> = {}): LiveExercise => ({
  runId: "r-1",
  blockId: "b-1",
  index: 0,
  title: "Listar arquivos",
  difficulty: "EASY",
  durationSeconds: 300,
  startedAt: START,
  endsAt: "2026-10-14T10:05:00Z",
  status: "RUNNING",
  resultVisible: false,
  skewMs: 0,
  ...over,
});
const entry = (studentId: string, over: Partial<ExerciseProgressEntry> = {}): ExerciseProgressEntry => ({ studentId, met: 0, total: 2, last: "", at: START, commands: 0, lastCommandAt: START, ...over });

const props = (over: Partial<ExerciseBoardProps> = {}): ExerciseBoardProps => ({
  exercise: round(),
  exercises,
  admitted: people,
  online: people.map((p) => p.studentId),
  progress: {},
  watching: null,
  watchedScreen: null,
  canControl: true,
  takeover: null,
  hands: [],
  chat: [],
  connected: true,
  onStart: vi.fn(),
  onEnd: vi.fn(),
  onReveal: vi.fn(),
  onWatch: vi.fn(),
  onTip: vi.fn(),
  onSendTip: vi.fn(() => true),
  onPause: vi.fn(),
  onExtend: vi.fn(),
  onClose: vi.fn(),
  onTakeover: vi.fn(),
  onKey: vi.fn(),
  onPaste: vi.fn(),
  onSendChat: vi.fn(() => true),
  ...over,
});

const mount = (over: Partial<ExerciseBoardProps> = {}) => {
  let p = props(over);
  const view = render(<ExerciseBoard {...p} />);
  return {
    p,
    again: (next: Partial<ExerciseBoardProps>) => {
      p = { ...p, ...next };
      view.rerender(<ExerciseBoard {...p} />);
    },
  };
};

const board = () => within(screen.getByRole("region", { name: "Exercício ao vivo" }));
const card = (name: string) => within(board().getAllByTestId("exercise-student-name").find((n) => n.textContent === name)!.closest("li")!);
const names = () => board().queryAllByTestId("exercise-student-name").map((node) => node.textContent);
const tabs = () => within(board().getByRole("tablist", { name: "Atendimentos" }));
const open = (name: string) => fireEvent.click(card(name).getByRole("button", { name: `Atender ${name}` }));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(START));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ExerciseBoard, the controls of the round (SPEC-071 CA-01, CA-02)", () => {
  it("pauses and resumes, and the clock says it is paused", () => {
    const { p, again } = mount();
    fireEvent.click(board().getByRole("button", { name: "Pausar" }));
    expect(p.onPause).toHaveBeenCalledWith(true);
    again({ exercise: round({ status: "PAUSED" }) });
    expect(board().getByRole("timer", { name: "Tempo restante" }).textContent).toBe("Pausado");
    fireEvent.click(board().getByRole("button", { name: "Retomar" }));
    expect(p.onPause).toHaveBeenLastCalledWith(false);
  });

  it("gives more minutes, 2 by default, brought to 1 to 30", () => {
    const { p } = mount();
    const field = board().getByRole("spinbutton", { name: "Minutos a mais" });
    expect((field as HTMLInputElement).value).toBe("2");
    fireEvent.click(board().getByRole("button", { name: "+ minutos" }));
    expect(p.onExtend).toHaveBeenLastCalledWith(2);
    fireEvent.change(field, { target: { value: "45" } });
    fireEvent.blur(field);
    fireEvent.click(board().getByRole("button", { name: "+ minutos" }));
    expect(p.onExtend).toHaveBeenLastCalledWith(30);
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);
    fireEvent.click(board().getByRole("button", { name: "+ minutos" }));
    expect(p.onExtend).toHaveBeenLastCalledWith(1);
  });

  it("gives more minutes to the round that ended, and has no 'Nova rodada' before going back to the lesson", () => {
    const { p } = mount({ exercise: round({ status: "ENDED", endedBy: "TIMER", endedAt: "2026-10-14T10:05:00Z" }) });
    fireEvent.click(board().getByRole("button", { name: "+ minutos" }));
    expect(p.onExtend).toHaveBeenCalledWith(2);
    expect(board().queryByRole("button", { name: "Nova rodada" })).toBeNull();
    expect(board().getByRole("button", { name: "Voltar para a aula" })).toBeDefined();
  });

  it("has 'Nova rodada' and no more minutes after going back to the lesson", () => {
    mount({ exercise: round({ status: "CLOSED", endedBy: "TEACHER", endedAt: "2026-10-14T10:02:00Z", closedAt: "2026-10-14T10:02:00Z" }) });
    expect(board().getByRole("button", { name: "Nova rodada" })).toBeDefined();
    expect(board().queryByRole("button", { name: "+ minutos" })).toBeNull();
    expect(board().queryByRole("button", { name: "Voltar para a aula" })).toBeNull();
  });
});

describe("ExerciseBoard, going back to the lesson (SPEC-071 CA-05)", () => {
  it("warns that the clock did not end and how many did not finish, and goes back only when confirmed", () => {
    vi.setSystemTime(new Date("2026-10-14T10:03:30Z"));
    const { p } = mount({ online: ["u-1", "u-2"], progress: { "u-1": entry("u-1", { completedAt: "2026-10-14T10:02:00Z", elapsedSeconds: 120, points: 12 }), "u-2": entry("u-2") } });
    fireEvent.click(board().getByRole("button", { name: "Voltar para a aula" }));
    const dialog = within(screen.getByRole("dialog", { name: "Voltar para a aula" }));
    expect(dialog.getByText("O cronômetro ainda não terminou (faltam 01:30).")).toBeDefined();
    expect(dialog.getByText("1 aluno não finalizou.")).toBeDefined();
    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(board().getByRole("button", { name: "Voltar para a aula" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Voltar para a aula" })).getByRole("button", { name: "Voltar para a aula" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("warns only of who did not finish when the round ended", () => {
    mount({ exercise: round({ status: "ENDED", endedBy: "TIMER" }), online: ["u-1", "u-2", "u-3"], progress: { "u-1": entry("u-1") } });
    fireEvent.click(board().getByRole("button", { name: "Voltar para a aula" }));
    const dialog = within(screen.getByRole("dialog", { name: "Voltar para a aula" }));
    expect(dialog.queryByText(/cronômetro/)).toBeNull();
    expect(dialog.getByText("3 alunos não finalizaram.")).toBeDefined();
  });

  it("goes back at once when the round ended and everybody finished", () => {
    const done = (id: string) => entry(id, { completedAt: "2026-10-14T10:02:00Z", elapsedSeconds: 120, points: 12 });
    const { p } = mount({ exercise: round({ status: "ENDED", endedBy: "TIMER" }), online: ["u-1", "u-2"], progress: { "u-1": done("u-1"), "u-2": done("u-2") } });
    fireEvent.click(board().getByRole("button", { name: "Voltar para a aula" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ExerciseBoard, the cards (SPEC-071 CA-11)", () => {
  it("tells a student idle after 60 s with no command, with 'Sem sinal' first, the hand and the commands", () => {
    const { again } = mount({ online: ["u-1", "u-2"], hands: ["u-2"], progress: { "u-1": entry("u-1", { commands: 3 }), "u-2": entry("u-2") } });
    expect(card("Ana Souza").getByText("3 comandos")).toBeDefined();
    expect(card("Bruno Lima").getByRole("img", { name: "Mão levantada" })).toBeDefined();
    expect(card("Ana Souza").queryByRole("img", { name: "Mão levantada" })).toBeNull();
    // the progress still comes (no "Sem sinal"), and no command for 61 s
    tick(61_000);
    again({ progress: { "u-1": entry("u-1", { commands: 3, at: "2026-10-14T10:01:00Z" }), "u-2": entry("u-2", { at: "2026-10-14T10:01:00Z", lastCommandAt: "2026-10-14T10:00:30Z" }) } });
    expect(card("Ana Souza").getByText("Ocioso")).toBeDefined();
    expect(card("Bruno Lima").getByText("Fazendo")).toBeDefined();
    tick(20_000);
    expect(card("Ana Souza").getByText("Sem sinal")).toBeDefined();
  });

  it("puts first, as 'Perto do fim', who did not finish in the last 20% of the time, at least the last minute", () => {
    const progress = { "u-1": entry("u-1", { completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 14 }), "u-5": entry("u-5"), "u-3": entry("u-3") };
    const { again } = mount({ online: ["u-1", "u-3", "u-5"], progress });
    expect(board().queryAllByText("Perto do fim")).toHaveLength(0);
    vi.setSystemTime(new Date("2026-10-14T10:04:00Z"));
    again({ progress: { ...progress, "u-3": entry("u-3", { at: "2026-10-14T10:04:00Z" }), "u-5": entry("u-5", { at: "2026-10-14T10:04:00Z" }) } });
    tick(1000);
    expect(board().getAllByText("Perto do fim")).toHaveLength(2);
    expect(names()).toEqual(["Carla Dias", "Eva Mota", "Ana Souza"]);
    expect(card("Ana Souza").queryByText("Perto do fim")).toBeNull();
  });

  it("marks the student whose terminal the teacher took over, and the one who had help (no points)", () => {
    mount({ online: ["u-1", "u-2"], takeover: "u-1", progress: { "u-1": entry("u-1", { takenOver: true }), "u-2": entry("u-2", { takenOver: true }) } });
    expect(card("Ana Souza").getByText("Terminal assumido")).toBeDefined();
    expect(card("Bruno Lima").getByText("Teve ajuda no terminal (sem pontos)")).toBeDefined();
  });
});

describe("ExerciseBoard, the tabs of help (SPEC-071 CA-06)", () => {
  it("opens a tab for the student, watches him, and switches the watched student when the tab changes", () => {
    const { p, again } = mount();
    open("Ana Souza");
    expect(p.onWatch).toHaveBeenLastCalledWith("u-1");
    again({ watching: "u-1" });
    expect(tabs().getByRole("tab", { name: /Ana Souza/, selected: true })).toBeDefined();
    open("Bruno Lima");
    expect(p.onWatch).toHaveBeenLastCalledWith("u-2");
    again({ watching: "u-2" });
    fireEvent.click(tabs().getByRole("tab", { name: /Ana Souza/ }));
    expect(p.onWatch).toHaveBeenLastCalledWith("u-1");
  });

  it("opens up to 4 tabs, and tells the teacher to close one for the fifth", () => {
    mount();
    for (const name of ["Ana Souza", "Bruno Lima", "Carla Dias", "Davi Reis"]) open(name);
    expect(tabs().getAllByRole("tab")).toHaveLength(4);
    open("Eva Mota");
    expect(tabs().getAllByRole("tab")).toHaveLength(4);
    expect(board().getByRole("alert").textContent).toBe("Feche uma aba para abrir outra.");
  });

  it("closes a tab with nothing for the student but the watching, which stops when it was the tab watched", () => {
    const { p, again } = mount();
    open("Ana Souza");
    again({ watching: "u-1" });
    fireEvent.click(tabs().getByRole("button", { name: "Fechar a aba de Ana Souza" }));
    expect(board().queryByRole("tablist")).toBeNull();
    expect(p.onWatch).toHaveBeenLastCalledWith(null);
    expect(p.onTakeover).not.toHaveBeenCalled();
  });

  it("shows the history of the commands of the student, as text, and his private conversation", () => {
    const chat: LiveChatMessage[] = [{ id: "m-1", scope: "private", studentId: "u-1", from: "STUDENT", text: "Travei", createdAt: START }];
    const { again } = mount({ chat });
    open("Ana Souza");
    again({ watching: "u-1", progress: { "u-1": entry("u-1", { last: "ls" }) } });
    again({ progress: { "u-1": entry("u-1", { last: "<b>cd</b> /tmp" }) } });
    const history = within(board().getByRole("list", { name: "Comandos de Ana Souza" }));
    expect(history.getAllByRole("listitem").map((i) => i.textContent)).toEqual(["ls", "<b>cd</b> /tmp"]);
    expect(board().getByText("Travei")).toBeDefined();
  });

  it("marks the tab of a student with the hand up or a new message, when it is not the one open", () => {
    const { again } = mount();
    open("Ana Souza");
    open("Bruno Lima");
    again({ watching: "u-2", hands: ["u-1"] });
    expect(tabs().getByRole("tab", { name: /Ana Souza/ }).getAttribute("data-attention")).toBe("true");
    expect(tabs().getByRole("tab", { name: /Bruno Lima/ }).getAttribute("data-attention")).toBeNull();
  });
});

describe("ExerciseBoard, the takeover (SPEC-071 CA-07)", () => {
  const opened = () => {
    const m = mount();
    open("Ana Souza");
    m.again({ watching: "u-1" });
    return m;
  };

  it("takes over the terminal of the student of the tab, and gives it back", () => {
    const { p, again } = opened();
    fireEvent.click(board().getByRole("button", { name: "Assumir terminal" }));
    expect(p.onTakeover).toHaveBeenCalledWith("u-1", true);
    again({ takeover: "u-1" });
    expect(board().getByText("Você está controlando o terminal de Ana Souza")).toBeDefined();
    fireEvent.click(board().getByRole("button", { name: "Devolver controle" }));
    expect(p.onTakeover).toHaveBeenLastCalledWith("u-1", false);
  });

  it("sends the keys and the paste of the teacher to the student, and gives the control back with Ctrl+Shift+D, which does not go", () => {
    const { p, again } = opened();
    again({ takeover: "u-1" });
    const terminal = board().getByRole("application", { name: "Terminal de Ana Souza" });
    fireEvent.keyDown(terminal, { key: "l" });
    fireEvent.keyDown(terminal, { key: "c", ctrlKey: true });
    fireEvent.keyDown(terminal, { key: "Enter" });
    fireEvent.paste(terminal, { clipboardData: { getData: () => "ls -l\n" } });
    expect(p.onKey).toHaveBeenNthCalledWith(1, "u-1", { key: "l", ctrl: false, alt: false, shift: false });
    expect(p.onKey).toHaveBeenNthCalledWith(2, "u-1", { key: "c", ctrl: true, alt: false, shift: false });
    expect(p.onKey).toHaveBeenNthCalledWith(3, "u-1", { key: "Enter", ctrl: false, alt: false, shift: false });
    expect(p.onPaste).toHaveBeenCalledWith("u-1", "ls -l\n");
    fireEvent.keyDown(terminal, { key: "D", ctrlKey: true, shiftKey: true });
    expect(p.onKey).toHaveBeenCalledTimes(3);
    expect(p.onTakeover).toHaveBeenLastCalledWith("u-1", false);
  });

  it("sends no key when the terminal is not taken over, nor the keys of modifiers alone", () => {
    const { p, again } = opened();
    const terminal = board().getByRole("application", { name: "Terminal de Ana Souza" });
    fireEvent.keyDown(terminal, { key: "l" });
    expect(p.onKey).not.toHaveBeenCalled();
    again({ takeover: "u-1" });
    fireEvent.keyDown(terminal, { key: "Shift", shiftKey: true });
    fireEvent.keyDown(terminal, { key: "Control", ctrlKey: true });
    expect(p.onKey).not.toHaveBeenCalled();
  });

  it("has no takeover for a student who finished, nor while the round is paused", () => {
    const { again } = opened();
    again({ progress: { "u-1": entry("u-1", { completedAt: "2026-10-14T10:02:00Z", elapsedSeconds: 120, points: 12 }) } });
    expect(board().queryByRole("button", { name: "Assumir terminal" })).toBeNull();
    again({ progress: {}, exercise: round({ status: "PAUSED" }) });
    expect(board().getByRole("button", { name: "Assumir terminal" }).hasAttribute("disabled")).toBe(true);
  });
});
