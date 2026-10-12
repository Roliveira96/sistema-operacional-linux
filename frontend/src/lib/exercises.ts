// The group of exercises of a card (SPEC-022): the editable model, its block, and what the test of the card runs.

import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { ExerciseCondition } from "./exerciseConditions";
import { hasDescription, isMatching, isSingleChoice, MAX_CHOICES, MAX_PAIRS, MIN_CHOICES, MIN_PAIRS, parseKind, plainText, usesTerminal, type QuestionKind } from "./questionKinds";
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
  /** The kind of question (SPEC-035); missing is a practical one, solved in the terminal. */
  kind?: QuestionKind;
  title: string;
  difficulty: Difficulty;
  /** The statement, as html. */
  description: string;
  hints: ExerciseHint[];
  /** What the teacher did in the terminal: one way to do it. */
  solution?: Setup;
  /** How it must end, whatever the way. */
  conditions: ExerciseCondition[];
  /** The correct answer of a true or false question, null while the teacher has not chosen it (SPEC-035 RN-03). */
  correctAnswer?: boolean | null;
  /** The justification of a question without a terminal, as html, shown after the student answers. */
  explanation?: string;
  /** The alternatives of a single choice question, each with its stable id and its html (SPEC-036 D-01, D-02). */
  choices?: Choice[];
  /** The id of the only correct alternative, null while the teacher has not marked it. */
  correctChoice?: string | null;
  /** Shuffle the alternatives (or the columns) for the student, the default, or keep the order of the teacher (SPEC-036 D-07, SPEC-037 D-10). */
  shuffleChoices?: boolean;
  /** The columns of a matching question, each in the order of the teacher, and the correct pairs she selected (SPEC-037 D-09). */
  left?: MatchItem[];
  right?: MatchItem[];
  pairs?: MatchPair[];
}

/** One item of a column of a matching question. */
export interface MatchItem {
  id: string;
  text: string;
}

/** A link between an item of the left column and one of the right column, by their ids. */
export interface MatchPair {
  left: string;
  right: string;
}

/** One alternative of a single choice question. */
export interface Choice {
  id: string;
  html: string;
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

export const emptyExercise = (kind: QuestionKind = "PRACTICAL"): Exercise => ({
  id: newId(),
  title: "",
  difficulty: "MEDIUM",
  description: "",
  hints: [],
  conditions: [],
  ...(kind === "THEORETICAL_BOOLEAN" ? { kind, correctAnswer: null, explanation: "" } : {}),
  ...(kind === "THEORETICAL_MATCHING"
    ? {
        kind,
        left: [{ id: newId(), text: "" }, { id: newId(), text: "" }],
        right: [{ id: newId(), text: "" }, { id: newId(), text: "" }],
        pairs: [],
        shuffleChoices: true,
        explanation: "",
      }
    : {}),
  ...(kind === "THEORETICAL_SINGLE"
    ? { kind, choices: [{ id: newId(), html: "" }, { id: newId(), html: "" }], correctChoice: null, shuffleChoices: true, explanation: "" }
    : {}),
});

/** The fields of a true or false question as read from the server or from a block. */
export function trueFalseFields(r: Record<string, unknown>): Partial<Exercise> {
  const kind = parseKind(r.kind);
  if (usesTerminal(kind)) return {};
  if (isMatching(kind)) {
    const column = (raw: unknown): MatchItem[] =>
      (Array.isArray(raw) ? raw : [])
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        .map((c) => ({ id: str(c.id) || newId(), text: str(c.text) }));
    const pairs = (Array.isArray(r.pairs) ? r.pairs : [])
      .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null && str(p.left) !== "" && str(p.right) !== "")
      .map((p) => ({ left: str(p.left), right: str(p.right) }));
    return { kind, left: column(r.left), right: column(r.right), pairs, shuffleChoices: r.shuffleChoices !== false, explanation: str(r.explanation) };
  }
  if (isSingleChoice(kind)) {
    const choices = (Array.isArray(r.choices) ? r.choices : [])
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => ({ id: str(c.id) || newId(), html: str(c.html) }));
    return {
      kind,
      choices,
      correctChoice: str(r.correctChoice) || null,
      shuffleChoices: r.shuffleChoices !== false,
      explanation: str(r.explanation),
    };
  }
  return { kind, correctAnswer: typeof r.correctAnswer === "boolean" ? r.correctAnswer : null, explanation: str(r.explanation) };
}

/** What a question without a terminal can still miss. */
export type MissingAnswer =
  | "statement"
  | "correctAnswer"
  | "choices"
  | "choiceEmpty"
  | "choiceRepeated"
  | "correctChoice"
  | "columns"
  | "itemEmpty"
  | "itemRepeated"
  | "pairs";

/** What a question without a terminal still needs to be published, or to be part of a test (SPEC-035 RN-04, SPEC-036 RN-04). */
export function missingAnswer(ex: Exercise): MissingAnswer[] {
  if (usesTerminal(ex.kind)) return [];
  const missing: MissingAnswer[] = [];
  if (!hasDescription(ex.description)) missing.push("statement");
  if (isMatching(ex.kind)) {
    const left = ex.left ?? [];
    const right = ex.right ?? [];
    if (left.length < MIN_PAIRS || left.length > MAX_PAIRS || right.length !== left.length) missing.push("columns");
    if ([...left, ...right].some((it) => it.text.trim() === "")) missing.push("itemEmpty");
    const repeated = (items: MatchItem[]) => {
      const texts = items.map((it) => plainText(it.text)).filter((t) => t !== "");
      return new Set(texts).size !== texts.length;
    };
    if (repeated(left) || repeated(right)) missing.push("itemRepeated");
    const pairs = ex.pairs ?? [];
    const paired = new Set(pairs.map((p) => p.left));
    if (pairs.length !== left.length || left.some((it) => !paired.has(it.id))) missing.push("pairs");
    return missing;
  }
  if (!isSingleChoice(ex.kind)) {
    if (typeof ex.correctAnswer !== "boolean") missing.push("correctAnswer");
    return missing;
  }
  const choices = ex.choices ?? [];
  if (choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) missing.push("choices");
  if (choices.some((c) => !hasDescription(c.html))) missing.push("choiceEmpty");
  const texts = choices.map((c) => plainText(c.html)).filter((t) => t !== "");
  if (new Set(texts).size !== texts.length) missing.push("choiceRepeated");
  if (!ex.correctChoice || !choices.some((c) => c.id === ex.correctChoice)) missing.push("correctChoice");
  return missing;
}

export function parseCondition(raw: unknown): ExerciseCondition | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const kind = str(r.kind);
  if (kind === "") return undefined;
  const condition: ExerciseCondition = { kind: kind as ExerciseCondition["kind"] };
  for (const key of ["path", "content", "mode", "owner", "group", "target", "name", "user"] as const) if (typeof r[key] === "string") condition[key] = r[key] as string;
  if (r.match === "equals" || r.match === "contains") condition.match = r.match;
  for (const key of ["signal", "nice"] as const) if (typeof r[key] === "number" && Number.isFinite(r[key])) condition[key] = r[key] as number;
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
        ...trueFalseFields(r),
      };
    }),
  };
}

/** What is sent to the server: trimmed, without the empty parts. */
export function exercisesPayload(group: ExerciseGroup): Record<string, unknown> {
  return {
    items: group.items.map((ex) => ({
      ...(usesTerminal(ex.kind) ? {} : { kind: ex.kind }),
      title: ex.title.trim(),
      difficulty: ex.difficulty,
      ...(ex.description.trim() ? { description: ex.description } : {}),
      ...(ex.hints.length > 0 ? { hints: ex.hints.map((h) => ({ text: h.text.trim(), ...(h.command.trim() ? { command: h.command.trim() } : {}) })) } : {}),
      ...(usesTerminal(ex.kind)
        ? {
            ...(hasSetup(ex.solution) ? { solution: setupPayload(ex.solution) } : {}),
            ...(ex.conditions.length > 0 ? { conditions: ex.conditions } : {}),
          }
        : {
            ...(typeof ex.correctAnswer === "boolean" ? { correctAnswer: ex.correctAnswer } : {}),
            ...(isMatching(ex.kind) ? { left: ex.left ?? [], right: ex.right ?? [], pairs: ex.pairs ?? [], shuffleChoices: ex.shuffleChoices !== false } : {}),
            ...(isSingleChoice(ex.kind)
              ? { choices: ex.choices ?? [], ...(ex.correctChoice ? { correctChoice: ex.correctChoice } : {}), shuffleChoices: ex.shuffleChoices !== false }
              : {}),
            ...(ex.explanation?.trim() ? { explanation: ex.explanation } : {}),
          }),
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
  /** Why this exercise cannot be tested (it has no recorded solution, or no condition that says how it ends, or a true or false
   * question misses its answer); the test fails on it. */
  untestable?: "no-solution" | "no-conditions" | "no-answer";
  /** A question without a terminal that is complete: nothing runs and it passes (SPEC-035 RN-09). */
  noTerminal?: boolean;
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
    if (!usesTerminal(ex.kind)) {
      // A question without a terminal is only checked for being complete (SPEC-035 RN-09).
      const missing = missingAnswer(ex);
      items.push(
        missing.length === 0
          ? { id: newId(), terminal: 1, command: noTerminal.complete, expectError: false, answers: [], noTerminal: true }
          : { id: newId(), terminal: 1, command: noTerminal.incomplete(missing), expectError: false, answers: [], untestable: "no-answer" },
      );
      continue;
    }
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

const noTerminal = authoringMessages.questionKinds.test;

/** Everything the test of a card runs after the snapshots: its commands, then the solutions of its exercises and how they end. */
export function cardTestItems(card: { commands: TestItem[]; exercises?: ExerciseGroup }): { items: TestItem[]; exerciseSections: Record<number, string> } {
  const solutions = exerciseTestItems(card.exercises);
  const exerciseSections: Record<number, string> = {};
  for (const [at, label] of Object.entries(solutions.sections)) exerciseSections[card.commands.length + Number(at)] = label;
  return { items: [...card.commands, ...solutions.items], exerciseSections };
}
