import type { ExerciseCondition } from "@/lib/exerciseConditions";
import {
  parseCondition,
  type Difficulty,
  type Exercise,
  type ExerciseHint,
} from "@/lib/exercises";
import { withChains } from "@/lib/exerciseChain";
import { newId } from "@/lib/newId";
import { hasSetup, parseSetup, setupPayload, type Setup } from "@/lib/setup";
import { httpClient, type HttpClient } from "./httpClient";

export type ExerciseStatus = "DRAFT" | "PUBLISHED";

/** Where an exercise of the bank is linked (SPEC-023 rev. 2): the practice of the module, the assessment, or both; none is "not linked". */
export interface ExerciseLinks {
  practice: boolean;
  assessment: boolean;
  /** Only in the assessment: it never shows in the practice. */
  exclusive: boolean;
}

/** An exercise of the bank of a module, as the teacher sees it: the editable exercise and where it stands (SPEC-023 5, 11). */
export interface ModuleExercise extends ExerciseLinks {
  exercise: Exercise;
  status: ExerciseStatus;
  /** Its place in the practice trail, 0 when it is not in the practice. */
  position: number;
  mandatory: boolean;
  /** The instant to send back when saving, to detect a change by someone else. */
  updatedAt: string;
  createdAt: string;
  createdBy: string;
  updatedBy: string;
  /** The exercise whose solution is built before this one (SPEC-023 12.3), or null. */
  dependsOn: string | null;
  /** Came from the initial load: it has no solution recorded nor conditions in the form of the editor. */
  legacy: boolean;
}

export interface ExerciseBank {
  items: ModuleExercise[];
  /** The single snapshot of the bank (SPEC-023 11.2). */
  bankSetup?: Setup;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** An exercise as the server returns it, as the editable model. */
export function parseModuleExercise(
  raw: Record<string, unknown>,
): ModuleExercise {
  const hints = Array.isArray(raw.hints) ? raw.hints : [];
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  const solution = parseSetup(raw.solution);
  return {
    exercise: {
      id: str(raw.id),
      title: str(raw.title),
      difficulty: (["EASY", "MEDIUM", "HARD"].includes(str(raw.difficulty))
        ? raw.difficulty
        : "MEDIUM") as Difficulty,
      description: str(raw.statement),
      hints: hints.map((h): ExerciseHint => ({
        id: newId(),
        text: str((h as Record<string, unknown>)?.text),
        command: str((h as Record<string, unknown>)?.command),
      })),
      solution: hasSetup(solution) ? solution : undefined,
      conditions: conditions
        .map(parseCondition)
        .filter((c): c is ExerciseCondition => c !== undefined),
    },
    practice: raw.practice === true,
    assessment: raw.assessment === true,
    exclusive: raw.exclusive === true,
    status: raw.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    position: typeof raw.position === "number" ? raw.position : 0,
    mandatory: raw.mandatory === true,
    updatedAt: str(raw.updatedAt),
    createdAt: str(raw.createdAt),
    createdBy: str(raw.createdBy),
    updatedBy: str(raw.updatedBy),
    dependsOn: str(raw.dependsOn) || null,
    legacy: raw.legacy === true,
  };
}

/** What is sent to create or save an exercise. */
export function exerciseBody(
  exercise: Exercise,
  dependsOn: string | null = null,
): Record<string, unknown> {
  return {
    title: exercise.title.trim(),
    difficulty: exercise.difficulty,
    statement: exercise.description,
    hints: exercise.hints.map((h) =>
      h.command.trim()
        ? { text: h.text.trim(), command: h.command.trim() }
        : { text: h.text.trim() },
    ),
    ...(hasSetup(exercise.solution)
      ? { solution: setupPayload(exercise.solution) }
      : {}),
    conditions: exercise.conditions,
    dependsOn,
  };
}

/** The exercises that run in a test, by the sets they are linked to; a draft is still being written, so it is counted but not run. */
export function bankToTest(bank: ExerciseBank): {
  practice: Exercise[];
  assessment: Exercise[];
  drafts: number;
} {
  const links = bank.items.map((it) => ({ id: it.exercise.id, title: it.exercise.title, dependsOn: it.dependsOn }));
  const byId = new Map(bank.items.map((it) => [it.exercise.id, it]));
  // Each exercise comes after the ones it depends on, so the machine of the test already has what they left (SPEC-023 12.3).
  const published = (set: "practice" | "assessment") =>
    withChains(
      bank.items
        .filter((it) => it[set] && it.status === "PUBLISHED")
        .sort((a, b) => a.position - b.position)
        .map((it) => it.exercise.id),
      links,
    )
      .order.map((id) => byId.get(id)!)
      .filter((it) => it.status === "PUBLISHED")
      .map((it) => it.exercise);
  return {
    practice: published("practice"),
    assessment: published("assessment"),
    drafts: bank.items.filter((it) => it.status === "DRAFT").length,
  };
}

/** What the result of the test of the module depends on in the bank, so a change makes the result stale; empty when the bank is. */
export function bankTestKey(bank: ExerciseBank): string {
  const { practice, assessment } = bankToTest(bank);
  if (practice.length === 0 && assessment.length === 0 && !hasSetup(bank.bankSetup)) return "";
  const ex = (e: Exercise) => [
    e.id,
    hasSetup(e.solution) ? setupPayload(e.solution) : null,
    e.conditions,
    bank.items.find((it) => it.exercise.id === e.id)?.dependsOn ?? null,
  ];
  return JSON.stringify({
    p: practice.map(ex),
    a: assessment.map(ex),
    s: hasSetup(bank.bankSetup) ? setupPayload(bank.bankSetup) : null,
  });
}

/** Routes of the exercises of the module (SPEC-023 5), for ADMIN and the TEACHER who owns the module. */
export function createModuleExerciseService(client: HttpClient = httpClient) {
  const base = (moduleId: string) =>
    `/teacher/modules/${encodeURIComponent(moduleId)}`;
  const one = (moduleId: string, id: string) =>
    `${base(moduleId)}/exercises/${encodeURIComponent(id)}`;

  return {
    /** The bank of the module: every exercise with where it is linked, and the snapshot. */
    bank: async (moduleId: string): Promise<ExerciseBank> => {
      const r = await client.get<{ items: Record<string, unknown>[]; bankSetup?: unknown }>(`${base(moduleId)}/exercises`);
      const bankSetup = parseSetup(r.bankSetup);
      return { items: r.items.map(parseModuleExercise), bankSetup: hasSetup(bankSetup) ? bankSetup : undefined };
    },
    get: async (moduleId: string, id: string) => parseModuleExercise(await client.get<Record<string, unknown>>(one(moduleId, id))),
    /** Creates it in the bank, already linked to `links` when it was created from a block. */
    create: async (moduleId: string, exercise: Exercise, dependsOn: string | null = null, links?: Partial<ExerciseLinks>) =>
      parseModuleExercise(
        await client.post<Record<string, unknown>>(`${base(moduleId)}/exercises`, {
          ...exerciseBody(exercise, dependsOn),
          ...(links ? { links } : {}),
        }),
      ),
    /** Saves it; `force` writes over what someone else changed in the meantime. */
    update: async (moduleId: string, id: string, exercise: Exercise, updatedAt: string, force = false, dependsOn: string | null = null) =>
      parseModuleExercise(
        await client.put<Record<string, unknown>>(one(moduleId, id), {
          ...exerciseBody(exercise, dependsOn),
          ...(force ? { force: true } : { updatedAt }),
        }),
      ),
    /** Links it to the practice and/or the assessment (or takes it off), and publishes it or takes it back to draft. */
    links: async (moduleId: string, id: string, links: ExerciseLinks, status: ExerciseStatus) =>
      parseModuleExercise(await client.put<Record<string, unknown>>(`${one(moduleId, id)}/links`, { ...links, status })),
    remove: async (moduleId: string, id: string) => {
      await client.delete<void>(one(moduleId, id));
    },
    /** The order of the practice trail and which exercises are mandatory; the list is exactly the ones in the practice. */
    order: async (moduleId: string, items: { exerciseId: string; mandatory: boolean }[]) => {
      await client.put<void>(`${base(moduleId)}/exercises/order`, { items });
    },
    /** The single snapshot of the bank; a missing one is removed. */
    setup: async (moduleId: string, bankSetup?: Setup) => {
      await client.put<unknown>(`${base(moduleId)}/exercise-setup`, { bankSetup: bankSetup && hasSetup(bankSetup) ? setupPayload(bankSetup) : null });
    },
  };
}

export type ModuleExerciseService = ReturnType<typeof createModuleExerciseService>;

export const moduleExerciseService = createModuleExerciseService();
