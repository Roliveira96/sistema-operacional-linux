import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
import { exerciseModule, half, none, round, scenario, terminalHarness } from "@/test/exerciseFixtures";
import { ExerciseArea, type ExerciseAreaProps } from "./ExerciseArea";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

let h: ReturnType<typeof terminalHarness>;
const onProgress = vi.fn(() => true);
const onScreen = vi.fn(() => true);

const area = (over: Partial<ExerciseAreaProps> = {}) => (
  <ExerciseArea classId="c-1" userId="u-1" exercise={round()} away={false} watched={false} onProgress={onProgress} onScreen={onScreen} {...over} />
);
const ready = () => screen.findByRole("heading", { name: "Criar as pastas" });
const terminalReady = async () => {
  await ready();
  await vi.waitFor(() => expect(screen.queryByText("Carregando o terminal…")).toBeNull());
};

beforeEach(() => {
  localStorage.clear();
  h = terminalHarness(mount);
  h.set(none());
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(exerciseModule);
});
afterEach(() => {
  cleanup();
  mount.mockReset();
  onProgress.mockClear();
  onScreen.mockClear();
  vi.restoreAllMocks();
});

// SPEC-065 CA-02: each student resolves the exercise in his own terminal, on the machine the study screen would give him
describe("ExerciseArea, while the round runs", () => {
  it("asks for the module of the class, saying that it is loading", async () => {
    render(area());
    expect(screen.getByRole("status").textContent).toBe("Carregando o exercício…");
    await ready();
    expect(classroomService.getLiveModule).toHaveBeenCalledTimes(1);
    expect(classroomService.getLiveModule).toHaveBeenCalledWith("c-1");
  });

  it("shows the title and the level of the round, the time left and the statement as the study screen draws it", async () => {
    render(area());
    await ready();
    expect(screen.getByRole("region", { name: "Exercício ao vivo" })).toBeDefined();
    expect(screen.getByText("Médio")).toBeDefined();
    expect(screen.getByRole("timer", { name: "Tempo restante do exercício" })).toBeDefined();
    const statement = screen.getByRole("article", { name: "Enunciado" });
    expect(within(statement).getByText("dois").tagName).toBe("B");
    expect(statement.textContent).toBe("Crie a pasta dois com o arquivo x.txt");
  });

  it("opens the terminal on the scenario of the module and prepares it with the snapshots up to this exercise", async () => {
    render(area());
    expect(await screen.findByText("Carregando o terminal…")).toBeDefined();
    await terminalReady();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(h.mounted!.snapshot).toBe(scenario);
    expect(h.win.execute.mock.calls.map(([step]) => step.command)).toEqual(["mkdir /base", "touch /a", "touch /group", "mkdir /um"]);
  });

  it("shows how many conditions the machine meets, without saying which are missing", async () => {
    render(area());
    await terminalReady();
    expect(screen.getByText("0 de 2 condições")).toBeDefined();
    act(() => h.type("mkdir /dois", half()));
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
    expect(screen.queryByText(/existe/)).toBeNull();
    expect(screen.queryByText("Ainda falta:")).toBeNull();
  });

  it("counts the conditions on the machine as the window has it, processes included", async () => {
    const withProcess: LiveModuleContent = {
      ...exerciseModule,
      blocks: [{ id: "p", type: "EXERCISES", position: 0, payload: { items: [{ title: "P", difficulty: "EASY", conditions: [{ kind: "PROCESS_RUNNING", name: "sleep" }, { kind: "DIR_EXISTS", path: "/x" }] }] } }],
    };
    vi.mocked(classroomService.getLiveModule).mockResolvedValue(withProcess);
    render(area({ exercise: round({ blockId: "p", index: 0, title: "P" }) }));
    await screen.findByRole("heading", { name: "P" });
    await vi.waitFor(() => expect(h.mounted).not.toBeNull());
    await vi.waitFor(() => expect(screen.getByText("0 de 2 condições")).toBeDefined());
    h.set({ ...none(), processos: [{ pid: 7, comando: "sleep 300", estado: "S", nice: 0 }] });
    act(() => h.mounted!.callbacks.onCommand({}));
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
  });

  it("says the module could not be loaded, and the exercise is not in it", async () => {
    vi.mocked(classroomService.getLiveModule).mockRejectedValue(new Error("down"));
    const view = render(area());
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível carregar o exercício.");
    expect(mount).not.toHaveBeenCalled();
    view.unmount();

    vi.mocked(classroomService.getLiveModule).mockResolvedValue(exerciseModule);
    render(area({ exercise: round({ blockId: "b-1" }) }));
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível carregar o exercício.");
  });

  it("does not show the solution or the conditions while the round runs", async () => {
    render(area());
    await terminalReady();
    expect(screen.queryByText("Como o professor fez")).toBeNull();
    expect(screen.queryByText("touch /dois/x.txt")).toBeNull();
    expect(screen.queryByText(/A pasta \/dois/)).toBeNull();
  });

  it("asks for the module again for a new round, and waits for the new one before the terminal", async () => {
    const view = render(area());
    await terminalReady();
    view.rerender(area({ exercise: round({ runId: "r-2", title: "Outra" }) }));
    await screen.findByRole("heading", { name: "Outra" });
    expect(classroomService.getLiveModule).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(h.win.destroy).toHaveBeenCalledTimes(1);
  });
});

// SPEC-065 CA-13: "Ver a aula" only hides the area; the exercise goes on
describe("ExerciseArea, while the student looks at the lesson", () => {
  // A hidden element has no accessible name for the queries by role, so it is found by its label.
  const region = () => screen.getByLabelText("Exercício ao vivo");

  it("keeps the terminal open and only hides the area, and shows it again", async () => {
    const view = render(area());
    await terminalReady();
    expect(region().hasAttribute("hidden")).toBe(false);
    view.rerender(area({ away: true }));
    expect(region().hasAttribute("hidden")).toBe(true);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(h.win.destroy).not.toHaveBeenCalled();
    // The terminal goes on reporting the machine while the area is hidden.
    act(() => h.type("mkdir /dois", half()));
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
    view.rerender(area({ away: false }));
    expect(region().hasAttribute("hidden")).toBe(false);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("hides the area from the start when the student is already looking at the lesson", async () => {
    render(area({ away: true }));
    await vi.waitFor(() => expect(h.mounted).not.toBeNull());
    expect(region().hasAttribute("hidden")).toBe(true);
    expect(screen.queryByRole("region", { name: "Exercício ao vivo" })).toBeNull();
  });
});
