import { describe, expect, it } from "vitest";
import { manifest } from "./manifest";
import { casesOf } from "./runner";

// Covers SPEC-030 CA-17, RN-12: the depth of every suite, checked without running the engine.
describe("the suites of the manifest", () => {
  it("have, besides the --help, at least 3 cases (basic use, a variation and an expected error)", () => {
    const thin = manifest.filter((suite) => suite.cases.length < 3).map((suite) => `${suite.name} (${suite.cases.length})`);
    expect(thin, "suites with fewer than 3 cases").toEqual([]);
  });

  it("have a unique name, a group, and only cases with a command", () => {
    expect(new Set(manifest.map((suite) => suite.name)).size).toBe(manifest.length);
    expect(manifest.filter((suite) => !suite.group).map((suite) => suite.name)).toEqual([]);
    expect(manifest.flatMap((suite) => suite.cases.filter((test) => !test.command.trim()).map(() => suite.name))).toEqual([]);
  });

  // The commands the engine answers with success whatever is typed (it accepts an invalid option, or has no error to give) have no error case to write.
  // Each one is a gap of the engine, listed here so the list only shrinks: when the engine starts refusing, the suite must get its error case.
  const ACCEPTS_EVERYTHING = new Set([
    ":", "clear", "date", "df", "free", "history", "hostname", "htpasswd", "jobs", "lsb_release", "nvidia-smi", "pwd", "true", "uname", "uptime", "wait",
  ]);

  it("have an expected error case (a status other than 0), except the ones the engine answers with success to everything", () => {
    const hasError = (suite: (typeof manifest)[number]) => suite.cases.some((test) => test.code !== undefined && test.code !== 0);
    expect(manifest.filter((suite) => !ACCEPTS_EVERYTHING.has(suite.name) && !hasError(suite)).map((suite) => suite.name), "suites with no case that expects an error").toEqual([]);
    expect(manifest.filter((suite) => ACCEPTS_EVERYTHING.has(suite.name) && hasError(suite)).map((suite) => suite.name), "suites that now have an error case: take them off the list").toEqual([]);
  });

  // Covers SPEC-030 CA-25, RN-18: the volume that makes a class safe.
  it("have at least 5000 cases in all, besides the automatic --help of each command", () => {
    const total = manifest.reduce((sum, suite) => sum + suite.cases.length, 0);
    expect(total).toBeGreaterThanOrEqual(5000);
  });

  it("put the cases that close the terminal last in their suite", () => {
    for (const suite of manifest) {
      const cases = casesOf(suite);
      cases.slice(0, -1).forEach((test) => expect(test.code, `${suite.name}: ${test.command} closes the terminal and is not the last case`).not.toBeNull());
    }
  });
});
