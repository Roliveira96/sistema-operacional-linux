import { describe, expect, it, vi } from "vitest";
import { allLayers, cardLayers, hasSetup, legacySetup, parseSetup, setupPayload, stepCount } from "./setup";
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

// Covers SPEC-021 RN-12: the files of a snapshot, kept as data.
describe("setup files", () => {
  const NL = String.fromCharCode(10);
  const log = "2026-10-09 ERROR  falha" + NL + NL + "  com espaços no fim  " + NL;

  it("reads and sends the files with their text untouched", () => {
    const got = parseSetup({ summary: "s", steps: [], files: [{ path: "/var/log/app.log", content: log, mode: "640", owner: "ana", group: "adm" }, { path: "", content: "sem caminho" }, { path: "/b" }] });
    expect(got?.files).toEqual([{ path: "/var/log/app.log", content: log, mode: "640", owner: "ana", group: "adm" }, { path: "/b", content: "" }]);
    const sent = setupPayload({ summary: " ", steps: [], files: [{ path: " /var/log/app.log ", content: log, mode: "640" }] });
    expect(sent).toEqual({ steps: [], files: [{ path: "/var/log/app.log", content: log, mode: "640" }] });
    expect(setupPayload({ summary: "", steps: [{ command: "ls" }], files: [] })).toEqual({ steps: [{ command: "ls" }] });
  });

  it("counts a snapshot that has only files as one that does something", () => {
    expect(hasSetup(undefined)).toBe(false);
    expect(hasSetup({ summary: "", steps: [] })).toBe(false);
    expect(hasSetup({ summary: "", steps: [], files: [{ path: "/a", content: "" }] })).toBe(true);
    const only = { summary: "", steps: [], files: [{ path: "/a", content: "x" }] };
    const layers = allLayers(only, [header("a", "A", only)]);
    expect(layers.map((l) => l.id)).toEqual(["module", "a"]);
    expect(stepCount(layers)).toBe(2);
  });
});

describe("runLayers, the files of a snapshot", () => {
  const machine = { raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] }, contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] } };
  const layer = (files: { path: string; content: string; owner?: string }[], steps = [{ command: "mkdir -p /var/log" }]) => allLayers({ summary: "", steps, files }, []);

  it("puts the files in after the commands of the layer, and loads the machine with them", async () => {
    const calls: string[] = [];
    const win = {
      execute: vi.fn(async ({ command }: { command: string }) => (calls.push(command), { status: 0, output: "" })),
      setSpeed: vi.fn(),
      snapshot: vi.fn(() => machine),
      loadScenario: vi.fn(async (next: unknown) => void calls.push(`load ${JSON.stringify(next).includes("conteudo")}`)),
    };
    const seen: string[] = [];
    const results = await runLayers(win as never, layer([{ path: "/var/log/a.log", content: "x" }]), { onStep: (r) => seen.push(r.step.command) });
    expect(calls).toEqual(["mkdir -p /var/log", "load true"]);
    expect(seen).toEqual(["mkdir -p /var/log", "(1 arquivo do ambiente)"]);
    expect(results.every((r) => !isConflict(r))).toBe(true);
  });

  it("reports a file that cannot go in as a conflict, with the reason", async () => {
    const win = { execute: vi.fn(async () => ({ status: 0, output: "" })), setSpeed: vi.fn(), snapshot: () => machine, loadScenario: vi.fn() };
    const results = await runLayers(win as never, layer([{ path: "/a.log", content: "x", owner: "ninguem" }], []));
    expect(results.filter(isConflict).map((r) => r.output)).toEqual(["o usuário ninguem não existe na máquina"]);
    expect(win.loadScenario).not.toHaveBeenCalled();

    const noLoad = await runLayers({ execute: vi.fn(), setSpeed: vi.fn() } as never, layer([{ path: "/a.log", content: "x" }], []));
    expect(noLoad.filter(isConflict)).toHaveLength(1);
  });

  it("does not load the files when the run was stopped", async () => {
    const win = { execute: vi.fn(async () => ({ status: 0, output: "" })), setSpeed: vi.fn(), snapshot: () => machine, loadScenario: vi.fn() };
    await runLayers(win as never, layer([{ path: "/a.log", content: "x" }]), { shouldStop: () => true });
    expect(win.loadScenario).not.toHaveBeenCalled();
  });
});

// Covers SPEC-022 RN-06: the snapshot of the group of exercises comes after the one of its card.
describe("layers of the exercises", () => {
  const exercises = (id: string, setup?: unknown, active = true) => ({ id, type: "EXERCISES", active, payload: { items: [], setup } });
  const only = { steps: [{ command: "g" }] };

  it("puts the base of the group of exercises right after the snapshot of its card, card by card", () => {
    const blocks = [
      header("a", "A", { steps: [{ command: "a" }] }),
      exercises("ea", only),
      header("b", "B", { steps: [{ command: "b" }] }),
      exercises("eb", only),
    ];
    expect(allLayers({ summary: "", steps: [{ command: "m" }] }, blocks).map((l) => [l.id, l.label])).toEqual([
      ["module", "Módulo"],
      ["a", "A"],
      ["ea", "A (exercícios)"],
      ["b", "B"],
      ["eb", "B (exercícios)"],
    ]);
  });

  it("leaves out an inactive group and a group with no snapshot, and names the introduction", () => {
    const blocks = [exercises("e0", only), header("a", "A"), exercises("ea", undefined), header("b", "B"), exercises("eb", only, false)];
    expect(cardLayers(blocks).map((l) => [l.id, l.label])).toEqual([["e0", "Introdução (exercícios)"]]);
  });
});
