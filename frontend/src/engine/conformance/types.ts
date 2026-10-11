/** A command is registered in the catalog of the engine; a program is an executable that is not (SPEC-030, section 3.3). */
export type ItemKind = "command" | "program";

/** One check of the manifest: what is typed on the terminal and what is expected (SPEC-030 RN-01, RN-02). */
export interface ConformanceItem {
  name: string;
  kind: ItemKind;
  group: string;
  /** Typed before the checked command, in order; they only build the state the item needs. */
  setup?: string[];
  /** The checked command. */
  command: string;
  /** Expected exit status. Defaults to 0. */
  code?: number;
  /** A text the output must contain. */
  expect?: string;
}

export interface ItemResult {
  item: ConformanceItem;
  passed: boolean;
  /** Present on a failure: the command that failed, what was expected and what the engine answered (RN-06). */
  failure?: { command: string; expected: string; got: string };
}

export interface ConformanceReport {
  results: ItemResult[];
  passed: number;
  failed: number;
  /** Names in the catalog of the engine that have no item in the manifest. */
  uncovered: string[];
  /** True only when every item ran and passed and nothing is uncovered (RN-06). */
  conformant: boolean;
}

export interface ConformanceProgress {
  done: number;
  total: number;
  current: string;
}
