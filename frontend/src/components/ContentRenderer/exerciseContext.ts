import { createContext } from "react";
import type { ConditionsResult, ExerciseCondition } from "@/lib/exerciseConditions";

/** What the study screen lets an exercise do with the machine of the student: check how it ended (SPEC-022). */
export interface ExerciseChecker {
  /** Checks the conditions on the machine as it is now; null when there is no terminal yet. */
  check(conditions: ExerciseCondition[]): ConditionsResult | null;
}

/** Without a checker (the preview of the teacher) the exercises are shown but cannot be checked. */
export const ExerciseCheckContext = createContext<ExerciseChecker | null>(null);
