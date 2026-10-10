import { describe, expect, it } from "vitest";
import { draw, perRound, roundsFor, seeded, testBank, type BankItem, type Sandbox } from "./bankTest";

// A tiny machine: "mk /a/b" makes a folder and fails when the parent does not exist; conditions are folders that must exist.
function machine() {
  let dirs = new Set<string>(["/"]);
  const log: string[] = [];
  const sandbox: Sandbox = {
    reset: async () => {
      dirs = new Set(["/"]);
      log.push("reset");
    },
    solve: async (setup) => {
      for (const step of setup.steps) {
        const path = step.command.replace("mk ", "");
        const parent = path.slice(0, path.lastIndexOf("/")) || "/";
        if (!dirs.has(parent)) return false;
        dirs.add(path);
      }
      return true;
    },
    holds: (conditions) => conditions.every((c) => dirs.has((c as { path: string }).path)),
  };
  return { sandbox, log };
}

const item = (id: string, path: string | null, dependsOn: string | null = null): BankItem => ({
  id,
  title: id.toUpperCase(),
  dependsOn,
  solution: path ? { summary: "", steps: [{ command: `mk ${path}` }] } : undefined,
  conditions: path ? [{ kind: "DIR_EXISTS", path }] : [],
});

// Covers SPEC-023 12.2 (CA-12, CA-13): the sampling and the seed.
describe("the draw of the bank test", () => {
  it("makes half as many rounds as half the exercises, from 1 to 5, each bringing half the bank", () => {
    expect([0, 1, 2, 4, 9, 10, 11, 50].map(roundsFor)).toEqual([1, 1, 1, 2, 5, 5, 5, 5]);
    expect([1, 4, 9, 10, 50].map(perRound)).toEqual([1, 2, 5, 5, 25]);
  });

  it("repeats from the same seed, never repeats an exercise in a round and stops at the pool", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(draw(ids, 3, seeded(7))).toEqual(draw(ids, 3, seeded(7)));
    expect(new Set(draw(ids, 5, seeded(1))).size).toBe(5);
    expect(draw(ids, 9, seeded(1))).toHaveLength(5);
    expect(draw([], 3, seeded(1))).toEqual([]);
    expect(draw(ids, 3, seeded(1))).not.toEqual(draw(ids, 3, seeded(2)));
  });
});

describe("testBank", () => {
  // Covers CA-12, CA-13, CA-16: three batteries on a bank that holds together.
  it("runs the linear, the reverse and the drawn rounds, each on a fresh machine, and passes a sound bank", async () => {
    const { sandbox, log } = machine();
    const items = [item("a", "/a"), item("b", "/b"), item("c", "/a/c", "a"), item("d", "/d")];
    const report = await testBank(items, sandbox, { seed: 42 });
    expect(report.status).toBe("ok");
    expect(report.seed).toBe(42);
    expect(report.rounds.map((r) => r.phase)).toEqual(["linear", "reverse", "random", "random"]);
    expect(report.rounds[0]!.order).toEqual(["a", "b", "c", "d"]);
    // Reverse: the declared dependency still comes first.
    expect(report.rounds[1]!.order).toEqual(["d", "a", "c", "b"]);
    expect(log.filter((l) => l === "reset")).toHaveLength(4);
    expect(report.conflicts).toEqual([]);
    expect(report.declared).toEqual([{ id: "c", on: "a" }]);
    // The same seed draws the same rounds.
    const again = await testBank(items, machine().sandbox, { seed: 42 });
    expect(again.rounds.map((r) => r.order)).toEqual(report.rounds.map((r) => r.order));
  });

  // Covers CA-15, D-18: the draw never takes an exercise without its antecessor.
  it("pulls the antecessor into a drawn round and says so", async () => {
    const { sandbox } = machine();
    const items = [item("a", "/a"), item("c", "/a/c", "a")];
    const report = await testBank(items, sandbox, { seed: 1 });
    const pulled = report.rounds.filter((r) => r.phase === "random").flatMap((r) => r.pulled);
    for (const round of report.rounds.filter((r) => r.phase === "random")) {
      if (round.order.includes("c")) expect(round.order.indexOf("a")).toBeLessThan(round.order.indexOf("c"));
    }
    for (const p of pulled) expect(p).toEqual({ id: "a", by: "c" });
    expect(report.status).toBe("ok");
  });

  // Covers CA-14, D-17: an exercise that fails in reverse and passes after another one depends on it; the system only suggests.
  it("finds the dependency nobody declared and suggests it", async () => {
    const { sandbox } = machine();
    // b makes a folder inside /a without saying it needs a.
    const items = [item("a", "/a"), item("b", "/a/b"), item("z", "/z")];
    const report = await testBank(items, sandbox, { seed: 3 });
    expect(report.status).toBe("failed");
    expect(report.conflicts).toEqual(["b"]);
    expect(report.suggested).toEqual([{ id: "b", on: "a" }]);
    expect(report.isolated).toEqual([]);
    expect(report.declared).toEqual([]);
    expect(report.rounds[0]!.results.every((r) => r.ok)).toBe(true);
    expect(report.rounds[1]!.results.find((r) => r.id === "b")!.ok).toBe(false);
  });

  it("passes the same bank once the dependency is declared", async () => {
    const items = [item("a", "/a"), item("b", "/a/b", "a"), item("z", "/z")];
    expect((await testBank(items, machine().sandbox, { seed: 3 })).status).toBe("ok");
  });

  it("says an exercise does not resolve alone when nothing helps it, and does not suggest a cycle", async () => {
    // b needs /x/y but nobody makes /x; a already depends on b, so b cannot depend on a.
    const items = [item("b", "/x/y"), item("a", "/a", "b"), item("c", "/c")];
    const report = await testBank(items, machine().sandbox, { seed: 5 });
    expect(report.status).toBe("failed");
    expect(report.isolated).toEqual(expect.arrayContaining(["b"]));
    expect(report.suggested.find((s) => s.id === "b" && s.on === "a")).toBeUndefined();
  });

  it("fails the test for an exercise with no solution or no conditions, without running it", async () => {
    const { sandbox } = machine();
    const items = [item("a", "/a"), item("s", null), { ...item("c", "/c"), conditions: [] }];
    const report = await testBank(items, sandbox, { seed: 1 });
    expect(report.untestable).toEqual(["s", "c"]);
    expect(report.status).toBe("failed");
    expect(report.rounds.flatMap((r) => r.order)).not.toContain("s");
  });

  it("copes with an empty bank and reports the progress", async () => {
    const steps: string[] = [];
    const report = await testBank([], machine().sandbox, { seed: 1, onProgress: (_d, _t, label) => steps.push(label) });
    expect(report.status).toBe("ok");
    expect(report.rounds.map((r) => r.phase)).toEqual(["linear", "reverse"]);
    expect(steps).toEqual(["linear", "reverse"]);
  });
});
