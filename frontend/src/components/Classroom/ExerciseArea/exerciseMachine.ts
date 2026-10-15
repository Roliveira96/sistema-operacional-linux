import type { ExerciseCondition } from "@/lib/exerciseConditions";
import { allLayers, hasSetup, parseSetup, type SetupLayer } from "@/lib/setup";
import type { LiveModuleContent } from "@/services/classroomService";

/** The exercise of a round as the module of the class has it: what the student reads, how it ends, and how the teacher did it (SPEC-065). The title and the level are the round's. */
export interface RoundExercise {
  /** The statement, as html the server already filtered. */
  description: string;
  conditions: ExerciseCondition[];
  /** The commands the teacher typed and the files he wrote, as texts. */
  solution: { commands: string[]; files: string[] };
}

export interface ExerciseSetup {
  item: RoundExercise;
  /** The machine the module starts from: null is the default machine. */
  scenario: unknown;
  /** What prepares the machine, in order, as the study screen does for the exercise (SPEC-065 CA-02). */
  layers: SetupLayer[];
}

interface RawItem {
  description?: unknown;
  conditions?: unknown;
  solution?: unknown;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * The exercise at `index` of the group of exercises `blockId`, with the machine to prepare for it: the scenario of the module, then the snapshots
 * of the module and of the cards up to this one, the one of the group and the solutions of the exercises before this one in the group. The layers
 * are the ones the study screen makes (`allLayers`), cut at the group. Null when the module has no such group or exercise.
 */
export function exerciseSetup(module: LiveModuleContent, blockId: string, index: number): ExerciseSetup | null {
  const at = module.blocks.findIndex((block) => block.id === blockId);
  const block = module.blocks[at];
  if (!block || block.type !== "EXERCISES") return null;
  const items = list(block.payload.items) as RawItem[];
  const raw = items[index];
  if (!raw) return null;

  const earlier: SetupLayer[] = items.slice(0, index).flatMap((previous, i) => {
    const setup = parseSetup(previous.solution);
    return hasSetup(setup) ? [{ id: `solution-${i}`, kind: "card" as const, label: `Solução do exercício anterior ${i + 1}`, setup }] : [];
  });
  const solution = parseSetup(raw.solution);
  return {
    scenario: module.scenario,
    layers: [...allLayers(parseSetup(module.setup), module.blocks.slice(0, at + 1)), ...earlier],
    item: {
      description: text(raw.description),
      conditions: list(raw.conditions) as ExerciseCondition[],
      solution: { commands: (solution?.steps ?? []).map((step) => step.command), files: (solution?.files ?? []).map((file) => file.path) },
    },
  };
}
