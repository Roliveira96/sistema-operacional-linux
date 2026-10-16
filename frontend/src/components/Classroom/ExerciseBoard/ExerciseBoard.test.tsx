import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenElement } from "@/engine/terminalScreen";
import type { AdmissionEntry, ExerciseProgressEntry, LiveExercise } from "@/services/classroomService";
import { ExerciseBoard, type ExerciseBoardProps } from "./ExerciseBoard";
import type { BoardExercise } from "./exercises";

// The copy of the terminal asks for the stylesheet of the engine; no test needs it.
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

const scss = readFileSync(path.resolve(import.meta.dirname, "ExerciseBoard.module.scss"), "utf8");

const ana: AdmissionEntry = { studentId: "u-1", name: "Ana Souza" };
const bruno: AdmissionEntry = { studentId: "u-2", name: "Bruno Lima" };
const carla: AdmissionEntry = { studentId: "u-3", name: "Carla Dias" };

const exercises: BoardExercise[] = [
  { blockId: "b-1", blockNumber: 1, index: 0, title: "Listar arquivos", difficulty: "EASY", conditions: 2, hints: [{ text: "Use o ls", command: "ls -l" }, { text: "Olhe a pasta home", command: "" }] },
  { blockId: "b-1", blockNumber: 1, index: 1, title: "Sem como terminar", difficulty: "MEDIUM", conditions: 0, hints: [] },
  { blockId: "b-3", blockNumber: 3, index: 0, title: "Mudar permissões", difficulty: "HARD", conditions: 4, hints: [] },
];

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
const ended = (over: Partial<LiveExercise> = {}) => round({ status: "ENDED", endedBy: "TIMER", endedAt: "2026-10-14T10:05:00Z", ...over });
// SPEC-071: "Nova rodada" is there once the class went back to the lesson
const closed = (over: Partial<LiveExercise> = {}) => ended({ status: "CLOSED", closedAt: "2026-10-14T10:06:00Z", ...over });

const entry = (studentId: string, over: Partial<ExerciseProgressEntry> = {}): ExerciseProgressEntry => ({ studentId, met: 0, total: 2, last: "", at: START, ...over });
const finished = (studentId: string, elapsedSeconds: number, points: number): ExerciseProgressEntry =>
  entry(studentId, { met: 2, completedAt: "2026-10-14T10:03:25Z", elapsedSeconds, points, attempts: 1 });

const props = (over: Partial<ExerciseBoardProps> = {}): ExerciseBoardProps => ({
  exercise: null,
  exercises,
  admitted: [ana, bruno, carla],
  online: ["u-1", "u-2"],
  progress: {},
  watching: null,
  watchedScreen: null,
  canControl: true,
  onStart: vi.fn(),
  onEnd: vi.fn(),
  onReveal: vi.fn(),
  onWatch: vi.fn(),
  onTip: vi.fn(),
  onSendTip: vi.fn(() => true),
  ...over,
});

const mount = (over: Partial<ExerciseBoardProps> = {}) => {
  const p = props(over);
  const view = render(<ExerciseBoard {...p} />);
  return { p, view, again: (next: Partial<ExerciseBoardProps>) => view.rerender(<ExerciseBoard {...{ ...p, ...next }} />) };
};

const board = () => within(screen.getByRole("region", { name: "Exercício ao vivo" }));
const row = (title: string) => within(board().getByText(title).closest("li")!);
const names = () => board().queryAllByTestId("exercise-student-name").map((node) => node.textContent);
const card = (name: string) => within(board().getByText(name).closest("li")!);
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const oneLine = (text: string): ScreenElement => ({
  tag: "div",
  attrs: { class: "janela" },
  children: [{ tag: "div", attrs: { class: "term-linha" }, children: [text] }],
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(START));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-065 CA-01: the list of the exercises of the module, with the minutes, and the start
describe("ExerciseBoard, with no round", () => {
  it("is the section 'Exercício ao vivo', with the exercises of the module in order: where, title and level", () => {
    mount();
    expect(screen.getByRole("heading", { level: 2, name: "Exercício ao vivo" })).toBeDefined();
    const items = board().getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Bloco 1 · Exercício 1")).toBeDefined();
    expect(within(items[0]!).getByText("Listar arquivos")).toBeDefined();
    expect(within(items[0]!).getByText("Nível fácil")).toBeDefined();
    expect(within(items[1]!).getByText("Nível médio")).toBeDefined();
    expect(within(items[2]!).getByText("Bloco 3 · Exercício 1")).toBeDefined();
    expect(within(items[2]!).getByText("Nível difícil")).toBeDefined();
  });

  it("has no timer, no student and no end button", () => {
    mount();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(board().queryByRole("button", { name: "Encerrar agora" })).toBeNull();
  });

  it("has the field 'Minutos' with 5 as the default, and starts the exercise with it", () => {
    const { p } = mount();
    const field = row("Listar arquivos").getByRole("spinbutton", { name: /^Minutos/ }) as HTMLInputElement;
    expect(field.value).toBe("5");
    expect([field.min, field.max]).toEqual(["1", "60"]);
    fireEvent.click(row("Listar arquivos").getByRole("button", { name: /^Iniciar exercício/ }));
    expect(p.onStart).toHaveBeenCalledTimes(1);
    expect(p.onStart).toHaveBeenCalledWith("b-1", 0, 5);
  });

  it("starts with the minutes the teacher typed, for the exercise of that row only", () => {
    const { p } = mount();
    fireEvent.change(row("Mudar permissões").getByRole("spinbutton", { name: /^Minutos/ }), { target: { value: "12" } });
    expect((row("Listar arquivos").getByRole("spinbutton", { name: /^Minutos/ }) as HTMLInputElement).value).toBe("5");
    fireEvent.click(row("Mudar permissões").getByRole("button", { name: /^Iniciar exercício/ }));
    expect(p.onStart).toHaveBeenCalledWith("b-3", 0, 12);
  });

  it("brings the minutes out of the limits to the limit, when the teacher leaves the field and when he starts", () => {
    const { p } = mount();
    const field = () => row("Listar arquivos").getByRole("spinbutton", { name: /^Minutos/ }) as HTMLInputElement;
    const start = () => fireEvent.click(row("Listar arquivos").getByRole("button", { name: /^Iniciar exercício/ }));
    fireEvent.change(field(), { target: { value: "90" } });
    start();
    expect(p.onStart).toHaveBeenLastCalledWith("b-1", 0, 60);
    fireEvent.blur(field());
    expect(field().value).toBe("60");
    fireEvent.change(field(), { target: { value: "0" } });
    start();
    expect(p.onStart).toHaveBeenLastCalledWith("b-1", 0, 1);
    fireEvent.blur(field());
    expect(field().value).toBe("1");
  });

  it("lets the field be empty while the teacher types, starts with 5 then, and writes the 5 back when he leaves it", () => {
    const { p } = mount();
    const field = () => row("Listar arquivos").getByRole("spinbutton", { name: /^Minutos/ }) as HTMLInputElement;
    fireEvent.change(field(), { target: { value: "" } });
    expect(field().value).toBe("");
    fireEvent.click(row("Listar arquivos").getByRole("button", { name: /^Iniciar exercício/ }));
    expect(p.onStart).toHaveBeenLastCalledWith("b-1", 0, 5);
    fireEvent.blur(field());
    expect(field().value).toBe("5");
  });

  it("has the exercise with no condition off, with the reason written, and never starts it", () => {
    const { p } = mount();
    const start = row("Sem como terminar").getByRole("button", { name: /^Iniciar exercício/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(row("Sem como terminar").getByText("Sem condições de finalização")).toBeDefined();
    expect(start.getAttribute("aria-describedby")).toBe(row("Sem como terminar").getByText("Sem condições de finalização").id);
    fireEvent.click(start);
    expect(p.onStart).not.toHaveBeenCalled();
    expect(row("Listar arquivos").queryByText("Sem condições de finalização")).toBeNull();
  });

  it("has the buttons off when this panel cannot control the class", () => {
    mount({ canControl: false });
    for (const button of board().getAllByRole("button", { name: /^Iniciar exercício/ })) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("says the module has no practical exercises", () => {
    mount({ exercises: [] });
    expect(board().getByText("Este módulo não tem exercícios práticos.")).toBeDefined();
    expect(board().queryByRole("list")).toBeNull();
  });

  it("is not there with no module and no round", () => {
    const { view } = mount({ exercises: null });
    expect(view.container.innerHTML).toBe("");
  });

  it("draws the title of an exercise that has none, and the names as text", () => {
    mount({ exercises: [{ ...exercises[0]!, title: "" }, { ...exercises[2]!, title: "<b>negrito</b>" }] });
    expect(board().getByText("Sem título")).toBeDefined();
    expect(board().getByText("<b>negrito</b>")).toBeDefined();
    expect(screen.getByRole("region", { name: "Exercício ao vivo" }).querySelector("b")).toBeNull();
  });
});

// SPEC-065 CA-03, CA-06: while the round runs, the clock, the count and a card for each student
describe("ExerciseBoard, with the round running", () => {
  it("shows the title and the level of the exercise, and no list to start another", () => {
    mount({ exercise: round() });
    expect(board().getByRole("heading", { level: 3, name: "Listar arquivos" })).toBeDefined();
    expect(board().getByText("Nível fácil")).toBeDefined();
    expect(board().queryByRole("button", { name: /Iniciar exercício/ })).toBeNull();
    expect(board().queryByText("Minutos")).toBeNull();
  });

  it("counts down in minutes and seconds, a second at a time", () => {
    mount({ exercise: round() });
    const clock = () => screen.getByRole("timer", { name: "Tempo restante" }).textContent;
    expect(clock()).toBe("05:00");
    tick(1000);
    expect(clock()).toBe("04:59");
    tick(59_000);
    expect(clock()).toBe("04:00");
  });

  it("counts by the clock of the server, which can be ahead of the browser's", () => {
    mount({ exercise: round({ skewMs: 2000 }) });
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("04:58");
  });

  it("stops at 00:00 and says it waits for the server to end the round", () => {
    mount({ exercise: round() });
    expect(board().queryByText("Tempo esgotado. Aguardando o encerramento…")).toBeNull();
    tick(300_000);
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("00:00");
    expect(board().getByText("Tempo esgotado. Aguardando o encerramento…").getAttribute("role")).toBe("status");
    tick(60_000);
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("00:00");
  });

  it("counts from the time of the round when the panel opens in the middle of it", () => {
    vi.setSystemTime(new Date("2026-10-14T10:02:30Z"));
    mount({ exercise: round() });
    expect(screen.getByRole("timer", { name: "Tempo restante" }).textContent).toBe("02:30");
  });

  it("says how many of the students who are online finished", () => {
    const { again } = mount({ exercise: round(), progress: { "u-1": finished("u-1", 205, 25) } });
    expect(board().getByText("1 de 2 concluíram")).toBeDefined();
    again({ progress: { "u-1": finished("u-1", 205, 25), "u-2": finished("u-2", 250, 22) } });
    expect(board().getByText("2 de 2 concluíram")).toBeDefined();
    again({ progress: { "u-1": finished("u-1", 205, 25), "u-2": finished("u-2", 250, 22) }, online: ["u-1", "u-2", "u-3"] });
    expect(board().getByText("2 de 3 concluíram")).toBeDefined();
  });

  it("has a card for each student who is accepted and online, and no one else", () => {
    mount({ exercise: round(), online: ["u-1", "u-3", "u-9"], admitted: [ana, bruno, carla] });
    expect(names()).toEqual(["Ana Souza", "Carla Dias"]);
    expect(board().queryByText("Bruno Lima")).toBeNull();
    expect(board().getByText("0 de 2 concluíram")).toBeDefined();
  });

  it("says nobody is online", () => {
    mount({ exercise: round(), online: [] });
    expect(board().getByText("Nenhum aluno online.")).toBeDefined();
    expect(board().getByText("0 de 0 concluíram")).toBeDefined();
  });

  it("puts who is doing it first, by name, and who finished after, by time", () => {
    mount({
      exercise: round(),
      admitted: [ana, bruno, carla, { studentId: "u-4", name: "Davi Rocha" }],
      online: ["u-1", "u-2", "u-3", "u-4"],
      progress: { "u-1": finished("u-1", 250, 22), "u-3": finished("u-3", 120, 28), "u-4": entry("u-4") },
    });
    expect(names()).toEqual(["Bruno Lima", "Davi Rocha", "Carla Dias", "Ana Souza"]);
  });

  it("tells each state in words: doing, finished with time and points, and no signal", () => {
    mount({
      exercise: round(),
      admitted: [ana, bruno, carla],
      online: ["u-1", "u-2", "u-3"],
      progress: { "u-1": entry("u-1", { met: 1, at: "2026-10-14T10:00:00Z" }), "u-2": finished("u-2", 205, 25) },
    });
    expect(card("Ana Souza").getByText("Fazendo")).toBeDefined();
    expect(card("Bruno Lima").getByText("Concluiu em 03:25 · +25 pontos")).toBeDefined();
    expect(card("Carla Dias").getByText("Fazendo")).toBeDefined();
    tick(16_000);
    expect(card("Ana Souza").getByText("Sem sinal")).toBeDefined();
    expect(card("Carla Dias").getByText("Sem sinal")).toBeDefined();
    expect(card("Bruno Lima").queryByText("Sem sinal")).toBeNull();
    expect(card("Bruno Lima").getByText("Concluiu em 03:25 · +25 pontos")).toBeDefined();
  });

  it("goes back from no signal to doing when new progress comes", () => {
    const { again } = mount({ exercise: round(), progress: { "u-1": entry("u-1", { met: 1 }) } });
    tick(20_000);
    expect(card("Ana Souza").getByText("Sem sinal")).toBeDefined();
    again({ progress: { "u-1": entry("u-1", { met: 2, at: "2026-10-14T10:00:19Z" }) } });
    expect(card("Ana Souza").getByText("Fazendo")).toBeDefined();
  });

  it("counts the time of the progress by the clock of the server too", () => {
    mount({ exercise: round({ skewMs: 60_000 }), progress: { "u-1": entry("u-1", { at: "2026-10-14T10:01:00Z" }) } });
    expect(card("Ana Souza").getByText("Fazendo")).toBeDefined();
    tick(16_000);
    expect(card("Ana Souza").getByText("Sem sinal")).toBeDefined();
  });

  it("says the points in the singular when it is one", () => {
    mount({ exercise: round(), progress: { "u-1": finished("u-1", 61, 1) } });
    expect(card("Ana Souza").getByText("Concluiu em 01:01 · +1 ponto")).toBeDefined();
  });

  it("writes the progress as 'met de total condições' and draws it as a bar", () => {
    mount({ exercise: round(), progress: { "u-1": entry("u-1", { met: 2, total: 4 }) } });
    expect(card("Ana Souza").getByText("2 de 4 condições")).toBeDefined();
    const bar = card("Ana Souza").getByRole("progressbar", { name: "Andamento de Ana Souza" });
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemin"), bar.getAttribute("aria-valuemax")]).toEqual(["2", "0", "4"]);
  });

  it("says 'condição' in the singular for an exercise with one", () => {
    mount({ exercise: round(), progress: { "u-1": entry("u-1", { met: 0, total: 1 }) } });
    expect(card("Ana Souza").getByText("0 de 1 condição")).toBeDefined();
  });

  it("says there is no progress yet for a student who sent none, with no bar", () => {
    mount({ exercise: round() });
    expect(card("Bruno Lima").getByText("Ainda sem andamento.")).toBeDefined();
    expect(card("Bruno Lima").queryByRole("progressbar")).toBeNull();
  });

  it("fills the bar of a student who finished", () => {
    mount({ exercise: round(), progress: { "u-1": { ...finished("u-1", 205, 25), met: 1, total: 2 } } });
    expect(card("Ana Souza").getByText("2 de 2 condições")).toBeDefined();
    expect(card("Ana Souza").getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
  });

  it("does not draw a bar for a finished student whose progress it never had", () => {
    mount({ exercise: round(), progress: { "u-1": entry("u-1", { met: 0, total: 0, completedAt: "2026-10-14T10:03:25Z", elapsedSeconds: 205, points: 25 }) } });
    expect(card("Ana Souza").getByText("Concluiu em 03:25 · +25 pontos")).toBeDefined();
    expect(card("Ana Souza").queryByRole("progressbar")).toBeNull();
    expect(card("Ana Souza").queryByText(/condições/)).toBeNull();
  });

  // SPEC-065 CA-15
  it("draws the last command as text, never as HTML", () => {
    mount({ exercise: round(), progress: { "u-1": entry("u-1", { last: "echo '<b>x</b>' <img src=x onerror=alert(1)>" }) } });
    const last = card("Ana Souza").getByText("echo '<b>x</b>' <img src=x onerror=alert(1)>");
    expect(last.tagName).toBe("CODE");
    expect(screen.getByRole("region", { name: "Exercício ao vivo" }).querySelector("b, img")).toBeNull();
  });

  it("shows no command for a student who typed none", () => {
    mount({ exercise: round(), progress: { "u-1": entry("u-1", { last: "" }) } });
    expect(board().getByText("Ana Souza").closest("li")!.querySelector("code")).toBeNull();
  });

  it("names the student as text, never as HTML", () => {
    mount({ exercise: round(), admitted: [{ studentId: "u-1", name: "<i>Ana</i>" }], online: ["u-1"] });
    expect(names()).toEqual(["<i>Ana</i>"]);
    expect(screen.getByRole("region", { name: "Exercício ao vivo" }).querySelector("i")).toBeNull();
  });

  it("truncates the long command on the screen, not in the text", () => {
    expect(scss).toMatch(/\.last\s*\{[^}]*(truncate|text-overflow: ellipsis)/s);
  });

  // SPEC-065 CA-07
  it("has 'Ver terminal' on each card, off at first, which asks to watch that student", () => {
    const { p } = mount({ exercise: round() });
    const button = card("Ana Souza").getByRole("button", { name: "Ver terminal de Ana Souza" });
    expect(button.textContent).toBe("Ver terminal");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(p.onWatch).toHaveBeenCalledWith("u-1");
  });

  it("marks the student who is watched, and a second click stops watching", () => {
    const { p } = mount({ exercise: round(), watching: "u-1" });
    expect(card("Ana Souza").getByRole("button", { name: "Ver terminal de Ana Souza" }).getAttribute("aria-pressed")).toBe("true");
    expect(card("Bruno Lima").getByRole("button", { name: "Ver terminal de Bruno Lima" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(card("Ana Souza").getByRole("button", { name: "Ver terminal de Ana Souza" }));
    expect(p.onWatch).toHaveBeenCalledWith(null);
    fireEvent.click(card("Bruno Lima").getByRole("button", { name: "Ver terminal de Bruno Lima" }));
    expect(p.onWatch).toHaveBeenLastCalledWith("u-2");
  });

  it("shows the terminal of the student who is watched, with his name, as the picture comes", () => {
    const { again } = mount({ exercise: round(), watching: "u-1", watchedScreen: null });
    const terminal = within(screen.getByRole("region", { name: "Terminal de Ana Souza" }));
    expect(terminal.getByText("Carregando o terminal…")).toBeDefined();
    again({ watchedScreen: { studentId: "u-1", screen: oneLine("ls -l") } });
    expect(screen.getByTestId("terminal-mirror").querySelector(".term-linha")!.textContent).toBe("ls -l");
    expect(within(screen.getByRole("region", { name: "Terminal de Ana Souza" })).queryByText("Carregando o terminal…")).toBeNull();
  });

  it("does not show the picture of a student who is no longer the one watched", () => {
    mount({ exercise: round(), watching: "u-2", watchedScreen: { studentId: "u-1", screen: oneLine("do Ana") } });
    expect(screen.getByRole("region", { name: "Terminal de Bruno Lima" })).toBeDefined();
    expect(screen.getByText("Carregando o terminal…")).toBeDefined();
    expect(screen.getByTestId("terminal-mirror").querySelector(".term-linha")).toBeNull();
  });

  it("shows no terminal while nobody is watched", () => {
    mount({ exercise: round(), watching: null, watchedScreen: { studentId: "u-1", screen: oneLine("x") } });
    expect(screen.queryByTestId("terminal-mirror")).toBeNull();
    expect(screen.queryByRole("region", { name: /^Terminal de/ })).toBeNull();
  });

  it("stops watching with 'Parar de ver'", () => {
    const { p } = mount({ exercise: round(), watching: "u-1" });
    fireEvent.click(within(screen.getByRole("region", { name: "Terminal de Ana Souza" })).getByRole("button", { name: "Parar de ver" }));
    expect(p.onWatch).toHaveBeenCalledWith(null);
  });

  it("keeps the terminal of a student who went offline, with his name", () => {
    mount({ exercise: round(), watching: "u-3", online: ["u-1", "u-2"] });
    expect(screen.getByRole("region", { name: "Terminal de Carla Dias" })).toBeDefined();
  });

  it("draws the terminal of a student as text, never as HTML", () => {
    mount({ exercise: round(), watching: "u-1", watchedScreen: { studentId: "u-1", screen: oneLine("<img src=x onerror=alert(1)>") } });
    expect(screen.getByTestId("terminal-mirror").querySelector("img")).toBeNull();
    expect(screen.getByTestId("terminal-mirror").textContent).toBe("<img src=x onerror=alert(1)>");
  });

  // SPEC-065 CA-08
  it("has 'Enviar dica' on each card, which opens the private conversation with that student", () => {
    const { p } = mount({ exercise: round() });
    const button = card("Bruno Lima").getByRole("button", { name: "Enviar dica para Bruno Lima" });
    expect(button.textContent).toBe("Enviar dica");
    fireEvent.click(button);
    expect(p.onTip).toHaveBeenCalledWith("u-2");
  });

  it("lists the tips of the exercise, each with its text and its command of reference", () => {
    mount({ exercise: round() });
    const tips = within(board().getByRole("list", { name: "Dicas do exercício" }));
    const items = tips.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Use o ls")).toBeDefined();
    expect(within(items[0]!).getByText("ls -l").tagName).toBe("CODE");
    expect(within(items[1]!).getByText("Olhe a pasta home")).toBeDefined();
    expect(items[1]!.querySelector("code")).toBeNull();
    expect(board().getByRole("heading", { level: 4, name: "Dicas do exercício" })).toBeDefined();
  });

  it("sends a tip to everybody with its text and its command, and says it went", () => {
    const { p } = mount({ exercise: round() });
    expect(board().queryByText("Dica enviada para todos os alunos.")).toBeNull();
    fireEvent.click(board().getByRole("button", { name: "Enviar para todos: dica 1" }));
    expect(p.onSendTip).toHaveBeenCalledTimes(1);
    expect(p.onSendTip).toHaveBeenCalledWith("Dica: Use o ls\nComando: ls -l");
    expect(board().getByText("Dica enviada para todos os alunos.").getAttribute("role")).toBe("status");
    fireEvent.click(board().getByRole("button", { name: "Enviar para todos: dica 2" }));
    expect(p.onSendTip).toHaveBeenLastCalledWith("Dica: Olhe a pasta home");
  });

  it("says when the tip did not go", () => {
    const { p } = mount({ exercise: round(), onSendTip: vi.fn(() => false) });
    fireEvent.click(board().getByRole("button", { name: "Enviar para todos: dica 1" }));
    expect(p.onSendTip).toHaveBeenCalledTimes(1);
    expect(board().getByText("Não foi possível enviar a dica. Confira a conexão.").getAttribute("role")).toBe("alert");
    expect(board().queryByText("Dica enviada para todos os alunos.")).toBeNull();
  });

  it("draws the tips as text, never as HTML", () => {
    mount({ exercise: round(), exercises: [{ ...exercises[0]!, hints: [{ text: "<b>forte</b>", command: "<i>x</i>" }] }] });
    expect(board().getByText("<b>forte</b>")).toBeDefined();
    expect(board().getByText("<i>x</i>")).toBeDefined();
    expect(screen.getByRole("region", { name: "Exercício ao vivo" }).querySelector("b, i")).toBeNull();
  });

  it("says the exercise has no tips", () => {
    mount({ exercise: round({ blockId: "b-3", index: 0, title: "Mudar permissões", difficulty: "HARD" }) });
    expect(board().getByText("Este exercício não tem dicas.")).toBeDefined();
    expect(board().queryByRole("list", { name: "Dicas do exercício" })).toBeNull();
  });

  it("has no tips when the module is not known, which is the case of a panel just reloaded", () => {
    mount({ exercise: round(), exercises: null });
    expect(board().getByText("Este exercício não tem dicas.")).toBeDefined();
  });

  it("ends the round with 'Encerrar agora'", () => {
    const { p } = mount({ exercise: round() });
    fireEvent.click(board().getByRole("button", { name: "Encerrar agora" }));
    expect(p.onEnd).toHaveBeenCalledTimes(1);
  });

  it("has the end and the watch off when this panel cannot control the class", () => {
    mount({ exercise: round(), canControl: false });
    expect((board().getByRole("button", { name: "Encerrar agora" }) as HTMLButtonElement).disabled).toBe(true);
    expect((card("Ana Souza").getByRole("button", { name: "Ver terminal de Ana Souza" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells the teacher when the class went back to the slides and the students stay in the exercise", () => {
    const { again } = mount({ exercise: round() });
    expect(board().queryByText("A aula está nas lâminas, mas os alunos continuam no exercício até o fim.")).toBeNull();
    again({ classOnSlides: true });
    expect(board().getByText("A aula está nas lâminas, mas os alunos continuam no exercício até o fim.")).toBeDefined();
  });

  it("stops its clock when the round ends", () => {
    const { again } = mount({ exercise: round() });
    again({ exercise: ended() });
    expect(screen.queryByRole("timer")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// SPEC-065 CA-10: when it ends, the summary and the decision of showing the result
describe("ExerciseBoard, with the round ended", () => {
  it("says the exercise ended and why: the time, the teacher, or the end of the class", () => {
    const { again } = mount({ exercise: ended({ endedBy: "TIMER" }) });
    expect(board().getByRole("heading", { level: 3, name: "Exercício encerrado" })).toBeDefined();
    expect(board().getByText("O tempo acabou.")).toBeDefined();
    again({ exercise: ended({ endedBy: "TEACHER" }) });
    expect(board().getByText("Você encerrou o exercício.")).toBeDefined();
    again({ exercise: ended({ endedBy: "SESSION" }) });
    expect(board().getByText("A aula acabou.")).toBeDefined();
    again({ exercise: ended({ endedBy: undefined }) });
    expect(board().getByRole("heading", { level: 3, name: "Exercício encerrado" })).toBeDefined();
    expect(board().queryByText(/^O tempo acabou|^Você encerrou|^A aula acabou/)).toBeNull();
  });

  it("names the exercise and has no timer, no cards and no tips", () => {
    mount({ exercise: ended(), progress: { "u-1": entry("u-1") } });
    expect(board().getByText("Listar arquivos")).toBeDefined();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(board().queryByRole("button", { name: /Ver terminal|Enviar dica|Encerrar agora/ })).toBeNull();
    expect(board().queryByRole("heading", { name: "Dicas do exercício" })).toBeNull();
  });

  it("lists who finished, with the time and the points, the best first, and says how many did not", () => {
    mount({
      exercise: ended(),
      admitted: [ana, bruno, carla, { studentId: "u-4", name: "Davi Rocha" }],
      online: ["u-1", "u-2", "u-4"],
      progress: { "u-1": finished("u-1", 250, 22), "u-3": finished("u-3", 120, 28), "u-2": entry("u-2", { met: 1 }), "u-9": finished("u-9", 130, 28) },
    });
    const done = within(board().getByRole("list", { name: "Quem concluiu" })).getAllByRole("listitem");
    expect(done.map((item) => item.querySelector("strong")!.textContent)).toEqual(["Carla Dias", "Aluno", "Ana Souza"]);
    expect(within(done[0]!).getByText("02:00")).toBeDefined();
    expect(within(done[0]!).getByText("+28 pontos")).toBeDefined();
    expect(within(done[2]!).getByText("04:10")).toBeDefined();
    expect(within(done[2]!).getByText("+22 pontos")).toBeDefined();
    expect(board().getByText("2 alunos não concluíram.")).toBeDefined();
  });

  it("breaks a tie of points by the shorter time, and then by name", () => {
    mount({
      exercise: ended(),
      admitted: [ana, bruno, carla],
      online: ["u-1", "u-2", "u-3"],
      progress: { "u-1": finished("u-1", 200, 25), "u-2": finished("u-2", 100, 25), "u-3": finished("u-3", 100, 25) },
    });
    const done = within(board().getByRole("list", { name: "Quem concluiu" })).getAllByRole("listitem");
    expect(done.map((item) => item.querySelector("strong")!.textContent)).toEqual(["Bruno Lima", "Carla Dias", "Ana Souza"]);
  });

  it("says one student did not finish, in the singular, and that all did", () => {
    const { again } = mount({ exercise: ended(), online: ["u-1", "u-2"], progress: { "u-1": finished("u-1", 100, 25) } });
    expect(board().getByText("1 aluno não concluiu.")).toBeDefined();
    again({ progress: { "u-1": finished("u-1", 100, 25), "u-2": finished("u-2", 130, 24) } });
    expect(board().getByText("Todos concluíram.")).toBeDefined();
  });

  it("counts as not finished who sent progress and left, and whoever is online and sent nothing", () => {
    mount({ exercise: ended(), online: ["u-1", "u-2"], progress: { "u-1": finished("u-1", 100, 25), "u-3": entry("u-3", { met: 1 }) } });
    expect(board().getByText("2 alunos não concluíram.")).toBeDefined();
  });

  it("says nobody finished", () => {
    mount({ exercise: ended(), progress: {} });
    expect(board().getByText("Ninguém concluiu.")).toBeDefined();
    expect(board().queryByRole("list", { name: "Quem concluiu" })).toBeNull();
    expect(board().getByText("2 alunos não concluíram.")).toBeDefined();
  });

  it("draws the names as text, never as HTML", () => {
    mount({ exercise: ended(), admitted: [{ studentId: "u-1", name: "<b>Ana</b>" }], online: ["u-1"], progress: { "u-1": finished("u-1", 100, 25) } });
    expect(board().getByText("<b>Ana</b>")).toBeDefined();
    expect(screen.getByRole("region", { name: "Exercício ao vivo" }).querySelector("b")).toBeNull();
  });

  it("shows the result to the students with 'Mostrar resultado aos alunos'", () => {
    const { p } = mount({ exercise: ended({ resultVisible: false }) });
    const button = board().getByRole("button", { name: "Mostrar resultado aos alunos" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(p.onReveal).toHaveBeenCalledWith(true);
  });

  it("hides the result again with 'Ocultar resultado', and says the students are seeing it meanwhile", () => {
    const { p } = mount({ exercise: ended({ resultVisible: true }) });
    const button = board().getByRole("button", { name: "Ocultar resultado" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(board().getByText("Os alunos estão vendo o placar e a solução.")).toBeDefined();
    fireEvent.click(button);
    expect(p.onReveal).toHaveBeenCalledWith(false);
  });

  it("does not say the students see the result while it is hidden", () => {
    mount({ exercise: ended({ resultVisible: false }) });
    expect(board().queryByText("Os alunos estão vendo o placar e a solução.")).toBeNull();
  });

  it("follows the result the room tells, in both directions", () => {
    const { again } = mount({ exercise: ended({ resultVisible: false }) });
    again({ exercise: ended({ resultVisible: true }) });
    expect(board().getByRole("button", { name: "Ocultar resultado" })).toBeDefined();
    again({ exercise: ended({ resultVisible: false }) });
    expect(board().getByRole("button", { name: "Mostrar resultado aos alunos" })).toBeDefined();
  });

  it("has the reveal off when this panel cannot control the class", () => {
    mount({ exercise: ended(), canControl: false });
    expect((board().getByRole("button", { name: "Mostrar resultado aos alunos" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("goes back to the list with 'Nova rodada', and the ended round stays out while it is the same one", () => {
    const { p, again } = mount({ exercise: closed() });
    fireEvent.click(board().getByRole("button", { name: "Nova rodada" }));
    expect(board().queryByText("Exercício encerrado")).toBeNull();
    expect(board().getAllByRole("button", { name: /^Iniciar exercício/ })).toHaveLength(3);
    again({ exercise: closed({ resultVisible: true }) });
    expect(board().queryByText("Exercício encerrado")).toBeNull();
    fireEvent.click(row("Listar arquivos").getByRole("button", { name: /^Iniciar exercício/ }));
    expect(p.onStart).toHaveBeenCalledWith("b-1", 0, 5);
  });

  it("shows a round that starts after 'Nova rodada', and its end after that", () => {
    const { again } = mount({ exercise: closed() });
    fireEvent.click(board().getByRole("button", { name: "Nova rodada" }));
    again({ exercise: round({ runId: "r-2" }) });
    expect(screen.getByRole("timer", { name: "Tempo restante" })).toBeDefined();
    again({ exercise: closed({ runId: "r-2" }) });
    expect(board().getByRole("heading", { name: "Exercício encerrado" })).toBeDefined();
  });

  it("shows again an ended round that the room gives after a reload, whichever it is", () => {
    mount({ exercise: closed({ runId: "r-7" }) });
    expect(board().getByRole("heading", { name: "Exercício encerrado" })).toBeDefined();
  });

  it("is still there with no module, when a round ended", () => {
    mount({ exercise: closed(), exercises: null });
    expect(board().getByRole("heading", { name: "Exercício encerrado" })).toBeDefined();
    fireEvent.click(board().getByRole("button", { name: "Nova rodada" }));
    expect(screen.queryByRole("region", { name: "Exercício ao vivo" })).toBeNull();
  });
});

describe("ExerciseBoard, the style", () => {
  it("uses only the tokens of the theme: no color written in the sheet", () => {
    expect(scss).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(scss).toMatch(/var\(--color-/);
  });

  it("has a style for each state of a card, so none is drawn with a class that does not exist", () => {
    for (const state of ["doing", "done", "silent"]) expect(scss).toMatch(new RegExp(String.raw`\.${state}\s*\{`));
  });

  it("gives the buttons and the field a visible focus", () => {
    expect(scss).toMatch(/@include mixins\.focusable/);
  });
});
