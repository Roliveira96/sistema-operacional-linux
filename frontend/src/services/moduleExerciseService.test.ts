import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyExercise } from "@/lib/exercises";
import { bankToTest, bankTestKey, createModuleExerciseService, exerciseBody, parseModuleExercise, type ExerciseBank } from "./moduleExerciseService";
import type { HttpClient } from "./httpClient";

const stored = {
  id: "q1",
  title: "Criar",
  difficulty: "HARD",
  statement: "<p>x</p>",
  hints: [{ text: "dica", command: "mkdir /a" }, { text: "outra" }],
  solution: { steps: [{ command: "mkdir /a" }] },
  conditions: [{ kind: "DIR_EXISTS", path: "/a" }, { kind: "FILE_CONTENT", path: "/a/f", content: "oi", match: "contains" }, { nope: true }],
  practice: true,
  assessment: true,
  exclusive: false,
  status: "PUBLISHED",
  position: 2,
  mandatory: true,
  updatedAt: "2026-10-10T12:00:00Z",
  createdAt: "2026-10-10T11:00:00Z",
  createdBy: "Ana",
  updatedBy: "Bia",
  dependsOn: "q0",
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
    expect(ex).toMatchObject({ status: "PUBLISHED", position: 2, mandatory: true, createdBy: "Ana", updatedBy: "Bia", legacy: false, practice: true, assessment: true, exclusive: false, dependsOn: "q0" });
    // What is missing or unknown falls back to something safe.
    const bare = parseModuleExercise({ id: "q2", difficulty: "X" });
    expect(bare).toMatchObject({ practice: false, assessment: false, exclusive: false, dependsOn: null, status: "DRAFT", position: 0, legacy: false });
    expect(bare.exercise.difficulty).toBe("MEDIUM");
    expect(bare.exercise.solution).toBeUndefined();
  });

  it("sends the exercise trimmed, with the solution only when it has one", () => {
    const ex = { ...emptyExercise(), title: " Criar ", description: "<p>x</p>", hints: [{ id: "h", text: " d ", command: " ls " }, { id: "h2", text: "e", command: "" }], conditions: [{ kind: "DIR_EXISTS" as const, path: "/a" }] };
    expect(exerciseBody(ex)).toEqual({ title: "Criar", difficulty: "MEDIUM", statement: "<p>x</p>", hints: [{ text: "d", command: "ls" }, { text: "e" }], conditions: [{ kind: "DIR_EXISTS", path: "/a" }], dependsOn: null });
    expect(exerciseBody(ex, "q0")).toHaveProperty("dependsOn", "q0");
    expect(exerciseBody({ ...ex, solution: { summary: "", steps: [{ command: " mkdir /a " }] } })).toHaveProperty("solution", { steps: [{ command: "mkdir /a" }] });
  });

  it("lists the bank with its single snapshot, and leaves it out when there is none", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ items: [stored], bankSetup: { steps: [{ command: "mkdir /treino" }] } });
    const bank = await service.bank("m 1");
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m%201/exercises");
    expect(bank.items).toHaveLength(1);
    expect(bank.bankSetup?.steps).toEqual([{ command: "mkdir /treino" }]);
    vi.mocked(client.get).mockResolvedValueOnce({ items: [], bankSetup: null });
    expect((await service.bank("m")).bankSetup).toBeUndefined();
  });

  it("creates, reads, saves (with the instant it knew, or forced), links, unlinks and removes", async () => {
    vi.mocked(client.post).mockResolvedValue(stored);
    vi.mocked(client.get).mockResolvedValue(stored);
    vi.mocked(client.put).mockResolvedValue(stored);
    const ex = { ...emptyExercise(), title: "A" };

    expect((await service.create("m", ex)).exercise.id).toBe("q1");
    expect(client.post).toHaveBeenCalledWith("/teacher/modules/m/exercises", expect.objectContaining({ title: "A" }));
    // Created from a block, it comes already linked and depending on another (SPEC-023 11.1).
    await service.create("m", ex, "q0", { practice: true });
    expect(client.post).toHaveBeenLastCalledWith("/teacher/modules/m/exercises", expect.objectContaining({ dependsOn: "q0", links: { practice: true } }));
    expect((await service.get("m", "q 1")).exercise.id).toBe("q1");
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m/exercises/q%201");

    await service.update("m", "q1", ex, "2026-10-10T12:00:00Z");
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercises/q1", expect.objectContaining({ updatedAt: "2026-10-10T12:00:00Z" }));
    await service.update("m", "q1", ex, "2026-10-10T12:00:00Z", true);
    const forced = vi.mocked(client.put).mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(forced.force).toBe(true);
    expect(forced).not.toHaveProperty("updatedAt");

    await service.links("m", "q1", { practice: true, assessment: false, exclusive: false }, "PUBLISHED");
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercises/q1/links", { practice: true, assessment: false, exclusive: false, status: "PUBLISHED" });
    await service.remove("m", "q1");
    expect(client.delete).toHaveBeenCalledWith("/teacher/modules/m/exercises/q1");
  });

  it("sends the order of the trail and the single snapshot, null when it is empty", async () => {
    vi.mocked(client.put).mockResolvedValue(undefined);
    await service.order("m", [{ exerciseId: "b", mandatory: false }, { exerciseId: "a", mandatory: true }]);
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercises/order", { items: [{ exerciseId: "b", mandatory: false }, { exerciseId: "a", mandatory: true }] });
    await service.setup("m", { summary: "", steps: [{ command: "mkdir /t" }] });
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercise-setup", { bankSetup: { steps: [{ command: "mkdir /t" }] } });
    await service.setup("m");
    expect(client.put).toHaveBeenLastCalledWith("/teacher/modules/m/exercise-setup", { bankSetup: null });
  });

  // Covers SPEC-023 12.3, CA-07: the test runs the published exercises of each set, each after the ones it depends on.
  describe("what the test of the module takes from the bank", () => {
    const item = (id: string, over: Record<string, unknown> = {}) => parseModuleExercise({ ...stored, id, title: id, dependsOn: undefined, practice: false, assessment: false, position: 0, ...over });
    const bank: ExerciseBank = {
      items: [item("b", { practice: true, position: 2, dependsOn: "a" }), item("a", { practice: true, position: 1 }), item("z", { assessment: true }), item("d", { practice: true, position: 3, status: "DRAFT" })],
      bankSetup: { summary: "", steps: [{ command: "mkdir /t" }] },
    };

    it("takes the published ones of each set, in the order of the trail, and counts the drafts", () => {
      const run = bankToTest(bank);
      expect(run.practice.map((e) => e.id)).toEqual(["a", "b"]);
      expect(run.assessment.map((e) => e.id)).toEqual(["z"]);
      expect(run.drafts).toBe(1);
    });

    it("puts what an exercise depends on before it, even when the trail has it later or it is in another set", () => {
      const swapped: ExerciseBank = { items: [item("x", { practice: true, position: 1, dependsOn: "y" }), item("y", { assessment: true })] };
      expect(bankToTest(swapped).practice.map((e) => e.id)).toEqual(["y", "x"]);
    });

    it("gives a key that changes with a solution, a dependency or the snapshot, and is empty for an empty bank", () => {
      const key = bankTestKey(bank);
      expect(key).not.toBe("");
      expect(bankTestKey({ ...bank, bankSetup: undefined })).not.toBe(key);
      expect(bankTestKey({ ...bank, items: bank.items.map((it) => (it.exercise.id === "b" ? { ...it, dependsOn: null } : it)) })).not.toBe(key);
      expect(bankTestKey({ items: [] })).toBe("");
      expect(bankTestKey({ items: [], bankSetup: { summary: "", steps: [{ command: "ls" }] } })).not.toBe("");
    });
  });
});
