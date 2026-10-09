import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMachine, loadMachine, loadSpeed, machineKey, saveMachine, saveSpeed, scenarioHash } from "./machineStorage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// Covers SPEC-016 CA-06 and the risk of a stale save after a content reload.
describe("machineStorage", () => {
  it("keys the machine by module and by the hash of the scenario", () => {
    const a = machineKey("m1", { x: 1 });
    expect(a).toContain("topic-m1-");
    expect(machineKey("m1", { x: 1 })).toBe(a);
    expect(machineKey("m1", { x: 2 })).not.toBe(a);
    expect(machineKey("m2", { x: 1 })).not.toBe(a);
    expect(scenarioHash(null)).toBe(scenarioHash(undefined));
  });

  it("saves, loads and clears a machine", () => {
    expect(loadMachine("k")).toBeNull();
    saveMachine("k", { a: 1 });
    expect(loadMachine("k")).toEqual({ a: 1 });
    clearMachine("k");
    expect(loadMachine("k")).toBeNull();
  });

  it("treats a corrupted save as no save", () => {
    localStorage.setItem("k", "{not json");
    expect(loadMachine("k")).toBeNull();
  });

  it("remembers the speed and falls back to 1x for unknown values", () => {
    expect(loadSpeed()).toBe(1);
    saveSpeed(4);
    expect(loadSpeed()).toBe(4);
    localStorage.setItem("exame-so:velocidade", "7");
    expect(loadSpeed()).toBe(1);
  });

  it("survives a browser without storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadMachine("k")).toBeNull();
    expect(loadSpeed()).toBe(1);
    expect(() => {
      saveMachine("k", {});
      saveSpeed(2);
      clearMachine("k");
    }).not.toThrow();
  });
});
