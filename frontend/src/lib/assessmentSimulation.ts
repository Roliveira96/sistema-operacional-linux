import { answerText } from "@/lib/questionKinds";
import type { Difficulty, PreviewContent, PreviewData } from "@/services/assessmentService";

/** What the teacher answers as a student in the simulator, by kind: true or false, the id of the alternative, the links, or the html written. */
export type SimulatedResponse = boolean | string | { left: string; right: string }[];

/** A question of the simulator, in the place the student meets it and with the value it has there. */
export interface SimulatedQuestion extends PreviewContent {
  position: number;
  weight: number;
}

/**
 * The questions the student view shows (SPEC-081): the questions chosen one by one, in order, or, in a draw, the sample the server already
 * gives (not stored), each one worth the points of its level.
 */
export function simulatedQuestions(data: PreviewData): SimulatedQuestion[] {
  if (!data.rules?.length) return data.questions;
  const points = new Map<Difficulty, number>(data.rules.map((r) => [r.difficulty, r.pointsPerQuestion]));
  return (data.sample ?? []).map((q, i) => ({ ...q, position: i + 1, weight: points.get(q.difficulty) ?? 0 }));
}

/** Whether a question has an answer: false counts, an empty choice, no links and a blank text do not. */
export function isAnswered(response: SimulatedResponse | undefined): boolean {
  if (response === undefined) return false;
  if (typeof response === "boolean") return true;
  if (typeof response === "string") return answerText(response).trim() !== "";
  return response.length > 0;
}

/** The items in a random order (Fisher-Yates); the list given is not changed. */
export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
