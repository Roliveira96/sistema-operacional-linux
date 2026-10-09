import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/services/contentService";
import { buildTopicScript, cardOfStep } from "./topicScript";

const block = (position: number, type: string, payload: Record<string, unknown>): ContentBlock => ({
  id: `b${position}`,
  type,
  position,
  payload,
});

const command = (position: number, ...commands: string[]) =>
  block(position, "COMMAND", { steps: commands.map((c) => ({ command: c, terminal: 1 })) });

describe("buildTopicScript", () => {
  const blocks = [
    block(3, "COMMAND", { steps: [{ command: "uname -o", explanation: "kernel name", terminal: 1 }] }),
    block(1, "LEGACY_HTML", { html: "<p>intro</p>" }),
    block(2, "CURIOSITY", { title: "Na vida real", html: "x" }),
    block(4, "TEXT", { title: "O Unix", command: "Unix", html: "<p>u</p>" }),
    command(5, "ls /etc", "cat /etc/os-release"),
    block(6, "TIP", { html: "t" }),
    block(7, "TEXT", { title: "Sem rótulo", html: "<p>x</p>" }),
    block(8, "TEXT", { html: "<p>texto sem título entra no card</p>" }),
  ];

  // Covers SPEC-016 section 3.1: titled TEXT blocks open a card; the others join it.
  it("groups the blocks into cards in position order", () => {
    const { cards } = buildTopicScript(blocks);
    expect(cards.map((c) => [c.label, c.title, c.blocks.map((b) => b.position)])).toEqual([
      ["conceitos", "Antes dos comandos", [1, 2, 3]],
      ["Unix", "O Unix", [4, 5, 6]],
      ["Sem rótulo", "Sem rótulo", [7, 8]],
    ]);
  });

  it("flattens the commands into one script and gives each card its range", () => {
    const { cards, steps } = buildTopicScript(blocks);
    expect(steps.map((s) => [s.index, s.command])).toEqual([
      [0, "uname -o"],
      [1, "ls /etc"],
      [2, "cat /etc/os-release"],
    ]);
    expect(steps[0]?.explanation).toBe("kernel name");
    expect(cards.map((c) => [c.start, c.end])).toEqual([
      [0, 1],
      [1, 3],
      [3, 3],
    ]);
    expect(cardOfStep(cards, 0)).toBe(0);
    expect(cardOfStep(cards, 2)).toBe(1);
    expect(cardOfStep(cards, 9)).toBe(-1);
  });

  it("keeps terminal, login and answers of a step", () => {
    const { steps } = buildTopicScript([
      block(1, "COMMAND", {
        steps: [
          { command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } },
          { command: "nano a.txt", answers: ["um", 3, "dois"] },
          { command: "" , login: { user: 5 } },
        ],
      }),
    ]);
    expect(steps[0]).toMatchObject({ terminal: 2, login: { user: "ricardo", password: "123" } });
    expect(steps[1]?.answers).toEqual(["um", "dois"]);
    expect(steps[2]).toEqual({ index: 2, command: "" });
  });

  it("returns no cards for an empty module and ignores COMMAND blocks without steps", () => {
    expect(buildTopicScript([])).toEqual({ cards: [], steps: [] });
    expect(buildTopicScript([block(1, "COMMAND", {})]).steps).toEqual([]);
  });
});
