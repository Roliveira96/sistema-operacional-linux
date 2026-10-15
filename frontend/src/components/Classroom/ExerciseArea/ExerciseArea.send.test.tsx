import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { classroomService } from "@/services/classroomService";
import { approved, deferred, dir, exerciseModule, file, half, machine, none, picture, round, START, terminalHarness, whole } from "@/test/exerciseFixtures";
import { ExerciseArea, type ExerciseAreaProps } from "./ExerciseArea";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

let h: ReturnType<typeof terminalHarness>;
const onProgress = vi.fn(() => true);
const onScreen = vi.fn(() => true);
let submit: MockInstance<typeof classroomService.submitExercise>;

const area = (over: Partial<ExerciseAreaProps> = {}) => (
  <ExerciseArea classId="c-1" userId="u-1" exercise={round()} away={false} watched={false} onProgress={onProgress} onScreen={onScreen} {...over} />
);
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
async function open(ui: ReactElement = area()) {
  const view = render(ui);
  for (let i = 0; i < 4; i += 1) await settle();
  return view;
}
const type = (command: string, state: unknown) => act(() => h.type(command, state));
const sent = () => onProgress.mock.calls as unknown as Array<[{ runId: string; met: number; total: number; last: string }]>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: new Date(START) });
  localStorage.clear();
  h = terminalHarness(mount);
  h.set(none());
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(exerciseModule);
  submit = vi.spyOn(classroomService, "submitExercise");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mount.mockReset();
  onProgress.mockReset();
  onProgress.mockReturnValue(true);
  onScreen.mockClear();
  vi.restoreAllMocks();
});

// SPEC-065 3.1 and 3.3: the progress goes at most every 2 s, and only when it changes
describe("ExerciseArea, the progress the teacher is told", () => {
  it("tells at once how far the student is when the terminal is ready", async () => {
    await open();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ runId: "r-1", met: 0, total: 2, last: "" });
  });

  it("holds what changes for two seconds and then tells the last command and how many conditions are met", async () => {
    await open();
    await type("mkdir /dois", half());
    expect(onProgress).toHaveBeenCalledTimes(1);
    await advance(1999);
    expect(onProgress).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(sent()[1]![0]).toEqual({ runId: "r-1", met: 1, total: 2, last: "mkdir /dois" });
  });

  it("tells only the last of the changes of a stretch of two seconds", async () => {
    await open();
    await advance(2500);
    await type("ls", none());
    expect(onProgress).toHaveBeenCalledTimes(2);
    await type("mkdir /dois", half());
    await type("pwd", half());
    await advance(2000);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(sent()[2]![0]).toMatchObject({ met: 1, last: "pwd" });
  });

  it("tells nothing when nothing changed", async () => {
    await open();
    await type("pwd", none());
    await advance(2000);
    expect(onProgress).toHaveBeenCalledTimes(2);
    // The same command again, on the same machine: the room already knows.
    h.history.pop();
    await type("pwd", none());
    await advance(10_000);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("tries again two seconds later when the room did not take it, as with the connection down", async () => {
    onProgress.mockReturnValueOnce(false).mockReturnValue(true);
    await open();
    expect(onProgress).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(sent()[1]![0]).toEqual({ runId: "r-1", met: 0, total: 2, last: "" });
    await advance(10_000);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("stops telling when the area goes away", async () => {
    const view = await open();
    await type("mkdir /dois", half());
    view.unmount();
    await advance(5000);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});

// SPEC-065 CA-07: the picture of the terminal goes out only while the teacher watches the student, at most five times a second
describe("ExerciseArea, the picture of the terminal", () => {
  it("sends nothing while the teacher is not watching, whatever the window tells", async () => {
    await open();
    act(() => h.show(picture("a")));
    await advance(1000);
    act(() => h.show(picture("b")));
    expect(onScreen).not.toHaveBeenCalled();
  });

  it("sends the last picture the window told as soon as the teacher starts watching", async () => {
    const view = await open();
    act(() => h.show(picture("a")));
    act(() => h.show(picture("b")));
    view.rerender(area({ watched: true }));
    expect(onScreen).toHaveBeenCalledTimes(1);
    expect(onScreen).toHaveBeenCalledWith("r-1", picture("b"));
  });

  it("then sends each new picture, at most every 200 ms, the last of a stretch", async () => {
    const view = await open();
    act(() => h.show(picture("a")));
    view.rerender(area({ watched: true }));
    expect(onScreen).toHaveBeenCalledTimes(1);
    act(() => h.show(picture("b")));
    act(() => h.show(picture("c")));
    await advance(199);
    expect(onScreen).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(onScreen).toHaveBeenCalledTimes(2);
    expect(onScreen).toHaveBeenLastCalledWith("r-1", picture("c"));
    await advance(500);
    act(() => h.show(picture("d")));
    expect(onScreen).toHaveBeenCalledTimes(3);
    expect(onScreen).toHaveBeenLastCalledWith("r-1", picture("d"));
  });

  it("stops when the teacher stops watching, and starts again with the picture it has", async () => {
    const view = await open();
    act(() => h.show(picture("a")));
    view.rerender(area({ watched: true }));
    view.rerender(area({ watched: false }));
    await advance(500);
    act(() => h.show(picture("b")));
    await advance(500);
    expect(onScreen).toHaveBeenCalledTimes(1);
    view.rerender(area({ watched: true }));
    expect(onScreen).toHaveBeenCalledTimes(2);
    expect(onScreen).toHaveBeenLastCalledWith("r-1", picture("b"));
  });

  it("sends the pictures also while the student looks at the lesson", async () => {
    const view = await open(area({ watched: true, away: true }));
    act(() => h.show(picture("a")));
    expect(onScreen).toHaveBeenCalledWith("r-1", picture("a"));
    view.unmount();
  });

  it("has nothing to send when the teacher watches before the window told any picture", async () => {
    await open(area({ watched: true }));
    expect(onScreen).not.toHaveBeenCalled();
  });
});

// SPEC-065 CA-04: the state of the machine goes to the server once the conditions are met, and the server says if it passes
describe("ExerciseArea, the conclusion of the exercise", () => {
  const checking = () => screen.queryByText("Conferindo…");

  it("sends nothing while a condition is missing", async () => {
    await open();
    await type("mkdir /dois", half());
    await advance(10_000);
    expect(submit).not.toHaveBeenCalled();
  });

  it("sends the machine to the server once the conditions are met, saying that it is checking, and only once", async () => {
    const verdict = deferred<typeof approved>();
    submit.mockReturnValue(verdict.promise);
    await open();
    await type("touch /dois/x.txt", whole());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("c-1", "r-1", whole());
    expect(checking()).not.toBeNull();
    await type("ls", whole());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("tells the points and the time, and makes the terminal read only", async () => {
    submit.mockResolvedValue(approved);
    await open();
    await type("touch /dois/x.txt", whole());
    await settle();
    expect(screen.getByText("Você concluiu! +30 pontos, em 03:12")).toBeDefined();
    expect(checking()).toBeNull();
    fireEvent.keyDown(h.screen(), { key: "a" });
    expect(h.keys).not.toHaveBeenCalled();
    // Whatever else the window tells is not sent again.
    await type("ls", machine([dir("dois", [file("x.txt")]), dir("outra")]));
    await advance(5000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("says something is still missing when the server says no, without saying what", async () => {
    submit.mockResolvedValue({ passed: false });
    await open();
    await type("touch /dois/x.txt", whole());
    await settle();
    expect(screen.getByText("Ainda falta algo. Continue tentando.")).toBeDefined();
    expect(checking()).toBeNull();
    fireEvent.keyDown(h.screen(), { key: "a" });
    expect(h.keys).toHaveBeenCalledWith("a");
  });

  it("sends again when the state changes after a no, and not before", async () => {
    const second = deferred<{ passed: boolean }>();
    submit.mockResolvedValueOnce({ passed: false }).mockReturnValueOnce(second.promise);
    await open();
    await type("touch /dois/x.txt", whole());
    await settle();
    await type("ls", whole());
    await advance(5000);
    expect(submit).toHaveBeenCalledTimes(1);
    await type("mkdir /outra", machine([dir("dois", [file("x.txt")]), dir("outra")]));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith("c-1", "r-1", machine([dir("dois", [file("x.txt")]), dir("outra")]));
    expect(checking()).not.toBeNull();
  });

  it("looks again at the state that came while the server was checking, if the answer is no", async () => {
    const first = deferred<{ passed: boolean }>();
    submit.mockReturnValueOnce(first.promise).mockResolvedValue({ passed: false });
    await open();
    await type("touch /dois/x.txt", whole());
    const changed = machine([dir("dois", [file("x.txt")]), dir("outra")]);
    await type("mkdir /outra", changed);
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ passed: false }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith("c-1", "r-1", changed);
  });

  it("tries again when the network fails, up to three times and three seconds apart, and then says so", async () => {
    submit.mockRejectedValue(new Error("network"));
    await open();
    await type("touch /dois/x.txt", whole());
    expect(submit).toHaveBeenCalledTimes(1);
    await advance(2999);
    expect(submit).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(submit).toHaveBeenCalledTimes(2);
    await advance(3000);
    expect(submit).toHaveBeenCalledTimes(3);
    await advance(3000);
    expect(submit).toHaveBeenCalledTimes(4);
    expect(checking()).toBeNull();
    expect(screen.getByText("Não foi possível conferir agora. Rode qualquer comando para tentar de novo.")).toBeDefined();
    await advance(30_000);
    expect(submit).toHaveBeenCalledTimes(4);
  });

  it("sends again with the next command after giving up, though the machine is the same", async () => {
    submit.mockRejectedValue(new Error("network"));
    await open();
    await type("touch /dois/x.txt", whole());
    await advance(9000);
    expect(submit).toHaveBeenCalledTimes(4);
    submit.mockResolvedValue(approved);
    await type("ls", whole());
    await settle();
    expect(submit).toHaveBeenCalledTimes(5);
    expect(screen.getByText("Você concluiu! +30 pontos, em 03:12")).toBeDefined();
  });

  it("concludes when a new try goes through", async () => {
    submit.mockRejectedValueOnce(new Error("network")).mockResolvedValue(approved);
    await open();
    await type("touch /dois/x.txt", whole());
    await advance(3000);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Você concluiu! +30 pontos, em 03:12")).toBeDefined();
  });

  it("stops trying when the area goes away", async () => {
    submit.mockRejectedValue(new Error("network"));
    const view = await open();
    await type("touch /dois/x.txt", whole());
    view.unmount();
    await advance(20_000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("knows that the student concluded from the state of the room, with the terminal read only and nothing sent", async () => {
    await open(area({ exercise: round({ myResult: { completedAt: approved.completedAt, elapsedSeconds: 192, points: 30 } }) }));
    expect(screen.getByText("Você concluiu! +30 pontos, em 03:12")).toBeDefined();
    h.set(whole());
    await type("ls", whole());
    await advance(5000);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(h.screen(), { key: "a" });
    expect(h.keys).not.toHaveBeenCalled();
  });

  it("sends the machine as soon as the terminal is ready when it already meets the conditions, as when the page came back", async () => {
    h.set(whole());
    submit.mockResolvedValue(approved);
    await open();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Você concluiu! +30 pontos, em 03:12")).toBeDefined();
  });
});
