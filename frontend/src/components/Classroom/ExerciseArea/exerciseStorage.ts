import { clearMachine, loadMachine, saveMachine } from "@/lib/machineStorage";

const PREFIX = "exame-so:exercicio-ao-vivo:";

/** Where the browser keeps the machine of the student in a round (SPEC-065 CA-12): one key for each round. */
export const exerciseKey = (runId: string) => `${PREFIX}${runId}`;

export const loadExercise = (runId: string): unknown => loadMachine(exerciseKey(runId));
export const saveExercise = (runId: string, snapshot: unknown): void => saveMachine(exerciseKey(runId), snapshot);
export const clearExercise = (runId: string): void => clearMachine(exerciseKey(runId));

/** Drops the machines kept for the rounds that are not this one: a round the student left before its end would keep its machine for good. */
export function forgetOtherRuns(runId: string): void {
  try {
    const keep = exerciseKey(runId);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX) && key !== keep) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // Without storage there is nothing kept to forget.
  }
}
