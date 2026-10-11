import type { CaseResult, ConformanceReport, SuiteResult } from "./types";

const OUTPUT_LINES = 12;

/** The first lines of what the engine printed, indented, so a failure can be read (and sent) without the whole output. */
const outputOf = (test: CaseResult): string => {
  const lines = test.output.split("\n").filter((line) => line.trim() !== "");
  const shown = lines.slice(0, OUTPUT_LINES).map((line) => `      ${line}`);
  if (lines.length > OUTPUT_LINES) shown.push(`      … (+${lines.length - OUTPUT_LINES} lines)`);
  return shown.join("\n");
};

const caseText = (test: CaseResult): string => {
  if (test.passed) return `[ok] $ ${test.command}`;
  const status = test.status === null ? "none" : String(test.status);
  const output = outputOf(test);
  return [`[FAILED] $ ${test.command}`, `    expected: ${test.expected}`, `    got: status ${status}`, ...(output ? [`    output:`, output] : [])].join("\n");
};

const suiteText = (result: SuiteResult, onlyFailures: boolean): string => {
  const cases = onlyFailures ? result.cases.filter((test) => !test.passed) : result.cases;
  const passed = result.cases.filter((test) => test.passed).length;
  const kind = result.suite.kind === "command" ? "command" : "program";
  return [`## ${result.suite.name} (${kind}, ${result.suite.group}): ${passed} of ${result.cases.length} cases passed`, ...cases.map(caseText)].join("\n");
};

/**
 * The commands of the verification as plain text, to copy and export (SPEC-030 RN-17): every command that was typed, in order, grouped by command or
 * program, with `[ok]` or `[FAILED]` and, for the ones that failed, what was expected, the status and the start of what the engine printed. With
 * `onlyFailures` only the suites that failed appear, and only their failed cases.
 */
export function reportToText(report: ConformanceReport, onlyFailures = false): string {
  const total = report.casesPassed + report.casesFailed;
  const head = [
    "# Engine conformance (SPEC-030)",
    `# ${report.suites.length} commands and programs, ${total} cases: ${report.casesPassed} passed, ${report.casesFailed} failed`,
    ...(report.uncovered.length > 0 ? [`# without a suite: ${report.uncovered.join(", ")}`] : []),
  ];
  const suites = report.suites.filter((result) => !onlyFailures || !result.passed);
  return [head.join("\n"), ...suites.map((result) => suiteText(result, onlyFailures))].join("\n\n").concat("\n");
}

/** The name of the file with the terminal, with the moment of the run: terminal-conformidade-2026-10-11-1130.txt. */
export const transcriptFilename = (now: Date = new Date()): string => {
  const two = (n: number) => String(n).padStart(2, "0");
  return `terminal-conformidade-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}.txt`;
};

/** The text of the file with everything the terminal printed, with a header that says what it is and how the run ended (SPEC-030 RN-19). */
export function transcriptFile(report: ConformanceReport, now: Date = new Date()): string {
  const total = report.casesPassed + report.casesFailed;
  const head = [
    "# Terminal of the engine conformance (SPEC-030)",
    `# ${now.toISOString()}`,
    `# ${report.suites.length} commands and programs, ${total} cases: ${report.casesPassed} passed, ${report.casesFailed} failed`,
    "# each block: the line typed, what the terminal printed and [exit status · ok|FAILED]",
  ];
  return `${head.join("\n")}\n\n${report.transcript}`;
}

/** Hands the text to the browser as a file to save (a Blob behind a temporary link). */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
