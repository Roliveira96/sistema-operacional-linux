import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TakeoverKey } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveChatMessage, type LiveExercise } from "@/services/classroomService";
import { END, exerciseModule, half, none, round, START, terminalHarness, whole } from "@/test/exerciseFixtures";
import { ExerciseArea, type ExerciseAreaProps } from "./ExerciseArea";

// SPEC-071: the area of the exercise of the student in the guided practice

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

let h: ReturnType<typeof terminalHarness>;
const onProgress = vi.fn(() => true);

/** The keys of the teacher, as the hook gives them to who listens. */
let listeners: Array<(key: TakeoverKey) => void> = [];
const onTakeoverKey = (listener: (key: TakeoverKey) => void) => {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
};
const teacherTypes = (key: TakeoverKey) => act(() => listeners.forEach((l) => l(key)));

const area = (over: Partial<ExerciseAreaProps> = {}) => (
  <ExerciseArea
    classId="c-1"
    userId="u-1"
    exercise={round()}
    away={false}
    watched={false}
    takenOver={false}
    notice={null}
    onTakeoverKey={onTakeoverKey}
    onProgress={onProgress}
    onScreen={() => true}
    {...over}
  />
);
const paused = (over: Partial<LiveExercise> = {}) => round({ status: "PAUSED", ...over });
const ended = (over: Partial<LiveExercise> = {}) => round({ status: "ENDED", endedBy: "TIMER", endedAt: END, ...over });
const closed = (over: Partial<LiveExercise> = {}) => ended({ status: "CLOSED", closedAt: END, ...over });

async function open(over: Partial<ExerciseAreaProps> = {}) {
  const view = render(area(over));
  await screen.findByRole("heading", { name: "Criar as pastas" });
  await vi.waitFor(() => expect(screen.queryByText("Carregando o terminal…")).toBeNull());
  return { ...view, again: (next: Partial<ExerciseAreaProps>) => view.rerender(area({ ...over, ...next })) };
}

/** The student presses a key on his own terminal. */
const press = (key: string) => fireEvent.keyDown(h.screen(), { key });

const message = (over: Partial<LiveChatMessage> = {}): LiveChatMessage => ({ id: "m-1", scope: "private", studentId: "u-1", from: "TEACHER", text: "Use o mkdir -p", createdAt: START, ...over });

beforeEach(() => {
  localStorage.clear();
  listeners = [];
  h = terminalHarness(mount);
  h.set(none());
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(exerciseModule);
});
afterEach(() => {
  cleanup();
  mount.mockReset();
  onProgress.mockClear();
  vi.restoreAllMocks();
});

describe("ExerciseArea, the pause (SPEC-071 CA-01)", () => {
  it("locks the terminal with the notice of the pause, and unlocks it when the teacher resumes", async () => {
    const { again } = await open();
    press("a");
    expect(h.keys).toHaveBeenCalledWith("a");
    h.keys.mockClear();

    again({ exercise: paused() });
    expect(screen.getByText("Pausado pelo professor")).toBeDefined();
    expect(screen.getByRole("timer", { name: "Tempo restante do exercício" }).textContent).toBe("Pausado");
    press("b");
    expect(h.keys).not.toHaveBeenCalled();
    fireEvent.paste(h.screen());
    expect(h.pasted).not.toHaveBeenCalled();

    again({ exercise: round() });
    expect(screen.queryByText("Pausado pelo professor")).toBeNull();
    press("c");
    expect(h.keys).toHaveBeenCalledWith("c");
  });

  it("sends no progress while paused", async () => {
    const { again } = await open();
    onProgress.mockClear();
    again({ exercise: paused() });
    act(() => h.type("mkdir /dois", half()));
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("ExerciseArea, the end of the time (SPEC-071 CA-04)", () => {
  it("locks the terminal and keeps it, with what was typed, telling that the time is up", async () => {
    const { again } = await open();
    act(() => h.type("mkdir /dois", half()));
    again({ exercise: ended() });
    expect(screen.getByRole("region", { name: "Exercício ao vivo" })).toBeDefined();
    expect(h.win.destroy).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Tempo esgotado")).toBeDefined();
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
    press("x");
    expect(h.keys).not.toHaveBeenCalled();
  });

  it("tells the student when the teacher ended it", async () => {
    const { again } = await open();
    again({ exercise: ended({ endedBy: "TEACHER" }) });
    expect(screen.getByText("Exercício encerrado pelo professor")).toBeDefined();
  });

  it("goes on in the same terminal when the teacher gives more time to the round that ended", async () => {
    const { again } = await open();
    act(() => h.type("mkdir /dois", half()));
    again({ exercise: ended() });
    again({ exercise: round({ endsAt: "2026-10-14T13:08:00.000Z", durationSeconds: 480 }) });
    expect(mount).toHaveBeenCalledTimes(1);
    expect(h.win.destroy).not.toHaveBeenCalled();
    expect(screen.queryByText("Tempo esgotado")).toBeNull();
    press("t");
    expect(h.keys).toHaveBeenCalledWith("t");
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
  });

  it("goes back to the stage only when the class goes back to the lesson", async () => {
    const { again } = await open();
    again({ exercise: ended() });
    expect(h.win.destroy).not.toHaveBeenCalled();
    again({ exercise: closed() });
    expect(screen.queryByRole("region", { name: "Exercício ao vivo" })).toBeNull();
    expect(h.win.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("ExerciseArea, the takeover (SPEC-071 CA-07, CA-08)", () => {
  it("locks the keyboard of the student with the notice, and lets the keys of the teacher reach the terminal, in order", async () => {
    const { again } = await open();
    again({ takenOver: true, takeoverTeacher: "Profa. Sediane" });
    expect(screen.getByText("O professor assumiu o controle do seu terminal")).toBeDefined();
    press("z");
    expect(h.keys).not.toHaveBeenCalled();
    teacherTypes({ key: "l" });
    teacherTypes({ key: "s" });
    teacherTypes({ key: "Enter" });
    teacherTypes({ paste: "pwd\n" });
    expect(h.keys.mock.calls.map((call) => call[0])).toEqual(["l", "s", "Enter", "p", "w", "d", "Enter"]);
  });

  it("tells that the teacher gave the control back, and unlocks the keyboard", async () => {
    const { again } = await open();
    again({ takenOver: true });
    again({ takenOver: false });
    expect(screen.getByText("O professor devolveu o controle")).toBeDefined();
    press("q");
    expect(h.keys).toHaveBeenCalledWith("q");
  });

  it("gives no key of the teacher to the terminal when it is not taken over", async () => {
    await open();
    teacherTypes({ key: "l" });
    expect(h.keys).not.toHaveBeenCalled();
  });

  it("tells the student who concluded with the help of the teacher that it gave no points", async () => {
    vi.spyOn(classroomService, "submitExercise").mockResolvedValue({ passed: true, completedAt: "2026-10-14T13:03:12.000Z", elapsedSeconds: 192, points: 0 });
    await open({ takenOver: true });
    act(() => h.type("touch /dois/x.txt", whole()));
    expect(await screen.findByText("Você concluiu com a ajuda do professor no terminal (sem pontos)")).toBeDefined();
  });
});

describe("ExerciseArea, the private message over the terminal (SPEC-071 CA-10)", () => {
  it("shows the private message of the teacher over the terminal, as text, and closes it", async () => {
    const { again } = await open();
    again({ notice: message({ text: "<b>Use</b> o mkdir -p" }) });
    const note = screen.getByRole("note", { name: "Mensagem do professor" });
    expect(note.textContent).toContain("<b>Use</b> o mkdir -p");
    expect(note.querySelector("b")).toBeNull();
    fireEvent.click(within(note).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("note", { name: "Mensagem do professor" })).toBeNull();
    again({ notice: message({ id: "m-2", text: "Outra dica" }) });
    expect(screen.getByRole("note", { name: "Mensagem do professor" }).textContent).toContain("Outra dica");
  });

  it("also shows it while the round is paused, and not after it ended", async () => {
    const { again } = await open({ exercise: paused() });
    again({ exercise: paused(), notice: message() });
    expect(screen.getByRole("note", { name: "Mensagem do professor" })).toBeDefined();
    again({ exercise: ended(), notice: message({ id: "m-3" }) });
    expect(screen.queryByRole("note", { name: "Mensagem do professor" })).toBeNull();
  });
});

describe("ExerciseArea, the commands of the student (SPEC-071 RN-09)", () => {
  it("tells how many commands he ran with his progress", async () => {
    await open();
    act(() => h.type("mkdir /dois", half()));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ commands: 0 }));
    await act(async () => {
      await vi.waitFor(() => expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ commands: 1 })), { timeout: 4000 });
    });
  });
});
