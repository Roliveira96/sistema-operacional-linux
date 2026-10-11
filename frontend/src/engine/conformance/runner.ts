import { SETUP_COMMANDS } from "../commands/fixtures/commands200";
import type { TerminalWindow } from "../terminalWindow";
import { catalogNames, type EngineCatalog } from "./catalog";
import type { ConformanceItem, ConformanceProgress, ConformanceReport, ItemResult } from "./types";

/** Longest an item may take (SPEC-030 RN-04). */
export const ITEM_TIMEOUT_MS = 5000;

/** The output kept on a failure is cut here so a flood does not fill the screen (SPEC-030 section 3.1). */
const OUTPUT_LIMIT = 300;

/** The prepared machine every item starts from: the lab of SPEC-028 with the common packages installed. */
export const LAB_SETUP = SETUP_COMMANDS;

export interface RunOptions {
  items: ConformanceItem[];
  /** The catalog to compare with; names that have no item count as failures (RN-06). */
  catalog?: EngineCatalog;
  /** Opens the terminal window the items run on. */
  mount(): Promise<TerminalWindow>;
  onProgress?(progress: ConformanceProgress): void;
  timeoutMs?: number;
}

class Timeout extends Error {}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Timeout()), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** The help of every command runs along with its item and must show the usage (SPEC-030 RN-03). */
const helpStep = (item: ConformanceItem): ConformanceItem | null =>
  item.kind === "command" && item.help !== false ? { ...item, command: `${item.name} --help`, answers: undefined, code: 0, expect: undefined } : null;

async function runItem(win: TerminalWindow, snapshot: unknown, item: ConformanceItem, timeoutMs: number): Promise<ItemResult> {
  const check = async (step: ConformanceItem, fresh: boolean): Promise<ItemResult["failure"]> => {
    if (fresh) win.reset(snapshot);
    let result;
    let current = step.command;
    try {
      for (const entry of fresh ? ["cd /tmp/lab", ...(step.setup ?? [])] : []) {
        const { command, answers } = typeof entry === "string" ? { command: entry, answers: undefined } : entry;
        current = command;
        await within(win.execute({ command, answers }), timeoutMs);
      }
      current = step.command;
      result = await within(win.execute({ command: step.command, answers: step.answers }), timeoutMs);
    } catch (error) {
      if (error instanceof Timeout) return { command: current, expected: `ends within ${timeoutMs} ms`, got: "timeout" };
      throw error;
    }
    const expectedCode = step.code === undefined ? 0 : step.code;
    const expectedText = step.expect ?? (step.command.endsWith("--help") ? "Uso" : undefined);
    const textOk = expectedText === undefined || result.output.includes(expectedText);
    if (result.status === expectedCode && textOk) return undefined;
    const expected = `status ${expectedCode}${expectedText ? ` and "${expectedText}"` : ""}`;
    return { command: step.command, expected, got: `status ${result.status}: ${result.output.slice(0, OUTPUT_LIMIT)}` };
  };
  // The help only needs a clean machine when the item built a state of its own (setup) or closed the terminal (exit, logout).
  const failure = (await check(item, true)) ?? (helpStep(item) ? await check(helpStep(item)!, Boolean(item.setup?.length) || item.code === null) : undefined);
  return failure ? { item, passed: false, failure } : { item, passed: true };
}

/**
 * Runs the whole manifest on a machine made for the run (SPEC-030). Each item starts from the same snapshot of the prepared lab, so none depends
 * on another. An item that fails or runs out of time is recorded and the next one goes on; an error of the engine itself rejects the promise, and
 * the caller must not show a seal (RN-06).
 */
export async function runConformance(options: RunOptions): Promise<ConformanceReport> {
  const timeoutMs = options.timeoutMs ?? ITEM_TIMEOUT_MS;
  const win = await options.mount();
  try {
    win.setSpeed(100);
    for (const command of LAB_SETUP) await win.execute({ command });
    const snapshot = win.snapshot();
    const results: ItemResult[] = [];
    for (const item of options.items) {
      options.onProgress?.({ done: results.length, total: options.items.length, current: item.name });
      results.push(await runItem(win, snapshot, item, timeoutMs));
    }
    options.onProgress?.({ done: results.length, total: options.items.length, current: "" });
    const covered = new Set(options.items.map((item) => item.name));
    const uncovered = options.catalog ? catalogNames(options.catalog).map((entry) => entry.name).filter((name) => !covered.has(name)) : [];
    const failed = results.filter((result) => !result.passed).length;
    return { results, passed: results.length - failed, failed, uncovered, conformant: failed === 0 && uncovered.length === 0 && results.length > 0 };
  } finally {
    win.destroy();
  }
}
