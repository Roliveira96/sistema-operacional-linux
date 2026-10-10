import { beforeEach, describe, expect, it } from "vitest";
import { emptyCard } from "./cardModel";
import { readTest, saveTest, testStatus } from "./testRecord";

const card = (command = "ls") => ({ ...emptyCard(), commands: [{ id: "x", terminal: 1, expectError: false, command, explanation: "", outputExplanation: "", answers: [] }] });

beforeEach(() => localStorage.clear());

describe("test record", () => {
  it("has nothing to say about a card with no commands and no snapshot", () => {
    expect(testStatus("m", "k", emptyCard())).toBe("none");
  });

  it("goes from untested to passed or failed, and to stale when the commands change", () => {
    expect(testStatus("m", "k", card())).toBe("untested");
    saveTest("m", "k", true, card());
    expect(testStatus("m", "k", card())).toBe("passed");
    expect(testStatus("m", "k", card("pwd"))).toBe("stale");
    saveTest("m", "k", false, card());
    expect(testStatus("m", "k", card())).toBe("failed");
    expect(testStatus("m", "other", card())).toBe("untested");
  });

  it("ignores ids and the explanation, and survives broken storage", () => {
    saveTest("m", "k", true, card());
    const other = card();
    other.commands[0]!.id = "y";
    other.commands[0]!.explanation = "texto";
    expect(testStatus("m", "k", other)).toBe("passed");
    localStorage.setItem("card-test:m:k", "{oops");
    expect(readTest("m", "k")).toBeUndefined();
  });
});
