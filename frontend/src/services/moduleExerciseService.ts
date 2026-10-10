import type { ExerciseCondition } from "@/lib/exerciseConditions";
import { parseCondition, type Difficulty, type Exercise, type ExerciseHint } from "@/lib/exercises";
import { newId } from "@/lib/newId";
import { hasSetup, parseSetup, setupPayload, type Setup } from "@/lib/setup";
import { httpClient, type HttpClient } from "./httpClient";

/** `EXERCISE`: available in the practice of the module; `ASSESSMENT`: reserved for assessments (SPEC-023). */
export type ExerciseUsage = "EXERCISE" | "ASSESSMENT";
export type ExerciseStatus = "DRAFT" | "PUBLISHED";

/** An exercise of the bank of a module, as the teacher sees it: the editable exercise and where it stands (SPEC-023 5). */
export interface ModuleExercise {
  exercise: Exercise;
  usage: ExerciseUsage;
  status: ExerciseStatus;
  /** Its place in the trail, 0 when it is reserved. */
  position: number;
  mandatory: boolean;
  /** The instant to send back when saving, to detect a change by someone else. */
  updatedAt: string;
  createdAt: string;
  createdBy: string;
  updatedBy: string;
  /** Came from the initial load: it has no solution recorded nor conditions in the form of the editor. */
  legacy: boolean;
}

export interface ExerciseBank {
  items: ModuleExercise[];
  exercisesSetup?: Setup;
  assessmentSetup?: Setup;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** An exercise as the server returns it, as the editable model. */
export function parseModuleExercise(raw: Record<string, unknown>): ModuleExercise {
  const hints = Array.isArray(raw.hints) ? raw.hints : [];
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  const solution = parseSetup(raw.solution);
  return {
    exercise: {
      id: str(raw.id),
      title: str(raw.title),
      difficulty: (["EASY", "MEDIUM", "HARD"].includes(str(raw.difficulty)) ? raw.difficulty : "MEDIUM") as Difficulty,
      description: str(raw.statement),
      hints: hints.map((h): ExerciseHint => ({ id: newId(), text: str((h as Record<string, unknown>)?.text), command: str((h as Record<string, unknown>)?.command) })),
      solution: hasSetup(solution) ? solution : undefined,
      conditions: conditions.map(parseCondition).filter((c): c is ExerciseCondition => c !== undefined),
    },
    usage: raw.usage === "EXERCISE" ? "EXERCISE" : "ASSESSMENT",
    status: raw.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    position: typeof raw.position === "number" ? raw.position : 0,
    mandatory: raw.mandatory === true,
    updatedAt: str(raw.updatedAt),
    createdAt: str(raw.createdAt),
    createdBy: str(raw.createdBy),
    updatedBy: str(raw.updatedBy),
    legacy: raw.legacy === true,
  };
}

/** What is sent to create or save an exercise. */
export function exerciseBody(exercise: Exercise): Record<string, unknown> {
  return {
    title: exercise.title.trim(),
    difficulty: exercise.difficulty,
    statement: exercise.description,
    hints: exercise.hints.map((h) => (h.command.trim() ? { text: h.text.trim(), command: h.command.trim() } : { text: h.text.trim() })),
    ...(hasSetup(exercise.solution) ? { solution: setupPayload(exercise.solution) } : {}),
    conditions: exercise.conditions,
  };
}

/** Routes of the exercises of the module (SPEC-023 5), for ADMIN and the TEACHER who owns the module. */
export function createModuleExerciseService(client: HttpClient = httpClient) {
  const base = (moduleId: string) => `/teacher/modules/${encodeURIComponent(moduleId)}`;
  const one = (moduleId: string, id: string) => `${base(moduleId)}/exercises/${encodeURIComponent(id)}`;

  return {
    /** The bank of the module: its exercises in the two sets, and the snapshot of each set. */
    bank: async (moduleId: string): Promise<ExerciseBank> => {
      const r = await client.get<{ items: Record<string, unknown>[]; exercisesSetup?: unknown; assessmentSetup?: unknown }>(`${base(moduleId)}/exercises`);
      const exercisesSetup = parseSetup(r.exercisesSetup);
      const assessmentSetup = parseSetup(r.assessmentSetup);
      return { items: r.items.map(parseModuleExercise), exercisesSetup: hasSetup(exercisesSetup) ? exercisesSetup : undefined, assessmentSetup: hasSetup(assessmentSetup) ? assessmentSetup : undefined };
    },
    get: async (moduleId: string, id: string) => parseModuleExercise(await client.get<Record<string, unknown>>(one(moduleId, id))),
    create: async (moduleId: string, exercise: Exercise) => parseModuleExercise(await client.post<Record<string, unknown>>(`${base(moduleId)}/exercises`, exerciseBody(exercise))),
    /** Saves it; `force` writes over what someone else changed in the meantime. */
    update: async (moduleId: string, id: string, exercise: Exercise, updatedAt: string, force = false) =>
      parseModuleExercise(await client.put<Record<string, unknown>>(one(moduleId, id), { ...exerciseBody(exercise), ...(force ? { force: true } : { updatedAt }) })),
    /** Makes it available or reserves it, and publishes it or takes it back to draft. */
    availability: async (moduleId: string, id: string, usage: ExerciseUsage, status: ExerciseStatus) =>
      parseModuleExercise(await client.put<Record<string, unknown>>(`${one(moduleId, id)}/availability`, { usage, status })),
    remove: async (moduleId: string, id: string) => {
      await client.delete<void>(one(moduleId, id));
    },
    /** The order of the trail and which exercises are mandatory; the list is exactly the available ones. */
    order: async (moduleId: string, items: { exerciseId: string; mandatory: boolean }[]) => {
      await client.put<void>(`${base(moduleId)}/exercises/order`, { items });
    },
    /** The snapshots of the two sets; a missing one is removed. */
    setups: async (moduleId: string, setups: { exercisesSetup?: Setup; assessmentSetup?: Setup }) => {
      await client.put<unknown>(`${base(moduleId)}/exercise-setups`, {
        exercisesSetup: setups.exercisesSetup && hasSetup(setups.exercisesSetup) ? setupPayload(setups.exercisesSetup) : null,
        assessmentSetup: setups.assessmentSetup && hasSetup(setups.assessmentSetup) ? setupPayload(setups.assessmentSetup) : null,
      });
    },
  };
}

export type ModuleExerciseService = ReturnType<typeof createModuleExerciseService>;

export const moduleExerciseService = createModuleExerciseService();
