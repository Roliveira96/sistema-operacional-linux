import { describe, expect, it } from "vitest";
import { fromApiAnswer, stableOrder, toApiAnswer } from "./attemptAnswers";

// SPEC-090 RN-04, section 5: the answer of each kind goes to the server in the form of the bank, and comes back to the screen.
describe("attempt answers", () => {
  it("turns the answer of the screen into the answer of the server, by kind", () => {
    expect(toApiAnswer("THEORETICAL_BOOLEAN", false)).toEqual({ value: false });
    expect(toApiAnswer("THEORETICAL_SINGLE", "a")).toEqual({ choice: "a" });
    expect(toApiAnswer("THEORETICAL_MATCHING", [{ left: "l1", right: "r1" }])).toEqual({ links: [{ left: "l1", right: "r1" }] });
    expect(toApiAnswer("DISCURSIVE", "<p>755</p>")).toEqual({ html: "<p>755</p>" });
  });

  it("reads the answer of the server back, and nothing when there is none or it does not fit", () => {
    expect(fromApiAnswer("THEORETICAL_BOOLEAN", { value: true })).toBe(true);
    expect(fromApiAnswer("THEORETICAL_SINGLE", { choice: "b" })).toBe("b");
    expect(fromApiAnswer("THEORETICAL_MATCHING", { links: [{ left: "l1", right: "r2" }] })).toEqual([{ left: "l1", right: "r2" }]);
    expect(fromApiAnswer("DISCURSIVE", { html: "<p>x</p>" })).toBe("<p>x</p>");
    expect(fromApiAnswer("THEORETICAL_SINGLE", undefined)).toBeUndefined();
    expect(fromApiAnswer("THEORETICAL_BOOLEAN", { choice: "a" })).toBeUndefined();
    expect(fromApiAnswer("PRACTICAL", { machine: 1 })).toBeUndefined();
  });

  it("orders the items the same way every time for the same attempt, and differently for another one", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
    const once = stableOrder(items, "attempt-1:1");
    expect(stableOrder(items, "attempt-1:1")).toEqual(once);
    expect([...once].sort((x, y) => x.id.localeCompare(y.id))).toEqual(items);
    const others = ["attempt-2:1", "attempt-3:1", "attempt-4:1"].map((seed) => stableOrder(items, seed).map((i) => i.id).join(""));
    expect(others.some((o) => o !== once.map((i) => i.id).join(""))).toBe(true);
  });
});
