import { afterEach, describe, expect, it, vi } from "vitest";
import { drawSimulation, simulation } from "@/test/assessmentFixtures";
import { isAnswered, shuffled, simulatedQuestions } from "./assessmentSimulation";

afterEach(() => vi.restoreAllMocks());

// SPEC-081 section 3.1: what the student view of the simulator is made of.
describe("simulatedQuestions", () => {
  it("takes the questions of a manual composition in order, with the weight of each", () => {
    const list = simulatedQuestions(simulation());
    expect(list.map((q) => [q.position, q.id, q.weight])).toEqual([
      [1, "q-bool", 2],
      [2, "q-single", 2],
      [3, "q-match", 2],
      [4, "q-disc", 2],
      [5, "q-prac", 2],
    ]);
    expect(list[1]!.view.choices).toHaveLength(3);
  });

  it("takes the sample of a draw, numbered from 1, with the points of the level of each question (D-04)", () => {
    const list = simulatedQuestions(drawSimulation());
    expect(list.map((q) => [q.position, q.id, q.weight])).toEqual([
      [1, "q-bool", 3],
      [2, "q-disc", 7],
    ]);
  });

  it("gives no value to a question of a level that has no rule", () => {
    const data = drawSimulation({ rules: [{ difficulty: "EASY", quantity: 1, pointsPerQuestion: 3 }] });
    expect(simulatedQuestions(data).map((q) => q.weight)).toEqual([3, 0]);
  });
});

describe("isAnswered", () => {
  it("counts a true or false answer, including false", () => {
    expect(isAnswered(true)).toBe(true);
    expect(isAnswered(false)).toBe(true);
  });
  it("counts a chosen alternative, one link and a written answer, and not a missing, empty or blank one", () => {
    expect(isAnswered("b")).toBe(true);
    expect(isAnswered([{ left: "l1", right: "r1" }])).toBe(true);
    expect(isAnswered("<p>muda</p>")).toBe(true);
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered("")).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered("<p>  </p>")).toBe(false);
  });
});

describe("shuffled", () => {
  it("keeps every item and leaves the original list as it was", () => {
    const original = ["a", "b", "c", "d"];
    const mixed = shuffled(original);
    expect(original).toEqual(["a", "b", "c", "d"]);
    expect([...mixed].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("orders by the random number", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(shuffled(["a", "b", "c"])).toEqual(["b", "c", "a"]);
  });
});
