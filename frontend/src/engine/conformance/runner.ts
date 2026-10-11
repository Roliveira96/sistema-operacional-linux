import { SETUP_COMMANDS } from "../commands/fixtures/commands200";
import type { TerminalWindow } from "../terminalWindow";
import { catalogNames, type EngineCatalog } from "./catalog";
import type { CaseResult, ConformanceCase, ConformanceProgress, ConformanceReport, ConformanceSuite, SuiteResult } from "./types";

/** Longest a case may take (SPEC-030 RN-14). */
export const CASE_TIMEOUT_MS = 5000;

/** The output kept for the screen is cut here (SPEC-030 CA-20). */
export const OUTPUT_LIMIT = 2000;

/** The fastest speed of the terminal: the typing animation still runs, with almost no pause (SPEC-030 RN-15). */
export const FASTEST = 100;

/** The mark written on the terminal where a suite begins, so the history that stays on the screen reads in blocks. */
const mark = (suite: ConformanceSuite) => `# ${suite.kind === "command" ? "comando" : "programa"} ${suite.name}`;

/** The prepared machine every suite starts from: the lab of SPEC-028 with the common packages installed. */
export const LAB_SETUP = SETUP_COMMANDS;

export interface RunOptions {
  suites: ConformanceSuite[];
  /** The catalog to compare with; names that have no suite count as failures (RN-06). */
  catalog?: EngineCatalog;
  /** Opens the terminal window the suites run on. */
  mount(): Promise<TerminalWindow>;
  onProgress?(progress: ConformanceProgress): void;
  /** Keeps the window open after a successful run, so the history on its screen can be read and copied (SPEC-030 RN-16). */
  keepWindow?: boolean;
  /** The speed of the typing, asked before every case. Defaults to the fastest, which is what the screen uses (SPEC-030 RN-15). */
  speed?(): number;
  timeoutMs?: number;
  /** Sends every line at once, without the typing animation and its pauses (SPEC-032). */
  instant?: boolean;
  /** Stops the run at the next case when it is aborted, so a run nobody is watching (the screen was left or opened twice) does not go on sharing the engine with the next one. */
  signal?: AbortSignal;
}

class Timeout extends Error {}

/** The run was aborted: the window is closed and the caller drops the result. */
export class Aborted extends Error {}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Timeout()), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** The help of every command is the first case of its suite and must show the usage (SPEC-030 RN-03). */
const helpCase = (suite: ConformanceSuite): ConformanceCase | null => (suite.kind === "command" && suite.help !== false ? { command: `${suite.name} --help`, code: 0, expect: "Uso" } : null);

/** Every case that runs for a suite: the --help first, then the ones the suite lists. */
export const casesOf = (suite: ConformanceSuite): ConformanceCase[] => {
  const help = helpCase(suite);
  return help ? [help, ...suite.cases] : suite.cases;
};

/** Where the run writes what the terminal printed, to be exported as a text file (SPEC-030 RN-19). */
type Log = (text: string) => void;

/** One command in the transcript: the line typed, the whole output and the status. */
const entry = (command: string, output: string, status: string): string => `$ ${command}\n${output}${output === "" || output.endsWith("\n") ? "" : "\n"}[${status}]\n\n`;

async function runCase(win: TerminalWindow, test: ConformanceCase, timeoutMs: number, speed: () => number, log: Log, signal?: AbortSignal): Promise<CaseResult> {
  if (signal?.aborted) throw new Aborted();
  const expectedCode = test.code === undefined ? 0 : test.code;
  const expected = [`status ${expectedCode === null ? "none (the terminal closes)" : expectedCode}`, test.expect ? `output has "${test.expect}"` : "", test.reject ? `output has not "${test.reject}"` : ""]
    .filter(Boolean)
    .join(", ");
  win.setSpeed(speed());
  try {
    const result = await within(win.execute({ command: test.command, answers: test.answers }), timeoutMs);
    const ok = result.status === expectedCode && (!test.expect || result.output.includes(test.expect)) && (!test.reject || !result.output.includes(test.reject));
    log(entry(test.command, result.output, `${result.status === null ? "no status" : `exit ${result.status}`} · ${ok ? "ok" : "FAILED"}`));
    return { command: test.command, passed: ok, status: result.status, expected, output: result.output.slice(0, OUTPUT_LIMIT), truncated: result.output.length > OUTPUT_LIMIT };
  } catch (error) {
    if (!(error instanceof Timeout)) throw error;
    log(entry(test.command, "", `timeout after ${timeoutMs} ms · FAILED`));
    return { command: test.command, passed: false, status: null, expected: `${expected}, within ${timeoutMs} ms`, output: "timeout", truncated: false };
  }
}

/** A setup step that fails or never ends fails the suite: it is recorded, and the cases that could not run are recorded as failed (RN-06). */
async function runSuite(win: TerminalWindow, snapshot: unknown, suite: ConformanceSuite, timeoutMs: number, speed: () => number, log: Log, tick: (command: string, index: number) => void, signal?: AbortSignal): Promise<SuiteResult> {
  // The terminal keeps its screen and history from one suite to the next (RN-16); only the machine underneath is replaced.
  await win.swapMachine(snapshot, mark(suite));
  log(`${mark(suite)}\n\n`);
  const all = casesOf(suite);
  for (const entry of ["cd /tmp/lab", ...(suite.setup ?? [])]) {
    const { command, answers } = typeof entry === "string" ? { command: entry, answers: undefined } : entry;
    const result = await runCase(win, { command, answers }, timeoutMs, speed, log, signal);
    if (!result.passed) {
      const blocked = all.map((test) => ({ command: test.command, passed: false, status: null, output: "", truncated: false, expected: "not run: the setup failed" }));
      return { suite, passed: false, cases: [{ ...result, expected: `setup: ${result.expected}` }, ...blocked] };
    }
  }
  const cases: CaseResult[] = [];
  for (const test of all) {
    tick(test.command, cases.length);
    cases.push(await runCase(win, test, timeoutMs, speed, log, signal));
  }
  return { suite, passed: cases.every((result) => result.passed), cases };
}

/**
 * Runs the whole manifest on a machine made for the run (SPEC-030). Each suite starts from the same snapshot of the prepared lab, so none depends
 * on another. A case that fails or runs out of time is recorded and the next one goes on; an error of the engine itself rejects the promise, and
 * the caller must not show a seal (RN-06).
 */
export async function runConformance(options: RunOptions): Promise<ConformanceReport> {
  const timeoutMs = options.timeoutMs ?? CASE_TIMEOUT_MS;
  const speed = options.speed ?? (() => FASTEST);
  const total = options.suites.reduce((sum, suite) => sum + casesOf(suite).length, 0);
  const win = await options.mount();
  let kept = false;
  try {
    win.setInstant(Boolean(options.instant));
    for (const command of LAB_SETUP) await win.execute({ command });
    const snapshot = win.snapshot();
    const suites: SuiteResult[] = [];
    const transcript: string[] = [];
    const log: Log = (text) => transcript.push(text);
    let done = 0;
    for (const suite of options.suites) {
      suites.push(await runSuite(win, snapshot, suite, timeoutMs, speed, log, (command, index) => options.onProgress?.({ done: done + index, total, current: command }), options.signal));
      done += casesOf(suite).length;
    }
    options.onProgress?.({ done, total, current: "" });
    const covered = new Set(options.suites.map((suite) => suite.name));
    const uncovered = options.catalog ? catalogNames(options.catalog).map((entry) => entry.name).filter((name) => !covered.has(name)) : [];
    const failed = suites.filter((result) => !result.passed).length;
    const allCases = suites.flatMap((result) => result.cases);
    const casesFailed = allCases.filter((result) => !result.passed).length;
    kept = Boolean(options.keepWindow);
    return { suites, passed: suites.length - failed, failed, casesPassed: allCases.length - casesFailed, casesFailed, transcript: transcript.join(""), uncovered, conformant: failed === 0 && uncovered.length === 0 && suites.length > 0 };
  } finally {
    if (!kept) win.destroy();
  }
}
