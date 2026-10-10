// "Testar Banco de Exercícios" (SPEC-023 12): the three batteries over the published exercises of the bank, the search for the
// dependencies nobody declared, and the report. The machine is behind a `Sandbox`, so the logic runs without the terminal.

import { ancestors, withChains, type ChainLink } from "./exerciseChain";
import type { ExerciseCondition } from "./exerciseConditions";
import type { Setup } from "./setup";

/** An exercise of the bank as the test sees it. */
export interface BankItem {
  id: string;
  title: string;
  /** The declared antecessor, or null. */
  dependsOn: string | null;
  solution?: Setup;
  conditions: ExerciseCondition[];
}

/** The machine of a test, already holding the snapshot of the module and the one of the bank (SPEC-023 12.1). */
export interface Sandbox {
  /** Back to the machine the snapshots left, at once. */
  reset(): Promise<void>;
  /** Runs the commands of a solution; false when one of them failed. */
  solve(setup: Setup): Promise<boolean>;
  /** Whether the machine ended as the conditions ask. */
  holds(conditions: ExerciseCondition[]): boolean;
}

export type Phase = "linear" | "reverse" | "random";

export interface RunResult {
  id: string;
  ok: boolean;
}

/** One run on one machine: the exercises in the order they were done. */
export interface Round {
  phase: Phase;
  order: string[];
  /** The exercises the draw brought in because another one depends on them (SPEC-023 D-18). */
  pulled: { id: string; by: string }[];
  results: RunResult[];
}

export interface Dependency {
  id: string;
  on: string;
}

export interface BankReport {
  /** `failed` when some exercise conflicts, cannot be tested or does not resolve alone. */
  status: "ok" | "failed";
  seed: number;
  rounds: Round[];
  /** The exercises with no solution or no conditions recorded: they fail the test and are not run. */
  untestable: string[];
  /** The ones that failed in some round. */
  conflicts: string[];
  /** The ones that fail even alone, after the chain they declare, and for which no other exercise helps. */
  isolated: string[];
  /** What the search found: `id` passes after the solution of `on`. The teacher confirms or dismisses. */
  suggested: Dependency[];
  /** The dependencies already declared. */
  declared: Dependency[];
}

/** How many rounds the draw makes: half the exercises, at least 1 and at most 5 (SPEC-023 D-15). */
export const roundsFor = (count: number) => Math.min(5, Math.max(1, Math.ceil(count / 2)));
/** How many exercises each round brings: half of the bank, rounded up. */
export const perRound = (count: number) => Math.ceil(count / 2);

/** A small seeded generator, so a draw can be repeated from the seed shown in the report. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` ids drawn without repeating, in the order drawn. */
export function draw(ids: string[], count: number, random: () => number): string[] {
  const pool = [...ids];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  return out;
}

export interface BankTestOptions {
  seed?: number;
  /** Called as the test goes on, to show where it is. */
  onProgress?: (done: number, total: number, label: string) => void;
}

/**
 * Runs the batteries over `items`, which come in the order of the trail. A solution that fails to run, or conditions that do not hold
 * after it, make the exercise fail in that round. Each round starts on a fresh machine.
 */
export async function testBank(items: BankItem[], sandbox: Sandbox, options: BankTestOptions = {}): Promise<BankReport> {
  const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
  const random = seeded(seed);
  const runnable = items.filter((it) => it.solution && it.solution.steps.length + (it.solution.files?.length ?? 0) > 0 && it.conditions.length > 0);
  const untestable = items.filter((it) => !runnable.includes(it)).map((it) => it.id);
  const byId = new Map(runnable.map((it) => [it.id, it]));
  const links: ChainLink[] = items.map((it) => ({ id: it.id, title: it.title, dependsOn: it.dependsOn, solution: it.solution }));
  const known = (ids: string[]) => ids.filter((id) => byId.has(id));
  const baseOrder = runnable.map((it) => it.id);

  // Every round: a fresh machine, then each exercise's solution and a look at how it ended.
  const runOrder = async (order: string[]): Promise<RunResult[]> => {
    await sandbox.reset();
    const results: RunResult[] = [];
    for (const id of order) {
      const it = byId.get(id)!;
      const ran = await sandbox.solve(it.solution!);
      results.push({ id, ok: ran && sandbox.holds(it.conditions) });
    }
    return results;
  };

  const plan: { phase: Phase; order: string[]; pulled: Round["pulled"] }[] = [];
  const linear = withChains(baseOrder, links);
  plan.push({ phase: "linear", order: known(linear.order), pulled: [] });
  plan.push({ phase: "reverse", order: known(withChains([...baseOrder].reverse(), links).order), pulled: [] });
  const rounds = baseOrder.length === 0 ? 0 : roundsFor(baseOrder.length);
  for (let i = 0; i < rounds; i++) {
    const drawn = withChains(draw(baseOrder, perRound(baseOrder.length), random), links);
    plan.push({ phase: "random", order: known(drawn.order), pulled: drawn.pulled });
  }

  const total = plan.length;
  const done: Round[] = [];
  for (const [i, step] of plan.entries()) {
    options.onProgress?.(i, total, step.phase);
    done.push({ ...step, results: await runOrder(step.order) });
  }

  const conflicts = [...new Set(done.flatMap((r) => r.results.filter((x) => !x.ok).map((x) => x.id)))];

  // Why does it fail: alone, after the chain it declares; and, if it still fails, after the solution of whom.
  const alone = async (id: string) => (await runOrder(known(withChains([id], links).order))).at(-1)?.ok === true;
  const suggested: Dependency[] = [];
  const isolated: string[] = [];
  for (const id of conflicts) {
    options.onProgress?.(total, total + conflicts.length, "dependencies");
    if (await alone(id)) continue;
    let found = false;
    for (const other of baseOrder) {
      if (other === id || ancestors(links, id).some((a) => a.id === other)) continue;
      // Whoever already depends on this one cannot be its antecessor: it would close a cycle.
      if (ancestors(links, other).some((a) => a.id === id)) continue;
      const results = await runOrder([...known(withChains([other], links).order), id]);
      if (results.at(-1)?.ok) {
        suggested.push({ id, on: other });
        found = true;
        break;
      }
    }
    if (!found) isolated.push(id);
  }

  const declared = items.filter((it) => it.dependsOn).map((it) => ({ id: it.id, on: it.dependsOn! }));
  const status = conflicts.length === 0 && untestable.length === 0 ? "ok" : "failed";
  return { status, seed, rounds: done, untestable, conflicts, isolated, suggested, declared };
}
