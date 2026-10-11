import { describe, expect, it, vi } from "vitest";
import type { CommandResult, TerminalStep, TerminalWindow } from "../terminalWindow";
import { runConformance } from "./runner";
import type { ConformanceItem } from "./types";

type Answer = CommandResult | "hang" | "throw";

/** A terminal window that answers from a table: the commands not in it succeed and print a usage line. */
function fakeWindow(answers: Record<string, Answer> = {}) {
  const ran: string[] = [];
  const destroy = vi.fn();
  const execute = vi.fn(async (step: TerminalStep): Promise<CommandResult> => {
    ran.push(step.command);
    const answer = answers[step.command] ?? { status: 0, output: "Uso: " };
    if (answer === "hang") return new Promise(() => {});
    if (answer === "throw") throw new Error("engine down");
    return answer;
  });
  const win = { setSpeed: vi.fn(), reset: vi.fn(), snapshot: () => ({}), destroy, execute } as unknown as TerminalWindow;
  return { win, ran, destroy, execute };
}

const item = (over: Partial<ConformanceItem> = {}): ConformanceItem => ({ name: "ls", kind: "command", group: "arquivos", command: "ls", ...over });

const run = (items: ConformanceItem[], answers: Record<string, Answer> = {}, extra: object = {}) => {
  const fake = fakeWindow(answers);
  return { fake, report: runConformance({ items, mount: async () => fake.win, timeoutMs: 20, ...extra }) };
};

describe("runConformance", () => {
  // Covers SPEC-030 CA-04, CA-10: a command whose usage and --help answer as expected passes.
  it("passes an item and runs its --help too", async () => {
    const { fake, report } = run([item()]);
    const result = await report;
    expect(result).toMatchObject({ passed: 1, failed: 0, conformant: true });
    expect(fake.ran).toContain("ls --help");
    expect(fake.destroy).toHaveBeenCalled();
  });

  // Covers SPEC-030 CA-05: a failure keeps the command, what was expected and what the engine answered, cut at 300 characters.
  it("records the failure with the command, the expectation and the answer", async () => {
    const { report } = run([item({ code: 0 })], { ls: { status: 2, output: "x".repeat(500) } });
    const result = await report;
    expect(result.conformant).toBe(false);
    const failure = result.results[0]!.failure!;
    expect(failure).toMatchObject({ command: "ls", expected: "status 0" });
    expect(failure.got.length).toBeLessThan(330);
  });

  it("fails an item whose output lacks the expected text, and accepts the status it declares", async () => {
    const { report } = run([item({ command: "false", name: "false", code: 1, help: false }), item({ command: "echo a", name: "echo", expect: "b", help: false })], {
      false: { status: 1, output: "" },
      "echo a": { status: 0, output: "a" },
    });
    const result = await report;
    expect(result.results.map((r) => r.passed)).toEqual([true, false]);
    expect(result.results[1]!.failure!.expected).toContain('"b"');
  });

  // Covers SPEC-030 CA-10: a --help that does not show the usage fails the item.
  it("fails a command whose --help does not show the usage", async () => {
    const { report } = run([item()], { "ls --help": { status: 0, output: "nada" } });
    expect((await report).results[0]!.failure).toMatchObject({ command: "ls --help" });
  });

  it("does not run --help for a program or for a command that has none", async () => {
    const { fake, report } = run([item({ name: "sshd", kind: "program", command: "sshd -t" }), item({ name: "true", command: "true", help: false })]);
    await report;
    expect(fake.ran.filter((c) => c.endsWith("--help"))).toEqual([]);
  });

  // Covers SPEC-030 CA-06: an item that never ends is a failure and the next one goes on.
  it("records a timeout and goes on to the next item", async () => {
    const { report } = run([item({ command: "yes", name: "yes" }), item({ command: "pwd", name: "pwd" })], { yes: "hang" });
    const result = await report;
    expect(result.results.map((r) => r.passed)).toEqual([false, true]);
    expect(result.results[0]!.failure!.got).toBe("timeout");
  });

  it("records a setup step that never ends as the failure of the item", async () => {
    const { report } = run([item({ setup: ["apt install -y x"] })], { "apt install -y x": "hang" });
    expect((await report).results[0]!.failure).toMatchObject({ command: "apt install -y x", got: "timeout" });
  });

  it("types the answers and the setup steps that ask questions", async () => {
    const fake = fakeWindow();
    await runConformance({ items: [item({ answers: ["a"], setup: [{ command: "fdisk", answers: ["n"] }], help: false })], mount: async () => fake.win });
    expect(fake.execute).toHaveBeenCalledWith({ command: "fdisk", answers: ["n"] });
    expect(fake.execute).toHaveBeenCalledWith({ command: "ls", answers: ["a"] });
  });

  it("accepts the terminal closing when the item says there is no status", async () => {
    const { report } = run([item({ name: "exit", command: "exit", code: null, expect: "logout" })], { exit: { status: null, output: "logout" } });
    expect((await report).results[0]!.passed).toBe(true);
  });

  // Covers SPEC-030 CA-07, RN-06: an error of the engine rejects the run, and no seal is given.
  it("rejects when the engine itself breaks, and still closes the window", async () => {
    const { fake, report } = run([item()], { ls: "throw" });
    await expect(report).rejects.toThrow("engine down");
    expect(fake.destroy).toHaveBeenCalled();
  });

  // Covers SPEC-030 CA-09, RN-06: a name of the catalog with no item is not conformant, and an empty manifest never is.
  it("is not conformant with a name of the catalog that has no item, or with nothing to run", async () => {
    const catalog = { commands: ["ls", "pwd"], programs: ["sshd"] };
    const result = await run([item()], {}, { catalog }).report;
    expect(result.uncovered).toEqual(["pwd", "sshd"]);
    expect(result.conformant).toBe(false);
    expect((await run([]).report).conformant).toBe(false);
  });

  it("reports the progress item by item", async () => {
    const onProgress = vi.fn();
    await run([item(), item({ name: "pwd", command: "pwd" })], {}, { onProgress }).report;
    expect(onProgress).toHaveBeenNthCalledWith(1, { done: 0, total: 2, current: "ls" });
    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2, current: "" });
  });
});
