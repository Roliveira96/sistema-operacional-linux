import { describe, expect, it } from "vitest";
import { answerFromCheck, answerFromProgress } from "./answers";

// Covers SPEC-035 RN-06 and SPEC-036 RN-05: how the screen reads a graded answer, whatever the kind.
describe("answers", () => {
  it("reads the result of a check of each kind", () => {
    expect(answerFromCheck({ value: false }, { passed: false, completedAt: "t", correctAnswer: true, explanation: "why" })).toEqual({
      type: "boolean",
      result: { choice: false, passed: false, correctAnswer: true, explanation: "why" },
    });
    expect(answerFromCheck({ choice: "b" }, { passed: true, completedAt: "t", correctChoice: "b" })).toEqual({
      type: "single",
      result: { choice: "b", passed: true, correctChoice: "b", explanation: undefined },
    });
    expect(answerFromCheck({ choice: "b" }, { passed: true, completedAt: "t", correctAnswer: true })).toBeNull();
  });

  it("reads the answer kept in the progress", () => {
    expect(answerFromProgress({ questionId: "q", completedAt: "t", attempts: 1, response: { choice: "a" }, passed: false, correctChoice: "b" })).toMatchObject({
      type: "single",
      result: { choice: "a", passed: false, correctChoice: "b" },
    });
    expect(answerFromProgress({ questionId: "q", completedAt: "t", attempts: 1, response: { value: true }, correctAnswer: true })).toMatchObject({
      type: "boolean",
      result: { choice: true, passed: false },
    });
    expect(answerFromProgress({ questionId: "q", completedAt: "t", attempts: 2 })).toBeNull();
    expect(answerFromProgress({ questionId: "q", completedAt: "t", attempts: 1, response: {} })).toBeNull();
  });
});

// Covers SPEC-037 RN-06 on the screen: the graded links of a matching question.
describe("answers of a matching question", () => {
  const links = [
    { left: "l1", right: "r2" },
    { left: "l2", right: "r1" },
  ];
  it("reads the result of a check and the progress", () => {
    const results = [
      { left: "l1", right: "r2", correct: true },
      { left: "l2", right: "r1", correct: false },
    ];
    expect(answerFromCheck({ links }, { passed: false, completedAt: "t", pairs: links, results })).toEqual({
      type: "matching",
      result: { links, passed: false, pairs: links, results, explanation: undefined },
    });
    expect(answerFromCheck({ links }, { passed: false, completedAt: "t" })).toBeNull();
    expect(answerFromProgress({ questionId: "q", completedAt: "t", attempts: 1, response: { links }, passed: true, pairs: links, results })).toMatchObject({
      type: "matching",
      result: { passed: true },
    });
  });
});
