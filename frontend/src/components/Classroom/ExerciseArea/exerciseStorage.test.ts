import { afterEach, describe, expect, it, vi } from "vitest";
import { exerciseKey, forgetOtherRuns } from "./exerciseStorage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// SPEC-065 CA-12: the machine of the student is kept in the browser by round
describe("the machine of the student kept in the browser", () => {
  it("has a key for each round", () => {
    expect(exerciseKey("r-1")).toContain("r-1");
    expect(exerciseKey("r-1")).not.toBe(exerciseKey("r-2"));
  });

  it("forgets the machines of the other rounds and keeps the one of this round and whatever is not a round's", () => {
    localStorage.setItem(exerciseKey("r-1"), "{}");
    localStorage.setItem(exerciseKey("r-2"), "{}");
    localStorage.setItem(exerciseKey("r-3"), "{}");
    localStorage.setItem("other", "keep");
    forgetOtherRuns("r-2");
    expect(localStorage.getItem(exerciseKey("r-1"))).toBeNull();
    expect(localStorage.getItem(exerciseKey("r-3"))).toBeNull();
    expect(localStorage.getItem(exerciseKey("r-2"))).toBe("{}");
    expect(localStorage.getItem("other")).toBe("keep");
  });

  it("does nothing when the browser keeps nothing", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => forgetOtherRuns("r-1")).not.toThrow();
  });
});
