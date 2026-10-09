import { describe, expect, it, vi } from "vitest";
import { allLayers, cardLayers, legacySetup, parseSetup, setupPayload, stepCount } from "./setup";
import { isConflict, runLayers } from "./setupRunner";

const header = (id: string, title: string, setup?: unknown, active = true) => ({ id, type: "TEXT", active, payload: { title, html: "", setup } });

// Covers SPEC-021 RN-01 and RN-02.
describe("setup", () => {
  it("reads a stored snapshot and drops empty steps", () => {
    const got = parseSetup({ summary: "ok", steps: [{ command: "mkdir /x" }, { command: " " }, { command: "su ana", terminal: 2, login: { user: "ana", password: "1" }, answers: ["s"] }] });
    expect(got?.steps).toHaveLength(2);
    expect(got?.steps[1]).toEqual({ command: "su ana", terminal: 2, login: { user: "ana", password: "1" }, answers: ["s"] });
    expect(parseSetup(undefined)).toBeUndefined();
  });

  it("turns the commands of the first version of the snapshots into steps", () => {
    expect(legacySetup({ scenarioId: "x", summary: "s", commands: ["mkdir /a", "", "touch /a/b"] })).toEqual({ summary: "s", steps: [{ command: "mkdir /a" }, { command: "touch /a/b" }] });
    expect(legacySetup({ scenarioId: "x", commands: [] })).toBeUndefined();
  });

  it("sends it trimmed and without the empty parts", () => {
    expect(setupPayload({ summary: " ", steps: [{ command: " ls ", terminal: 1, answers: ["", " a "] }] })).toEqual({ steps: [{ command: "ls", answers: [" a "] }] });
  });

  it("orders the layers: the module, then the active cards with a snapshot", () => {
    const blocks = [header("a", "A", { steps: [{ command: "one" }] }), header("b", "B"), header("c", "C", { steps: [{ command: "two" }] }, false), header("d", "D", { steps: [{ command: "three" }] })];
    expect(cardLayers(blocks).map((l) => l.id)).toEqual(["a", "d"]);
    const layers = allLayers({ summary: "", steps: [{ command: "m" }] }, blocks);
    expect(layers.map((l) => l.id)).toEqual(["module", "a", "d"]);
    expect(stepCount(layers)).toBe(3);
    expect(allLayers({ summary: "", steps: [] }, []).length).toBe(0);
  });
});

describe("runLayers", () => {
  it("runs the layers in order, reports each step and marks the failures as conflicts", async () => {
    const layers = allLayers({ summary: "", steps: [{ command: "m1" }] }, [header("a", "A", { steps: [{ command: "c1" }, { command: "c2" }] })]);
    const execute = vi.fn(async ({ command }: { command: string }) => ({ status: command === "c1" ? 1 : 0, output: `out ${command}` }));
    const setSpeed = vi.fn();
    const seen: string[] = [];
    const results = await runLayers({ execute, setSpeed } as never, layers, { onStep: (r) => seen.push(r.step.command), restoreSpeed: 7 });
    expect(seen).toEqual(["m1", "c1", "c2"]);
    expect(results.filter(isConflict).map((r) => [r.layer.label, r.step.command, r.output])).toEqual([["A", "c1", "out c1"]]);
    expect(setSpeed).toHaveBeenLastCalledWith(7);
  });

  it("stops when asked to", async () => {
    const layers = allLayers({ summary: "", steps: [{ command: "a" }, { command: "b" }] }, []);
    const execute = vi.fn(async () => ({ status: 0, output: "" }));
    let stop = false;
    const results = await runLayers({ execute, setSpeed: vi.fn() } as never, layers, { onStep: () => (stop = true), shouldStop: () => stop });
    expect(results).toHaveLength(1);
  });
});
