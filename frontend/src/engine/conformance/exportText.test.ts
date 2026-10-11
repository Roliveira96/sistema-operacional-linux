import { describe, expect, it, vi } from "vitest";
import { downloadText, reportToText, transcriptFile, transcriptFilename } from "./exportText";
import type { CaseResult, ConformanceReport, SuiteResult } from "./types";

const ok = (command: string): CaseResult => ({ command, passed: true, status: 0, output: "fine", truncated: false, expected: "status 0" });
const bad = (command: string, output = "erro\nlinha dois"): CaseResult => ({ command, passed: false, status: 2, output, truncated: false, expected: 'status 0, output has "x"' });
const suite = (name: string, cases: CaseResult[], kind: "command" | "program" = "command"): SuiteResult => ({
  suite: { name, kind, group: "arquivos", cases: [] },
  passed: cases.every((test) => test.passed),
  cases,
});
const report = (suites: SuiteResult[], uncovered: string[] = []): ConformanceReport => {
  const all = suites.flatMap((s) => s.cases);
  const casesFailed = all.filter((test) => !test.passed).length;
  const failed = suites.filter((s) => !s.passed).length;
  return { suites, passed: suites.length - failed, failed, casesPassed: all.length - casesFailed, casesFailed, transcript: "$ ls\nsaida\n[exit 0 · ok]\n\n", uncovered, conformant: false };
};

// Covers SPEC-030 CA-24, RN-17: every command that was typed, as text to copy, with the ones that failed explained.
describe("reportToText", () => {
  const r = report([suite("ls", [ok("ls --help"), ok("ls -la"), bad("ls /x")]), suite("cat", [ok("cat a.txt")]), suite("sshd", [bad("sshd -x", "")], "program")], ["nproc"]);

  it("lists every command typed, in order, by suite, with its state", () => {
    const text = reportToText(r);
    expect(text).toContain("# 3 commands and programs, 5 cases: 3 passed, 2 failed");
    expect(text).toContain("# without a suite: nproc");
    expect(text).toContain("## ls (command, arquivos): 2 of 3 cases passed");
    expect(text).toContain("## sshd (program, arquivos): 0 of 1 cases passed");
    const lines = text.split("\n").filter((line) => line.startsWith("[ok]") || line.startsWith("[FAILED]"));
    expect(lines).toEqual(["[ok] $ ls --help", "[ok] $ ls -la", "[FAILED] $ ls /x", "[ok] $ cat a.txt", "[FAILED] $ sshd -x"]);
  });

  it("explains a failure with what was expected, the status and the start of the output", () => {
    const text = reportToText(r);
    expect(text).toContain('    expected: status 0, output has "x"');
    expect(text).toContain("    got: status 2");
    expect(text).toContain("      erro\n      linha dois");
    // A failure with no output has no output block.
    expect(text.split("[FAILED] $ sshd -x")[1]).not.toContain("output:");
  });

  it("cuts a long output", () => {
    const long = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const text = reportToText(report([suite("cat", [bad("cat grande", long)])]));
    expect(text).toContain("l11");
    expect(text).not.toContain("l12");
    expect(text).toContain("… (+18 lines)");
  });

  it("with only the failures lists the failing suites and their failed cases", () => {
    const text = reportToText(r, true);
    expect(text).not.toContain("cat a.txt");
    expect(text).not.toContain("ls -la");
    expect(text).toContain("[FAILED] $ ls /x");
    expect(text).toContain("[FAILED] $ sshd -x");
    expect(text.endsWith("\n")).toBe(true);
  });
});

// Covers SPEC-030 CA-26, RN-19: the file with everything the terminal printed.
describe("the terminal as a text file", () => {
  it("names the file with the date and time of the run", () => {
    expect(transcriptFilename(new Date(2026, 9, 11, 9, 5))).toBe("terminal-conformidade-2026-10-11-0905.txt");
  });

  it("has a header and then the whole transcript, with no cut", () => {
    const long = "x".repeat(5000);
    const r = { ...report([suite("cat", [ok("cat a.txt")])]), transcript: `$ cat a.txt\n${long}\n[exit 0 · ok]\n\n` };
    const text = transcriptFile(r, new Date("2026-10-11T12:00:00Z"));
    expect(text.startsWith("# Terminal of the engine conformance (SPEC-030)\n# 2026-10-11T12:00:00.000Z\n# 1 commands and programs, 1 cases: 1 passed, 0 failed")).toBe(true);
    expect(text).toContain(long);
    expect(text.endsWith("[exit 0 · ok]\n\n")).toBe(true);
  });

  it("hands the text to the browser as a file to save", () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      created.push(blob as Blob);
      return "blob:x";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("saida.txt");
      expect(this.href).toContain("blob:x");
    });
    downloadText("saida.txt", "conteudo");
    expect(click).toHaveBeenCalledTimes(1);
    expect(created[0]!.type).toContain("text/plain");
    expect(created[0]!.size).toBe(8);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
  });
});
