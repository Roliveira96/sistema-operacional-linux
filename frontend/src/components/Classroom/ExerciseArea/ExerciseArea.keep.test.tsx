import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classroomService } from "@/services/classroomService";
import { exerciseModule, half, none, round, START, terminalHarness, whole } from "@/test/exerciseFixtures";
import { ExerciseArea, type ExerciseAreaProps } from "./ExerciseArea";
import { exerciseKey } from "./exerciseStorage";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

let h: ReturnType<typeof terminalHarness>;

const area = (over: Partial<ExerciseAreaProps> = {}) => (
  <ExerciseArea classId="c-1" userId="u-1" exercise={round()} away={false} watched={false} onProgress={() => true} onScreen={() => true} {...over} />
);
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
async function open(ui: ReactElement = area()) {
  const view = render(ui);
  for (let i = 0; i < 4; i += 1) await settle();
  return view;
}
const type = (command: string, state: unknown) => act(() => h.type(command, state));
const kept = (runId = "r-1") => JSON.parse(localStorage.getItem(exerciseKey(runId)) ?? "null") as unknown;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: new Date(START) });
  localStorage.clear();
  h = terminalHarness(mount);
  h.set(none());
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(exerciseModule);
  vi.spyOn(classroomService, "submitExercise").mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mount.mockReset();
  vi.restoreAllMocks();
});

// SPEC-065 CA-12: reloading the page in the middle of the exercise does not lose the work
describe("ExerciseArea, the machine kept in the browser", () => {
  it("keeps the machine two seconds after it changes, for the round", async () => {
    await open();
    await type("mkdir /dois", half());
    await advance(1999);
    expect(kept()).toBeNull();
    await advance(1);
    expect(kept()).toEqual(half());
  });

  it("keeps the last machine of a stretch of changes, at least every two seconds while the student goes on", async () => {
    await open();
    await type("a", none());
    await advance(1500);
    await type("mkdir /dois", half());
    await advance(500);
    expect(kept()).toEqual(half());
  });

  it("keeps it at once when the page is hidden, so a reload in the two seconds loses nothing", async () => {
    await open();
    await type("mkdir /dois", half());
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(kept()).toEqual(half());
  });

  it("keeps it when the student leaves the room before the two seconds", async () => {
    const view = await open();
    await type("mkdir /dois", half());
    view.unmount();
    expect(kept()).toEqual(half());
  });

  it("brings the machine back as the one the terminal starts on, without preparing it again", async () => {
    localStorage.setItem(exerciseKey("r-1"), JSON.stringify(half()));
    // The window has the machine it was opened on.
    h.set(half());
    await open();
    expect(h.mounted!.snapshot).toEqual(half());
    expect(h.win.execute).not.toHaveBeenCalled();
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
  });

  it("starts from the scenario and prepares the machine when the browser has nothing of this round", async () => {
    localStorage.setItem(exerciseKey("r-0"), JSON.stringify(half()));
    await open();
    expect(h.mounted!.snapshot).toEqual(exerciseModule.scenario);
    expect(h.win.execute).toHaveBeenCalled();
  });

  it("forgets the machines of the other rounds", async () => {
    localStorage.setItem(exerciseKey("r-0"), JSON.stringify(half()));
    localStorage.setItem("other", "keep");
    await open();
    expect(kept("r-0")).toBeNull();
    expect(localStorage.getItem("other")).toBe("keep");
  });

  it("forgets the machine when the round ends, and drops what was waiting to be kept", async () => {
    const view = await open();
    await type("mkdir /dois", half());
    await advance(2000);
    expect(kept()).toEqual(half());
    await type("touch /dois/x.txt", whole());
    view.rerender(area({ exercise: round({ status: "ENDED", endedBy: "TEACHER", endedAt: START }) }));
    expect(kept()).toBeNull();
    await advance(5000);
    expect(kept()).toBeNull();
  });

  it("works when the browser keeps nothing", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await open();
    await type("mkdir /dois", half());
    await advance(5000);
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
  });
});
