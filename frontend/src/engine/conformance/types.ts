/** A command is registered in the catalog of the engine; a program is an executable that is not (SPEC-030, section 3.3). */
export type ItemKind = "command" | "program";

/** A setup command that asks questions, with the answers typed to them. */
export interface SetupStep {
  command: string;
  answers: string[];
}

/** One line typed on the terminal and what is expected of it (SPEC-030 RN-11). */
export interface ConformanceCase {
  /** The line typed on the terminal, for example `ls -la /tmp/lab`. */
  command: string;
  /** Answers typed to the questions the command asks (passwords). */
  answers?: string[];
  /** Expected exit status. Defaults to 0; null means the terminal closed and gave no status (exit, logout). */
  code?: number | null;
  /** A text the output must contain. */
  expect?: string;
  /** A text the output must not contain. */
  reject?: string;
}

/**
 * The suite of a command or program: the cases that run in order on one machine, each one may lean on the ones before it (SPEC-030 RN-11).
 * Every suite starts from the same prepared lab, so suites do not depend on each other (RN-14).
 */
export interface ConformanceSuite {
  name: string;
  kind: ItemKind;
  group: string;
  /** Typed before the cases, in order; they only build the state the suite needs. */
  setup?: Array<string | SetupStep>;
  /** The cases, in order. The --help of a command runs first on its own and is not listed here. */
  cases: ConformanceCase[];
  /** False for the commands that have no --help on Linux either (echo, true, [...]). Defaults to true. */
  help?: boolean;
}

export interface CaseResult {
  command: string;
  passed: boolean;
  /** The exit status the engine gave, or null when the terminal gave none. */
  status: number | null;
  /** What the engine printed, cut at the limit of the report. */
  output: string;
  truncated: boolean;
  /** What was expected, in words. */
  expected: string;
}

export interface SuiteResult {
  suite: ConformanceSuite;
  passed: boolean;
  /** Every case that ran, the --help first (SPEC-030 RN-13). */
  cases: CaseResult[];
}

export interface ConformanceReport {
  suites: SuiteResult[];
  /** Suites with every case passing, and suites with some case failing. */
  passed: number;
  failed: number;
  casesPassed: number;
  casesFailed: number;
  /** Everything the terminal printed during the run, in order, with no cut: each command, its whole output and its status (SPEC-030 RN-19). */
  transcript: string;
  /** Names in the catalog of the engine that have no suite in the manifest. */
  uncovered: string[];
  /** True only when every case ran and passed and nothing is uncovered (RN-06). */
  conformant: boolean;
}

export interface ConformanceProgress {
  /** Cases done and in all, the command being typed. */
  done: number;
  total: number;
  current: string;
}
