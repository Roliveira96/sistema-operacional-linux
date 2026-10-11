import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CommandResult, TerminalStep } from "../terminalWindow";

const mount = vi.hoisted(() => vi.fn());
vi.mock("../terminalWindow", () => ({ mountTerminalWindow: mount }));

describe("verifyEngine", () => {
  // Covers SPEC-030 CA-03, CA-12: it opens its own hidden window, reports the progress, and removes the window at the end.
  it("runs the manifest on a hidden window of its own and removes it", async () => {
    const hosts: HTMLElement[] = [];
    mount.mockImplementation(async (host: HTMLElement) => {
      hosts.push(host);
      expect(host.hidden).toBe(true);
      expect(document.body.contains(host)).toBe(true);
      return {
        setSpeed: () => {},
        reset: () => {},
        snapshot: () => ({}),
        destroy: () => {},
        execute: async (step: TerminalStep): Promise<CommandResult> => ({ status: step.command === "false" ? 1 : 0, output: "Uso: " }),
      };
    });
    const { verifyEngine, manifest } = await import("./index");
    const onProgress = vi.fn();
    const report = await verifyEngine(onProgress);
    expect(report.results).toHaveLength(manifest.length);
    expect(report.uncovered).toEqual([]);
    expect(onProgress).toHaveBeenLastCalledWith({ done: manifest.length, total: manifest.length, current: "" });
    expect(hosts).toHaveLength(1);
    expect(document.body.contains(hosts[0]!)).toBe(false);
  });
});

// Covers SPEC-030 CA-13, RN-08: the duty to keep the manifest is written in the rules of the project.
describe("the rule of keeping the manifest", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf-8");
  it.each([
    ["specs/ARCHITECTURE.md", /manifesto de conformidade/],
    ["specs/GLOSSARY.md", /Manifesto de conformidade/],
    ["specs/features/028-ampliacao-comandos-do-motor.md", /manifesto de conformidade/],
    ["specs/features/029-simulador-de-controle-de-processos.md", /manifesto de conformidade/],
  ])("%s says it", (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });
});
