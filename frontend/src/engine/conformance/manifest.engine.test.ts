import { afterAll, describe, expect, it, vi } from "vitest";
import { mountMachine } from "../testkit";
import { catalogNames, engineCatalog } from "./catalog";
import { manifest } from "./manifest";
import { runConformance } from "./runner";

// The whole engine takes minutes to go through.
vi.setConfig({ testTimeout: 600_000 });

const fetchSpy = vi.spyOn(globalThis, "fetch");
afterAll(() => fetchSpy.mockRestore());

describe("the manifest against the real engine", () => {
  // Covers SPEC-030 CA-09, RN-07: the manifest and the catalog say the same names, in both directions.
  it("has an item for every command and program, and none for what does not exist", async () => {
    const entries = catalogNames(await engineCatalog());
    const names = new Set(entries.map((entry) => entry.name));
    const items = new Set(manifest.map((item) => item.name));
    expect([...names].filter((name) => !items.has(name)), "commands or programs with no item in the manifest").toEqual([]);
    expect([...items].filter((name) => !names.has(name)), "items of the manifest for something that is not in the engine").toEqual([]);
    expect(items.size).toBe(manifest.length);
    const kinds = new Map(entries.map((entry) => [entry.name, entry.kind]));
    expect(manifest.filter((item) => kinds.get(item.name) !== item.kind).map((item) => item.name)).toEqual([]);
  });

  // Covers SPEC-030 CA-03, CA-04, CA-10, CA-11, CA-12: all items pass, with their --help, and nothing goes over the network or into the browser storage.
  it("passes on the real engine without touching the network or the storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const report = await runConformance({ items: manifest, catalog: await engineCatalog(), mount: mountMachine });
    const failures = report.results.filter((r) => !r.passed).map((r) => `${r.item.name}: ${r.failure!.command} -> ${r.failure!.expected} | ${r.failure!.got}`);
    expect({ failures, uncovered: report.uncovered }).toEqual({ failures: [], uncovered: [] });
    expect(report.conformant).toBe(true);
    expect(report.passed).toBe(manifest.length);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
