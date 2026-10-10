import { describe, expect, it } from "vitest";
import { ancestors, chainLayers, dependsOnAnother, withChains, type ChainLink } from "./exerciseChain";

const sol = (command: string) => ({ summary: "", steps: [{ command }] });
const link = (id: string, dependsOn: string | null, command?: string): ChainLink => ({ id, title: id.toUpperCase(), dependsOn, solution: command ? sol(command) : undefined });

// Covers SPEC-023 D-16, CA-11: the machine of an exercise that depends on others is built from the recipe of the chain before it.
describe("exercise chain", () => {
  const links = [link("a", null, "mkdir /lab"), link("b", "a", "touch /lab/x.sh"), link("c", "b", "chmod +x /lab/x.sh"), link("d", null, "mkdir /outro"), link("e", "d", "ls")];
  const commands = (id: string) => chainLayers(links, id, (t) => `Solução de ${t}`).map((l) => l.setup.steps[0]!.command);

  it("is empty for an exercise that depends on nothing", () => {
    expect(commands("a")).toEqual([]);
    expect(commands("d")).toEqual([]);
    expect(dependsOnAnother(links, "a")).toBe(false);
  });

  it("brings the solution of the exercise it depends on, and of the ones that one depends on, the oldest first", () => {
    expect(commands("b")).toEqual(["mkdir /lab"]);
    expect(commands("c")).toEqual(["mkdir /lab", "touch /lab/x.sh"]);
    expect(commands("e")).toEqual(["mkdir /outro"]);
    expect(ancestors(links, "c").map((l) => l.id)).toEqual(["a", "b"]);
    expect(dependsOnAnother(links, "c")).toBe(true);
  });

  it("does not need the exercises to be in order, and cuts a cycle and a missing link", () => {
    const shuffled = [link("c", "b", "3"), link("a", null, "1"), link("b", "a", "2")];
    expect(chainLayers(shuffled, "c", (t) => t).map((l) => l.setup.steps[0]!.command)).toEqual(["1", "2"]);
    const cyclic = [link("a", "b", "1"), link("b", "a", "2")];
    expect(ancestors(cyclic, "a").map((l) => l.id)).toEqual(["b"]);
    expect(ancestors([link("x", "gone")], "x")).toEqual([]);
    expect(ancestors([], "x")).toEqual([]);
  });

  it("skips a link with no recorded solution, and names the layers", () => {
    const t = [link("a", null), link("b", "a", "touch /x")];
    expect(chainLayers(t, "b", (title) => title)).toEqual([]);
    const t2 = [link("a", null, "mkdir /x"), link("b", "a")];
    expect(chainLayers(t2, "b", (title) => `Solução de ${title}`)).toEqual([{ id: "chain-a", kind: "card", label: "Solução de A", setup: sol("mkdir /x") }]);
  });

  // Covers SPEC-023 D-18: the draw never takes an exercise without the ones it depends on.
  it("pulls the exercises a drawn one depends on, before it and once, and says which were pulled", () => {
    expect(withChains(["c"], links)).toEqual({ order: ["a", "b", "c"], pulled: [{ id: "a", by: "c" }, { id: "b", by: "c" }] });
    expect(withChains(["c", "e", "a"], links)).toEqual({ order: ["a", "b", "c", "d", "e"], pulled: [{ id: "b", by: "c" }, { id: "d", by: "e" }] });
    expect(withChains(["d", "a"], links)).toEqual({ order: ["d", "a"], pulled: [] });
    expect(withChains([], links)).toEqual({ order: [], pulled: [] });
  });
});
