// The answers a student gives to the questions without a terminal (SPEC-035, SPEC-036): how the screen reads them from the result of
// a check and from the progress, whatever the kind.

import type { DescriptiveResult } from "@/components/DescriptiveAnswer/DescriptiveAnswer";
import type { MatchingResult } from "@/components/MatchingAnswer/MatchingAnswer";
import type { ChoiceResult } from "@/components/SingleChoiceAnswer/SingleChoiceAnswer";
import type { TrueFalseResult } from "@/components/TrueFalseAnswer/TrueFalseAnswer";
import type { AnswerResult, ProgressItem } from "@/services/practiceService";

/** What the student sends: the value of a true or false question, or the id of the alternative of a single choice one. */
export type AnswerResponse = { value: boolean } | { choice: string } | { links: { left: string; right: string }[] } | { html: string };

/** An answer already graded, with what the student may now see. */
export type GivenAnswer =
  | { type: "boolean"; result: TrueFalseResult }
  | { type: "single"; result: ChoiceResult }
  | { type: "matching"; result: MatchingResult }
  | { type: "descriptive"; result: DescriptiveResult };

/** The graded answer from the response sent and the result of the check; null when they do not match. */
export function answerFromCheck(response: AnswerResponse, r: AnswerResult): GivenAnswer | null {
  if ("value" in response && typeof r.correctAnswer === "boolean")
    return { type: "boolean", result: { choice: response.value, passed: r.passed, correctAnswer: r.correctAnswer, explanation: r.explanation } };
  if ("choice" in response && typeof r.correctChoice === "string")
    return { type: "single", result: { choice: response.choice, passed: r.passed, correctChoice: r.correctChoice, explanation: r.explanation } };
  if ("html" in response && r.status === "PENDING")
    return { type: "descriptive", result: { html: response.html, status: "PENDING", score: null, studentNote: null, expectedAnswer: r.expectedAnswer ?? null } };
  if ("links" in response && r.pairs && r.results)
    return { type: "matching", result: { links: response.links, passed: r.passed, pairs: r.pairs, results: r.results, explanation: r.explanation } };
  return null;
}

/** The graded answer kept in the progress of a question; null when it was not answered or left the practice. */
export function answerFromProgress(p: ProgressItem): GivenAnswer | null {
  if (!p.response) return null;
  // The status of the progress belongs to a descriptive answer; the other kinds are read as the result of a check.
  const checked: AnswerResult = { ...p, status: undefined, passed: p.passed === true };
  if (typeof p.response.value === "boolean") return answerFromCheck({ value: p.response.value }, checked);
  if (typeof p.response.choice === "string") return answerFromCheck({ choice: p.response.choice }, checked);
  if (typeof p.response.html === "string") {
    const graded = p.status === "GRADED" && typeof p.score === "number";
    return {
      type: "descriptive",
      result: {
        html: p.response.html,
        status: graded ? "GRADED" : "PENDING",
        score: graded ? p.score! : null,
        studentNote: graded ? (p.studentNote ?? null) : null,
        expectedAnswer: p.expectedAnswer ?? null,
      },
    };
  }
  if (Array.isArray(p.response.links)) return answerFromCheck({ links: p.response.links }, checked);
  return null;
}
