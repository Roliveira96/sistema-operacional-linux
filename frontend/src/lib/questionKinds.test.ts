import { describe, expect, it } from "vitest";
import { hasDescription, isMatching, isSingleChoice, isTrueFalse, MAX_PAIRS, MIN_PAIRS, parseKind, plainText, QUESTION_KINDS, usesTerminal } from "./questionKinds";

// Covers SPEC-035 RN-01 and RN-02 on the screen: the kinds and what each one has.
describe("questionKinds", () => {
  it("knows the practical and the true or false kinds", () => {
    expect(QUESTION_KINDS).toEqual(["PRACTICAL", "THEORETICAL_BOOLEAN", "THEORETICAL_SINGLE", "THEORETICAL_MATCHING"]);
    expect(parseKind("THEORETICAL_SINGLE")).toBe("THEORETICAL_SINGLE");
    expect(isSingleChoice("THEORETICAL_SINGLE")).toBe(true);
    expect(isSingleChoice("THEORETICAL_BOOLEAN")).toBe(false);
    expect(usesTerminal("THEORETICAL_SINGLE")).toBe(false);
    expect(plainText("<p> Chmod&nbsp;  <b>x</b></p>")).toBe("chmod x");
    expect(parseKind("THEORETICAL_BOOLEAN")).toBe("THEORETICAL_BOOLEAN");
    expect(parseKind(undefined)).toBe("PRACTICAL");
    expect(parseKind("DISCURSIVE")).toBe("PRACTICAL");
    expect(usesTerminal(undefined)).toBe(true);
    expect(usesTerminal("PRACTICAL")).toBe(true);
    expect(usesTerminal("THEORETICAL_BOOLEAN")).toBe(false);
    expect(isTrueFalse("THEORETICAL_BOOLEAN")).toBe(true);
    expect(isTrueFalse("PRACTICAL")).toBe(false);
  });

  it("counts text or an image as a description", () => {
    expect(hasDescription("<p> </p>")).toBe(false);
    expect(hasDescription("")).toBe(false);
    expect(hasDescription("<p>ls lists</p>")).toBe(true);
    expect(hasDescription('<img src="https://x/a.avif" alt="a">')).toBe(true);
  });
});

// Covers SPEC-037 RN-01: the matching kind.
describe("questionKinds matching", () => {
  it("knows the matching kind and its limits", () => {
    expect(QUESTION_KINDS).toContain("THEORETICAL_MATCHING");
    expect(parseKind("THEORETICAL_MATCHING")).toBe("THEORETICAL_MATCHING");
    expect(isMatching("THEORETICAL_MATCHING")).toBe(true);
    expect(isMatching("THEORETICAL_SINGLE")).toBe(false);
    expect(usesTerminal("THEORETICAL_MATCHING")).toBe(false);
    expect([MIN_PAIRS, MAX_PAIRS]).toEqual([2, 5]);
  });
});
