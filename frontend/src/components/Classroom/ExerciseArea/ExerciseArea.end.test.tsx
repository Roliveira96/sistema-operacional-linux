import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classroomService, type LiveExercise, type LiveModuleContent } from "@/services/classroomService";
import { approved, deferred, END, exerciseModule, none, round, terminalHarness, whole } from "@/test/exerciseFixtures";
import { ExerciseArea, type ExerciseAreaProps } from "./ExerciseArea";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

let h: ReturnType<typeof terminalHarness>;

const area = (over: Partial<ExerciseAreaProps> = {}) => (
  <ExerciseArea classId="c-1" userId="u-1" exercise={round()} away={false} watched={false} onProgress={() => true} onScreen={() => true} {...over} />
);
// SPEC-071: the student goes back to the stage when the class goes back to the lesson (CLOSED), not when the time is up
const ended = (over: Partial<LiveExercise> = {}) => round({ status: "CLOSED", endedBy: "TIMER", endedAt: END, closedAt: END, ...over });
const result = { runId: "r-1", visible: true, completed: 2, participants: 3, scoreboard: [
  { studentId: "u-9", name: "Ana", elapsedSeconds: 75, points: 30 },
  { studentId: "u-1", name: "Bia", elapsedSeconds: 192, points: 28 },
] };
const shown = (over: Partial<LiveExercise> = {}) => ended({ resultVisible: true, result, ...over });
const results = () => screen.findByRole("region", { name: "Resultado do exercício" });
const rows = () => within(screen.getByRole("table", { name: "Placar" })).getAllByRole("row").slice(1);

/** The student concludes the exercise in this page: the server answers the check, and the room never tells him his result again until he comes back. */
async function concluded() {
  vi.spyOn(classroomService, "submitExercise").mockResolvedValue(approved);
  const view = render(area());
  await screen.findByRole("heading", { name: "Criar as pastas" });
  await waitFor(() => expect(screen.queryByText("Carregando o terminal…")).toBeNull());
  act(() => h.type("touch /dois/x.txt", whole()));
  await screen.findByText("Você concluiu! +30 pontos, em 03:12");
  return view;
}

/** The student sees the round run first, as he does when he is in the room when it ends. */
async function watched(then: LiveExercise) {
  const view = render(area());
  await screen.findByRole("heading", { name: "Criar as pastas" });
  await waitFor(() => expect(screen.queryByText("Carregando o terminal…")).toBeNull());
  view.rerender(area({ exercise: then }));
  return view;
}

beforeEach(() => {
  localStorage.clear();
  h = terminalHarness(mount);
  h.set(none());
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(exerciseModule);
});
afterEach(() => {
  cleanup();
  mount.mockReset();
  vi.restoreAllMocks();
});

// SPEC-065 CA-09: the exercise ends and the student goes back to the stage, with no scoreboard and no solution
describe("ExerciseArea, when the round ends with the result hidden", () => {
  it("tells the student that the exercise ended, takes the area and its terminal away, and gives no result", async () => {
    await watched(ended());
    expect(screen.getByRole("status").textContent).toBe("Exercício encerrado");
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    expect(h.win.destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Como o professor fez")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("tells the personal gain of the student who concluded, even with the result hidden", async () => {
    await watched(ended({ myResult: { completedAt: END, elapsedSeconds: 192, points: 30 } }));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Exercício encerrado");
    expect(status.textContent).toContain("Você concluiu! +30 pontos, em 03:12");
  });

  it("tells the personal gain of a student who concluded in this page, though the room never told his result", async () => {
    const view = await concluded();
    view.rerender(area({ exercise: ended() }));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Exercício encerrado");
    expect(status.textContent).toContain("Você concluiu! +30 pontos, em 03:12");
  });

  // SPEC-065 section 6: a check on its way when the round ends is taken by the server for up to two seconds, so the student is told what it said
  it("tells the personal gain of a check that was on its way when the round ended, and that the server still took", async () => {
    const verdict = deferred<typeof approved>();
    vi.spyOn(classroomService, "submitExercise").mockReturnValue(verdict.promise);
    const view = render(area());
    await screen.findByRole("heading", { name: "Criar as pastas" });
    await waitFor(() => expect(screen.queryByText("Carregando o terminal…")).toBeNull());
    act(() => h.type("touch /dois/x.txt", whole()));
    view.rerender(area({ exercise: ended() }));
    expect(screen.getByRole("status").textContent).not.toContain("Você concluiu");
    await act(async () => verdict.resolve(approved));
    expect(screen.getByRole("status").textContent).toContain("Você concluiu! +30 pontos, em 03:12");
  });

  // SPEC-065 CA-09: the personal gain always shows; the notice of the end is only for who saw the round run in this page
  describe("a round already over when the student came in or reloaded", () => {
    const gain = { completedAt: END, elapsedSeconds: 192, points: 30 };

    it("tells only the personal gain of a student who concluded, with no word of the end, and asks for no module", () => {
      const view = render(area({ exercise: ended({ myResult: gain }) }));
      const status = screen.getByRole("status");
      expect(status.textContent).toBe("Você fez +30 pontos, em 03:12");
      expect(view.container.textContent).not.toContain("Exercício encerrado");
      expect(screen.queryByRole("region")).toBeNull();
      expect(classroomService.getLiveModule).not.toHaveBeenCalled();
      expect(mount).not.toHaveBeenCalled();
    });

    it("lets the student close it, once for the page", () => {
      const view = render(area({ exercise: ended({ myResult: gain }) }));
      fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
      expect(screen.queryByRole("status")).toBeNull();
      view.rerender(area({ exercise: ended({ myResult: gain, endedBy: "TEACHER" }) }));
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("says nothing when the student did not conclude and the result is hidden", () => {
      const view = render(area({ exercise: ended({ myResult: null }) }));
      expect(view.container.textContent).toBe("");
      view.rerender(area({ exercise: ended() }));
      expect(view.container.textContent).toBe("");
    });

    it("still tells the end, with the gain, to who saw the round run", async () => {
      await watched(ended({ myResult: gain }));
      const status = screen.getByRole("status");
      expect(status.textContent).toContain("Exercício encerrado");
      expect(status.textContent).toContain("Você concluiu! +30 pontos, em 03:12");
    });
  });

  it("says nothing of a round that was already over when the student came, and does not ask for the module", () => {
    const view = render(area({ exercise: ended() }));
    expect(view.container.textContent).toBe("");
    expect(classroomService.getLiveModule).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();
  });

  it("lets the student close the notice for good", async () => {
    const view = await watched(ended());
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(area({ exercise: ended({ endedBy: "TEACHER" }) }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("brings the area back with a new round", async () => {
    const view = await watched(ended());
    view.rerender(area({ exercise: round({ runId: "r-2", title: "Outra" }) }));
    expect(await screen.findByRole("heading", { name: "Outra" })).toBeDefined();
    expect(screen.queryByText("Exercício encerrado")).toBeNull();
  });
});

// SPEC-065 CA-10: the teacher shows the result: the scoreboard and the solution
describe("ExerciseArea, the result the teacher shows", () => {
  it("shows the scoreboard in the order the room gave, with the time and the points of each one", async () => {
    render(area({ exercise: shown() }));
    expect(await results()).toBeDefined();
    expect(screen.getByText("2 de 3 concluíram")).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Nome" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Tempo" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Pontos" })).toBeDefined();
    const [first, second] = rows().map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(first).toEqual(["1º", "Ana", "01:15", "30"]);
    expect(second).toEqual(["2º", "Bia (você)", "03:12", "28"]);
  });

  it("marks the row of the student himself by text and by aria-current, not by color only", async () => {
    render(area({ exercise: shown() }));
    await results();
    const [ana, bia] = rows();
    expect(bia!.getAttribute("aria-current")).toBe("true");
    expect(within(bia!).getByText("(você)")).toBeDefined();
    expect(ana!.getAttribute("aria-current")).toBeNull();
    expect(within(ana!).queryByText("(você)")).toBeNull();
  });

  it("shows how the teacher did it, as the list of the commands of the solution", async () => {
    render(area({ exercise: shown() }));
    await results();
    expect(await screen.findByRole("heading", { name: "Como o professor fez" })).toBeDefined();
    const steps = within(screen.getByRole("list", { name: "Como o professor fez" })).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(["mkdir /dois", "touch /dois/x.txt"]);
    expect(steps[0]!.querySelector("code")).not.toBeNull();
  });

  it("tells the files a solution writes", async () => {
    const module_: LiveModuleContent = {
      ...exerciseModule,
      blocks: [{ id: "b-2", type: "EXERCISES", position: 0, payload: { items: [{ title: "T", difficulty: "EASY", conditions: [{ kind: "DIR_EXISTS", path: "/x" }], solution: { steps: [{ command: "ls" }], files: [{ path: "/etc/motd", content: "oi" }] } }] } }],
    };
    vi.mocked(classroomService.getLiveModule).mockResolvedValue(module_);
    render(area({ exercise: shown({ index: 0 }) }));
    const list = await screen.findByRole("list", { name: "Como o professor fez" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["ls", "Escreve o arquivo /etc/motd"]);
  });

  it("shows the personal gain of the student on top of the result", async () => {
    render(area({ exercise: shown({ myResult: { completedAt: END, elapsedSeconds: 192, points: 28 } }) }));
    const region = await results();
    expect(within(region).getByText("Você concluiu! +28 pontos, em 03:12")).toBeDefined();
  });

  it("shows the personal gain of a student who concluded in this page on top of the result, though the room never told his result", async () => {
    const view = await concluded();
    view.rerender(area({ exercise: shown() }));
    const region = await results();
    expect(within(region).getByText("Você concluiu! +30 pontos, em 03:12")).toBeDefined();
  });

  it("says when nobody concluded, without an empty scoreboard", async () => {
    render(area({ exercise: shown({ result: { ...result, completed: 0, scoreboard: [] } }) }));
    await results();
    expect(screen.getByText("Ninguém concluiu o exercício.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("draws the names and the commands as text, never as html", async () => {
    const module_: LiveModuleContent = {
      ...exerciseModule,
      blocks: [{ id: "b-2", type: "EXERCISES", position: 0, payload: { items: [{ title: "T", difficulty: "EASY", conditions: [{ kind: "DIR_EXISTS", path: "/x" }], solution: { steps: [{ command: "echo <i>oi</i>" }] } }] } }],
    };
    vi.mocked(classroomService.getLiveModule).mockResolvedValue(module_);
    const tricky = { ...result, scoreboard: [{ studentId: "u-9", name: "<b>x</b>", elapsedSeconds: 75, points: 30 }] };
    render(area({ exercise: shown({ index: 0, result: tricky }) }));
    const region = await results();
    await screen.findByText("echo <i>oi</i>");
    expect(within(region).getByText("<b>x</b>")).toBeDefined();
    expect(region.querySelector("b")).toBeNull();
    expect(region.querySelector("i")).toBeNull();
  });

  it("shows the scoreboard without the solution when the module cannot be loaded", async () => {
    vi.mocked(classroomService.getLiveModule).mockRejectedValue(new Error("down"));
    render(area({ exercise: shown() }));
    await results();
    await waitFor(() => expect(classroomService.getLiveModule).toHaveBeenCalled());
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText("Como o professor fez")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is shown to a student who comes after the end, at once", async () => {
    render(area({ exercise: shown() }));
    expect(await results()).toBeDefined();
    expect(classroomService.getLiveModule).toHaveBeenCalledWith("c-1");
  });

  it("goes back to the stage with Voltar à aula, and stays there until the round changes", async () => {
    const view = render(area({ exercise: shown() }));
    await results();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à aula" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(area({ exercise: shown({ result: { ...result, completed: 3 } }) }));
    expect(screen.queryByRole("region")).toBeNull();
    view.rerender(area({ exercise: round({ runId: "r-2", title: "Outra" }) }));
    expect(await screen.findByRole("heading", { name: "Outra" })).toBeDefined();
  });

  it("goes back to the stage when the teacher hides the result, and shows it again when he shows it", async () => {
    const view = await watched(shown());
    expect(await results()).toBeDefined();
    view.rerender(area({ exercise: ended() }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Exercício encerrado");
    view.rerender(area({ exercise: shown() }));
    expect(await results()).toBeDefined();
  });
});
