import { describe, expect, it } from "vitest";
import { chainLayers, type ChainLink } from "./exerciseChain";

const sol = (command: string) => ({ summary: "", steps: [{ command }] });
const link = (id: string, continues: boolean, command?: string): ChainLink => ({ id, title: id.toUpperCase(), continues, solution: command ? sol(command) : undefined });

// Covers SPEC-023 RN-11, CA-11: the machine of an exercise that continues is built from the recipe of the chain before it.
describe("chainLayers", () => {
  const trail = [link("a", false, "mkdir /lab"), link("b", true, "touch /lab/x.sh"), link("c", true, "chmod +x /lab/x.sh"), link("d", false, "mkdir /outro"), link("e", true, "ls")];
  const commands = (index: number) => chainLayers(trail, index, (t) => `Solução de ${t}`).map((l) => l.setup.steps[0]!.command);

  it("is empty for an exercise that does not continue, and for the first one", () => {
    expect(commands(0)).toEqual([]);
    expect(commands(3)).toEqual([]);
  });

  it("brings the previous solution, and the ones before it while they continue, from the first of the chain, in order", () => {
    expect(commands(1)).toEqual(["mkdir /lab"]);
    expect(commands(2)).toEqual(["mkdir /lab", "touch /lab/x.sh"]);
  });

  it("starts the chain again after an exercise that does not continue", () => {
    expect(commands(4)).toEqual(["mkdir /outro"]);
  });

  it("skips a link with no recorded solution, and names the layers", () => {
    const t = [link("a", false), link("b", true, "touch /x")];
    const layers = chainLayers(t, 1, (title) => `Solução de ${title}`);
    expect(layers).toEqual([]);
    const t2 = [link("a", false, "mkdir /x"), link("b", true)];
    expect(chainLayers(t2, 1, (title) => `Solução de ${title}`)).toEqual([{ id: "chain-a", kind: "card", label: "Solução de A", setup: sol("mkdir /x") }]);
    expect(chainLayers([], 3, (x) => x)).toEqual([]);
  });
});
