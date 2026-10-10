import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyExercise } from "@/lib/exercises";
import { createModuleExerciseService, exerciseBody, parseModuleExercise } from "./moduleExerciseService";
import type { HttpClient } from "./httpClient";

const stored = {
  id: "q1",
  title: "Criar",
  difficulty: "HARD",
  statement: "<p>x</p>",
  hints: [{ text: "dica", command: "mkdir /a" }, { text: "outra" }],
  solution: { steps: [{ command: "mkdir /a" }] },
  conditions: [{ kind: "DIR_EXISTS", path: "/a" }, { kind: "FILE_CONTENT", path: "/a/f", content: "oi", match: "contains" }, { nope: true }],
  usage: "EXERCISE",
  status: "PUBLISHED",
  position: 2,
  mandatory: true,
  updatedAt: "2026-10-10T12:00:00Z",
  createdAt: "2026-10-10T11:00:00Z",
  createdBy: "Ana",
  updatedBy: "Bia",
  legacy: false,
};

// Covers SPEC-023 5: the routes of the exercises of the module, and how an exercise is read and sent.
describe("moduleExerciseService", () => {
  let client: HttpClient;
  let service: ReturnType<typeof createModuleExerciseService>;

  beforeEach(() => {
    client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
    service = createModuleExerciseService(client);
  });

  it("reads an exercise as the editable model, with where it stands", () => {
    const ex = parseModuleExercise(stored);
    expect(ex.exercise).toMatchObject({ id: "q1", title: "Criar", difficulty: "HARD", description: "<p>x</p>", solution: { steps: [{ command: "mkdir /a" }] } });
    expect(ex.exercise.hints.map((h) => [h.text, h.command])).toEqual([["dica", "mkdir /a"], ["outra", ""]]);
    expect(ex.exercise.conditions).toHaveLength(2);
    expect(ex).toMatchObject({ usage: "EXERCISE", status: "PUBLISHED", position: 2, mandatory: true, createdBy: "Ana", updatedBy: "Bia", legacy: false });
    // What is missing or unknown falls back to something safe.
    const bare = parseModuleExercise({ id: "q2", difficulty: "X", usage: "?" });
    expect(bare).toMatchObject({ usage: "ASSESSMENT", status: "DRAFT", position: 0, legacy: false });
    expect(bare.exercise.difficulty).toBe("MEDIUM");
    expect(bare.exercise.solution).toBeUndefined();
  });

  it("sends the exercise trimmed, with the solution only when it has one", () => {
    const ex = { ...emptyExercise(), title: " Criar ", description: "<p>x</p>", hints: [{ id: "h", text: " d ", command: " ls " }, { id: "h2", text: "e", command: "" }], conditions: [{ kind: "DIR_EXISTS" as const, path: "/a" }] };
    expect(exerciseBody(ex)).toEqual({ title: "Criar", difficulty: "MEDIUM", statement: "<p>x</p>", hints: [{ text: "d", command: "ls" }, { text: "e" }], conditions: [{ kind: "DIR_EXISTS", path: "/a" }] });
    expect(exerciseBody({ ...ex, solution: { summary: "", steps: [{ command: " mkdir /a " }] } })).toHaveProperty("solution", { steps: [{ command: "mkdir /a" }] });
  });

  it("lists the bank with the snapshot of each set, and leaves out a set that has none", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ items: [stored], exercisesSetup: { steps: [{ command: "mkdir /treino" }] }, assessmentSetup: null });
    const bank = await service.bank("m 1");
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m%201/exercises");
    expect(bank.items).toHaveLength(1);
    expect(bank.exercisesSetup?.steps).toEqual([{ command: "mkdir /treino" }]);
    expect(bank.assessmentSetup).toBeUndefined();
  });

  it("creates, reads, saves (with the instant it knew, or forced), changes availability and removes", async () => {
    vi.mocked(client.post).mockResolvedValue(stored);
    vi.mocked(client.get).mockResolvedValue(stored);
    vi.mocked(client.put).mockResolvedValue(stored);
    const ex = { ...emptyExercise(), title: "A" };

    expect((await service.create("m", ex)).exercise.id).toBe("q1");
    expect(client.post).toHaveBeenCalledWith("/teacher/modules/m/exercises", expect.objectContaining({ title: "A" }));
    expect((await service.get("m", "q 1")).exercise.id).toBe("q1");
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m/exercises/q%201");

    await service.update("m", "q1", ex, "2026-10-10T12:00:00Z");
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercises/q1", expect.objectContaining({ updatedAt: "2026-10-10T12:00:00Z" }));
    await service.update("m", "q1", ex, "2026-10-10T12:00:00Z", true);
    const forced = vi.mocked(client.put).mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(forced.force).toBe(true);
    expect(forced).not.toHaveProperty("updatedAt");

    await service.availability("m", "q1", "EXERCISE", "PUBLISHED");
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercises/q1/availability", { usage: "EXERCISE", status: "PUBLISHED" });
    await service.remove("m", "q1");
    expect(client.delete).toHaveBeenCalledWith("/teacher/modules/m/exercises/q1");
  });

  it("sends the order of the trail and the two snapshots, null for the one that is empty", async () => {
    vi.mocked(client.put).mockResolvedValue(undefined);
    await service.order("m", [{ exerciseId: "b", mandatory: false }, { exerciseId: "a", mandatory: true }]);
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercises/order", { items: [{ exerciseId: "b", mandatory: false }, { exerciseId: "a", mandatory: true }] });
    await service.setups("m", { exercisesSetup: { summary: "", steps: [{ command: "mkdir /t" }] } });
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercise-setups", { exercisesSetup: { steps: [{ command: "mkdir /t" }] }, assessmentSetup: null });
  });
});
