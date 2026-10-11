import { describe, expect, it, vi } from "vitest";
import type { CommandResult, TerminalStep, TerminalWindow } from "../terminalWindow";
import { OUTPUT_LIMIT, runConformance } from "./runner";
import type { ConformanceCase, ConformanceSuite } from "./types";

type Answer = CommandResult | "hang" | "throw";

/** A terminal window that answers from a table: the commands not in it succeed and print a usage line. */
function fakeWindow(answers: Record<string, Answer> = {}) {
  const ran: string[] = [];
  const destroy = vi.fn();
  const swapMachine = vi.fn(async () => {});
  const execute = vi.fn(async (step: TerminalStep): Promise<CommandResult> => {
    ran.push(step.command);
    const answer = answers[step.command] ?? { status: 0, output: "Uso: " };
    if (answer === "hang") return new Promise(() => {});
    if (answer === "throw") throw new Error("engine down");
    return answer;
  });
  const setInstant = vi.fn();
  const win = { setSpeed: vi.fn(), setInstant, swapMachine, snapshot: () => ({}), destroy, execute } as unknown as TerminalWindow;
  return { win, ran, destroy, execute, swapMachine, setInstant };
}

const suite = (over: Partial<ConformanceSuite> = {}, cases: ConformanceCase[] = [{ command: "ls" }]): ConformanceSuite => ({ name: "ls", kind: "command", group: "arquivos", cases, ...over });

const run = (suites: ConformanceSuite[], answers: Record<string, Answer> = {}, extra: object = {}) => {
  const fake = fakeWindow(answers);
  return { fake, report: runConformance({ suites, mount: async () => fake.win, timeoutMs: 20, ...extra }) };
};

describe("runConformance", () => {
  // Covers SPEC-030 CA-10, CA-16: the --help is the first case of a command, and every case of the suite runs after it, in order.
  it("runs the --help first and then every case in order", async () => {
    const { fake, report } = run([suite({}, [{ command: "ls" }, { command: "ls -a" }, { command: "ls -la" }])]);
    const result = await report;
    expect(result).toMatchObject({ passed: 1, failed: 0, casesPassed: 4, casesFailed: 0, conformant: true });
    expect(result.suites[0]!.cases.map((test) => test.command)).toEqual(["ls --help", "ls", "ls -a", "ls -la"]);
    expect(fake.ran.slice(-4)).toEqual(["ls --help", "ls", "ls -a", "ls -la"]);
    expect(fake.destroy).toHaveBeenCalled();
  });

  // Covers SPEC-030 RN-14, RN-16: each suite starts from the snapshot with the terminal kept, marked with its name, and goes to the lab folder.
  it("starts every suite from the snapshot of the lab, keeping the terminal", async () => {
    const { fake, report } = run([suite(), suite({ name: "cat" })]);
    await report;
    expect(fake.swapMachine).toHaveBeenCalledTimes(2);
    expect(fake.swapMachine).toHaveBeenNthCalledWith(1, expect.anything(), "# comando ls");
    expect(fake.swapMachine).toHaveBeenNthCalledWith(2, expect.anything(), "# comando cat");
    // The lab setup itself ends with one cd, and each suite goes there once more.
    expect(fake.ran.filter((command) => command === "cd /tmp/lab")).toHaveLength(3);
  });

  // Covers SPEC-030 CA-05, CA-21: a failing case keeps what was expected and what the engine answered, and the next cases still run.
  it("records the failure with the expectation and the answer, and goes on to the next case", async () => {
    const { report } = run([suite({}, [{ command: "ls /x", code: 2, expect: "inexistente" }, { command: "ls" }])], { "ls /x": { status: 1, output: "x".repeat(OUTPUT_LIMIT + 50) } });
    const result = await report;
    expect(result.conformant).toBe(false);
    expect(result).toMatchObject({ passed: 0, failed: 1, casesFailed: 1 });
    const [help, failing, next] = result.suites[0]!.cases;
    expect(help!.passed).toBe(true);
    expect(failing).toMatchObject({ command: "ls /x", passed: false, status: 1, truncated: true, expected: 'status 2, output has "inexistente"' });
    expect(failing!.output).toHaveLength(OUTPUT_LIMIT);
    expect(next!.passed).toBe(true);
  });

  // Covers SPEC-030 RN-02: expected code, text that must be there and text that must not.
  it("checks the code, the text that must be in the output and the text that must not", async () => {
    const { report } = run([suite({ help: false }, [{ command: "false", code: 1 }, { command: "echo a", expect: "b" }, { command: "ls -a", reject: ".hidden" }])], {
      false: { status: 1, output: "" },
      "echo a": { status: 0, output: "a" },
      "ls -a": { status: 0, output: "a .hidden" },
    });
    const result = await report;
    expect(result.suites[0]!.cases.map((test) => test.passed)).toEqual([true, false, false]);
    expect(result.suites[0]!.cases[2]!.expected).toContain('output has not ".hidden"');
  });

  // Covers SPEC-030 CA-10: a --help that does not show the usage fails the suite.
  it("fails a command whose --help does not show the usage", async () => {
    const { report } = run([suite()], { "ls --help": { status: 0, output: "nada" } });
    const result = await report;
    expect(result.suites[0]!.cases[0]).toMatchObject({ command: "ls --help", passed: false });
    expect(result.suites[0]!.passed).toBe(false);
  });

  it("does not run --help for a program or for a command that has none", async () => {
    const { fake, report } = run([suite({ name: "sshd", kind: "program" }, [{ command: "sshd -t" }]), suite({ name: "true", help: false }, [{ command: "true" }])]);
    await report;
    expect(fake.ran.filter((command) => command.endsWith("--help"))).toEqual([]);
  });

  // Covers SPEC-030 CA-06, CA-21: a case that never ends is a failure and the next one goes on.
  it("records a timeout and goes on to the next case and suite", async () => {
    const { report } = run([suite({ name: "yes", help: false }, [{ command: "yes" }, { command: "pwd" }]), suite({ name: "pwd", help: false }, [{ command: "pwd" }])], { yes: "hang" });
    const result = await report;
    expect(result.suites.map((s) => s.passed)).toEqual([false, true]);
    expect(result.suites[0]!.cases[0]).toMatchObject({ passed: false, output: "timeout" });
    expect(result.suites[0]!.cases[1]!.passed).toBe(true);
  });

  it("fails the suite and every case that could not run when a setup step never ends", async () => {
    const { report } = run([suite({ setup: ["apt install -y x"] }, [{ command: "ls" }])], { "apt install -y x": "hang" });
    const result = await report;
    const cases = result.suites[0]!.cases;
    expect(cases[0]).toMatchObject({ command: "apt install -y x", passed: false });
    expect(cases[0]!.expected).toContain("setup");
    expect(cases.slice(1).every((test) => !test.passed && test.expected.includes("not run"))).toBe(true);
  });

  it("types the answers and the setup steps that ask questions", async () => {
    const fake = fakeWindow();
    await runConformance({ suites: [suite({ help: false, setup: [{ command: "fdisk", answers: ["n"] }] }, [{ command: "ls", answers: ["a"] }])], mount: async () => fake.win });
    expect(fake.execute).toHaveBeenCalledWith({ command: "fdisk", answers: ["n"] });
    expect(fake.execute).toHaveBeenCalledWith({ command: "ls", answers: ["a"] });
  });

  it("accepts the terminal closing when the case says there is no status", async () => {
    const { report } = run([suite({ name: "exit", help: false }, [{ command: "exit", code: null, expect: "logout" }])], { exit: { status: null, output: "logout" } });
    expect((await report).suites[0]!.cases[0]).toMatchObject({ passed: true, status: null });
  });

  // Covers SPEC-030 CA-07, RN-06: an error of the engine rejects the run, and no seal is given.
  it("rejects when the engine itself breaks, and still closes the window", async () => {
    const { fake, report } = run([suite()], { ls: "throw" });
    await expect(report).rejects.toThrow("engine down");
    expect(fake.destroy).toHaveBeenCalled();
  });

  // Covers SPEC-030 CA-09, RN-06: a name of the catalog with no suite is not conformant, and an empty manifest never is.
  it("is not conformant with a name of the catalog that has no suite, or with nothing to run", async () => {
    const catalog = { commands: ["ls", "pwd"], programs: ["sshd"] };
    const result = await run([suite()], {}, { catalog }).report;
    expect(result.uncovered).toEqual(["pwd", "sshd"]);
    expect(result.conformant).toBe(false);
    expect((await run([]).report).conformant).toBe(false);
  });

  // Covers SPEC-030 RN-16: the window stays open after a successful run when asked to, and is closed otherwise and on an error.
  it("keeps the window open only when asked, and never after an error", async () => {
    const kept = fakeWindow();
    await runConformance({ suites: [suite()], mount: async () => kept.win, keepWindow: true });
    expect(kept.destroy).not.toHaveBeenCalled();
    const closed = fakeWindow();
    await runConformance({ suites: [suite()], mount: async () => closed.win });
    expect(closed.destroy).toHaveBeenCalled();
    const broken = fakeWindow({ ls: "throw" });
    await expect(runConformance({ suites: [suite()], mount: async () => broken.win, keepWindow: true })).rejects.toThrow("engine down");
    expect(broken.destroy).toHaveBeenCalled();
  });

  // Covers SPEC-030 CA-26, RN-19: the transcript has every command with its whole output and its status, in order, with a mark where each suite begins.
  it("writes the transcript with every command, its whole output and its status", async () => {
    const big = "y".repeat(OUTPUT_LIMIT + 500);
    const { report } = run([suite({ help: false }, [{ command: "ls" }, { command: "ls /x", code: 2 }, { command: "yes" }])], { ls: { status: 0, output: big }, "ls /x": { status: 1, output: "erro\n" }, yes: "hang" });
    const { transcript, suites } = await report;
    expect(suites[0]!.cases[0]!.truncated).toBe(true);
    const marks = transcript.split("\n\n");
    expect(transcript).toContain("# comando ls\n\n");
    expect(transcript).toContain(`$ ls\n${big}\n[exit 0 · ok]\n\n`);
    expect(transcript).toContain("$ ls /x\nerro\n[exit 1 · FAILED]\n\n");
    expect(transcript).toContain("$ yes\n[timeout after 20 ms · FAILED]\n\n");
    expect(transcript.indexOf("$ ls\n")).toBeLessThan(transcript.indexOf("$ ls /x"));
    expect(marks.length).toBeGreaterThan(3);
  });

  it("reports the progress case by case", async () => {
    const onProgress = vi.fn();
    await run([suite({}, [{ command: "ls" }]), suite({ name: "pwd" }, [{ command: "pwd" }])], {}, { onProgress }).report;
    expect(onProgress).toHaveBeenNthCalledWith(1, { done: 0, total: 4, current: "ls --help" });
    expect(onProgress).toHaveBeenNthCalledWith(2, { done: 1, total: 4, current: "ls" });
    expect(onProgress).toHaveBeenNthCalledWith(3, { done: 2, total: 4, current: "pwd --help" });
    expect(onProgress).toHaveBeenLastCalledWith({ done: 4, total: 4, current: "" });
  });

  // Covers SPEC-032 CA-02, RN-01: the quick mode is handed to the window before anything runs, and only when asked for.
  it("turns the quick mode on in the window only when it is asked for", async () => {
    const quick = run([suite()], {}, { instant: true });
    await quick.report;
    expect(quick.fake.setInstant).toHaveBeenCalledWith(true);
    const slow = run([suite()]);
    await slow.report;
    expect(slow.fake.setInstant).toHaveBeenCalledWith(false);
  });

  // Covers SPEC-030 RN-21: an aborted run stops at the next case, closes its window and rejects, so it does not go on beside the next one.
  it("stops at the next case when it is aborted and closes the window", async () => {
    const abort = new AbortController();
    const fake = fakeWindow({});
    fake.execute.mockImplementation(async (step: TerminalStep) => {
      fake.ran.push(step.command);
      if (step.command === "ls -a") abort.abort();
      return { status: 0, output: "Uso: " };
    });
    const promise = runConformance({ suites: [suite({}, [{ command: "ls -a" }, { command: "ls -l" }])], mount: async () => fake.win, signal: abort.signal });
    await expect(promise).rejects.toThrow();
    expect(fake.ran).not.toContain("ls -l");
    expect(fake.destroy).toHaveBeenCalled();
  });
});
