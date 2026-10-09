import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/services/contentService";
import { buildScript, cardOfStep, subtitleOf } from "./lessons";

const block = (position: number, type: string, payload: Record<string, unknown> = {}): ContentBlock => ({ id: String(position), type, position, payload });

// Covers SPEC-016 P-01 and the player script (CA-03).
describe("buildScript", () => {
  it("groups blocks into a concepts card and lesson cards and lists the steps in order", () => {
    const { cards, steps } = buildScript([
      block(4, "COMMAND", { steps: [{ command: "pwd" }, { command: "pwd -P", terminal: 2 }] }),
      block(1, "LEGACY_HTML", { html: "conceitos" }),
      block(2, "COMMAND", { steps: [{ command: "ls /" }, { bad: true }] }),
      block(3, "TEXT", { title: "Mostrar onde estou", command: "pwd", html: "<p>x</p>" }),
      block(5, "TIP", { html: "<ul><li>a</li></ul>" }),
      block(6, "TEXT", { html: "<table></table>" }),
      block(7, "TEXT", { title: "Listar", command: "ls" }),
    ]);
    expect(cards.map((c) => [c.kind, c.title, c.command, c.blocks.map((b) => b.position), c.firstStep, c.stepCount])).toEqual([
      ["concepts", undefined, undefined, [1, 2], 0, 1],
      ["lesson", "Mostrar onde estou", "pwd", [3, 4, 5, 6], 1, 2],
      ["lesson", "Listar", "ls", [7], 3, 0],
    ]);
    expect(steps.map((s) => s.command)).toEqual(["ls /", "pwd", "pwd -P"]);
    expect(cardOfStep(cards, 0)).toBe(0);
    expect(cardOfStep(cards, 2)).toBe(1);
    expect(cardOfStep(cards, 3)).toBe(-1);
  });

  it("handles modules without blocks and keeps descriptions without tags", () => {
    expect(buildScript([])).toEqual({ cards: [], steps: [] });
    expect(subtitleOf("pwd · ls — Onde estou")).toBe("pwd · ls");
    expect(subtitleOf("Sem etiquetas")).toBe("Sem etiquetas");
  });
});
