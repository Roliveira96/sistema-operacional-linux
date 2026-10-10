// The group of exercises of a card (SPEC-022): the editable model, its block, and what the test of the card runs.

import type { ExerciseCondition } from "./exerciseConditions";
import { hasSetup, parseSetup, setupPayload, type Setup, type SetupFile } from "./setup";
import { newId } from "./newId";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export const DIFFICULTIES: Difficulty[] = ["EASY", "MEDIUM", "HARD"];

export interface ExerciseHint {
  id: string;
  text: string;
  /** A command of reference, shown with the tip. */
  command: string;
}

export interface Exercise {
  id: string;
  title: string;
  difficulty: Difficulty;
  /** The statement, as html. */
  description: string;
  hints: ExerciseHint[];
  /** What the teacher did in the terminal: one way to do it. */
  solution?: Setup;
  /** How it must end, whatever the way. */
  conditions: ExerciseCondition[];
}

export interface ExerciseGroup {
  /** The block this group is stored in, to keep its identity. */
  blockId?: string;
  updatedAt?: string;
  items: Exercise[];
  /** The base state of the machine before the exercises of the group. */
  setup?: Setup;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const emptyExercise = (): Exercise => ({ id: newId(), title: "", difficulty: "MEDIUM", description: "", hints: [], conditions: [] });

export function parseCondition(raw: unknown): ExerciseCondition | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const kind = str(r.kind);
  if (kind === "") return undefined;
  const condition: ExerciseCondition = { kind: kind as ExerciseCondition["kind"] };
  for (const key of ["path", "content", "mode", "owner", "group", "target", "name", "user"] as const) if (typeof r[key] === "string") condition[key] = r[key] as string;
  if (r.match === "equals" || r.match === "contains") condition.match = r.match;
  return condition;
}

/** The group stored in the payload of an EXERCISES block. */
export function parseExercises(payload: Record<string, unknown>, blockId?: string, updatedAt?: string): ExerciseGroup {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    blockId,
    updatedAt,
    setup: parseSetup(payload.setup),
    items: items.map((raw): Exercise => {
      const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      const hints = Array.isArray(r.hints) ? r.hints : [];
      return {
        id: newId(),
        title: str(r.title),
        difficulty: DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : "MEDIUM",
        description: str(r.description),
        hints: hints.map((h): ExerciseHint => ({ id: newId(), text: str((h as Record<string, unknown>)?.text), command: str((h as Record<string, unknown>)?.command) })),
        solution: parseSetup(r.solution),
        conditions: (Array.isArray(r.conditions) ? r.conditions : []).map(parseCondition).filter((c): c is ExerciseCondition => c !== undefined),
      };
    }),
  };
}

/** What is sent to the server: trimmed, without the empty parts. */
export function exercisesPayload(group: ExerciseGroup): Record<string, unknown> {
  return {
    items: group.items.map((ex) => ({
      title: ex.title.trim(),
      difficulty: ex.difficulty,
      ...(ex.description.trim() ? { description: ex.description } : {}),
      ...(ex.hints.length > 0 ? { hints: ex.hints.map((h) => ({ text: h.text.trim(), ...(h.command.trim() ? { command: h.command.trim() } : {}) })) } : {}),
      ...(hasSetup(ex.solution) ? { solution: setupPayload(ex.solution) } : {}),
      ...(ex.conditions.length > 0 ? { conditions: ex.conditions } : {}),
    })),
    ...(hasSetup(group.setup) ? { setup: setupPayload(group.setup) } : {}),
  };
}

/** Whether the group has anything to store. */
export const hasExercises = (group: ExerciseGroup | undefined): group is ExerciseGroup => Boolean(group && (group.items.length > 0 || hasSetup(group.setup)));

// ---- what the test of the card runs

/** One thing the test of a card runs on its machine: a command, the files of a solution, or the check of how an exercise ended. */
export interface TestItem {
  id: string;
  terminal: number;
  command: string;
  expectError: boolean;
  login?: { user: string; password: string };
  answers: string[];
  files?: SetupFile[];
  check?: ExerciseCondition[];
  /** Why this exercise cannot be tested (it has no recorded solution, or no condition that says how it ends); the test fails on it. */
  untestable?: "no-solution" | "no-conditions";
}

/**
 * The solution of each exercise, in order, followed by the check of how it ends (SPEC-022 RN-09): the commands the
 * teacher recorded, the files they wrote, and then the conditions of finalization. An exercise that cannot be tested (no
 * recorded solution, or no condition that says how it ends) is not skipped: it shows up in the test as a failure, so the
 * module is never "tested" with an exercise nobody checked.
 */
export function exerciseTestItems(group: ExerciseGroup | undefined): { items: TestItem[]; sections: Record<number, string> } {
  const items: TestItem[] = [];
  const sections: Record<number, string> = {};
  for (const ex of group?.items ?? []) {
    sections[items.length] = `Exercício: ${ex.title.trim() || "sem título"}`;
    if (!hasSetup(ex.solution)) {
      items.push({ id: newId(), terminal: 1, command: "(sem solução gravada: grave como fazer o exercício no terminal para poder testá-lo)", expectError: false, answers: [], untestable: "no-solution" });
      continue;
    }
    for (const step of ex.solution.steps) {
      items.push({ id: newId(), terminal: step.terminal ?? 1, command: step.command, expectError: false, login: step.login, answers: step.answers ?? [] });
    }
    if ((ex.solution.files?.length ?? 0) > 0) {
      const files = ex.solution.files!;
      items.push({ id: newId(), terminal: 1, command: `(${files.length} ${files.length === 1 ? "arquivo" : "arquivos"} da solução)`, expectError: false, answers: [], files });
    }
    if (ex.conditions.length > 0) {
      items.push({ id: newId(), terminal: 1, command: `(conferir como o exercício termina: ${ex.conditions.length} ${ex.conditions.length === 1 ? "condição" : "condições"})`, expectError: false, answers: [], check: ex.conditions });
    } else {
      items.push({ id: newId(), terminal: 1, command: "(sem condições de término: defina como o exercício termina para poder conferi-lo)", expectError: false, answers: [], untestable: "no-conditions" });
    }
  }
  return { items, sections };
}

/** Everything the test of a card runs after the snapshots: its commands, then the solutions of its exercises and how they end. */
export function cardTestItems(card: { commands: TestItem[]; exercises?: ExerciseGroup }): { items: TestItem[]; exerciseSections: Record<number, string> } {
  const solutions = exerciseTestItems(card.exercises);
  const exerciseSections: Record<number, string> = {};
  for (const [at, label] of Object.entries(solutions.sections)) exerciseSections[card.commands.length + Number(at)] = label;
  return { items: [...card.commands, ...solutions.items], exerciseSections };
}
