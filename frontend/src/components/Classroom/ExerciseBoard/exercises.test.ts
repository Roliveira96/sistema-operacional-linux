import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/services/contentService";
import type { ExerciseProgressEntry } from "@/services/classroomService";
import { boardExercises, cardState, clampMinutes, hintMessage, hintsOf, mmss, secondsLeft, SIGNAL_TIMEOUT_MS } from "./exercises";

const condition = { kind: "FILE_EXISTS", path: "/home/a" };
const item = (over: Record<string, unknown> = {}) => ({ title: "Listar", difficulty: "EASY", conditions: [condition], ...over });
const block = (id: string, position: number, type: string, items?: unknown[]): ContentBlock => ({ id, type, position, payload: items ? { items } : {} });

// SPEC-065 3.3: the list of the exercises of the module, which the panel offers to start
describe("boardExercises", () => {
  it("lists the exercises of the EXERCISES blocks in the order of block and item, with the number of the block among all the blocks", () => {
    const list = boardExercises([
      block("b-3", 3, "EXERCISES", [item({ title: "Terceiro" }), item({ title: "Quarto", difficulty: "HARD" })]),
      block("b-1", 1, "TEXT"),
      block("b-2", 2, "EXERCISES", [item({ title: "Primeiro", difficulty: "MEDIUM" })]),
    ]);
    expect(list.map((e) => [e.blockId, e.blockNumber, e.index, e.title, e.difficulty])).toEqual([
      ["b-2", 2, 0, "Primeiro", "MEDIUM"],
      ["b-3", 3, 0, "Terceiro", "EASY"],
      ["b-3", 3, 1, "Quarto", "HARD"],
    ]);
  });

  it("leaves out the questions that are not solved in the terminal, and keeps the index the server knows for the others", () => {
    const list = boardExercises([block("b-1", 1, "EXERCISES", [item({ kind: "THEORETICAL_BOOLEAN", title: "Verdadeiro" }), item({ kind: "DISCURSIVE" }), item({ kind: "PRACTICAL", title: "Prático" }), item({ title: "Sem tipo" })])]);
    expect(list.map((e) => [e.index, e.title])).toEqual([
      [2, "Prático"],
      [3, "Sem tipo"],
    ]);
  });

  it("counts the conditions of each exercise, none when there is no list", () => {
    const list = boardExercises([
      block("b-1", 1, "EXERCISES", [item({ conditions: [condition, condition, condition] }), item({ conditions: [] }), item({ conditions: undefined }), item({ conditions: "x" })]),
    ]);
    expect(list.map((e) => e.conditions)).toEqual([3, 0, 0, 0]);
  });

  it("reads the hints with their text and command, and drops the ones with no text", () => {
    const [first] = boardExercises([block("b-1", 1, "EXERCISES", [item({ hints: [{ text: "Use ls", command: "ls -l" }, { text: "Sem comando" }, { text: "  " }, { command: "só comando" }, "x", null] })])]);
    expect(first!.hints).toEqual([
      { text: "Use ls", command: "ls -l" },
      { text: "Sem comando", command: "" },
    ]);
  });

  it("takes the middle level and an empty title when the block does not say them, and skips what is not an exercise", () => {
    const list = boardExercises([
      block("b-1", 1, "EXERCISES", [{ conditions: [condition] }, item({ difficulty: "IMPOSSIBLE" }), "texto", null, 7, [1]]),
      block("b-2", 2, "TEXT", [item()]),
      { id: "b-3", type: "EXERCISES", position: 3, payload: { items: "not a list" } },
      { id: "b-4", type: "EXERCISES", position: 4, payload: {} },
    ]);
    expect(list.map((e) => [e.index, e.title, e.difficulty])).toEqual([
      [0, "", "MEDIUM"],
      [1, "Listar", "MEDIUM"],
    ]);
  });

  it("finds nothing in a module with no blocks", () => {
    expect(boardExercises([])).toEqual([]);
  });
});

describe("hintsOf", () => {
  const list = boardExercises([block("b-1", 1, "EXERCISES", [item({ hints: [{ text: "A" }] }), item({ hints: [{ text: "B" }, { text: "C" }] })])]);

  it("gives the hints of the exercise the round is about", () => {
    expect(hintsOf(list, { blockId: "b-1", index: 1 }).map((h) => h.text)).toEqual(["B", "C"]);
  });

  it("gives none for an exercise that is not in the list, or when there is no list", () => {
    expect(hintsOf(list, { blockId: "b-9", index: 0 })).toEqual([]);
    expect(hintsOf(null, { blockId: "b-1", index: 0 })).toEqual([]);
  });
});

// SPEC-065 3.3: the minutes of the exercise are from 1 to 60, 5 by default
describe("clampMinutes", () => {
  it.each([
    ["", 5],
    ["abc", 5],
    ["0", 1],
    ["-3", 1],
    ["1", 1],
    ["7", 7],
    ["2.9", 2],
    ["60", 60],
    ["61", 60],
    ["90", 60],
    [Number.NaN, 5],
    [12, 12],
  ] as const)("takes %j as %i", (typed, minutes) => {
    expect(clampMinutes(typed)).toBe(minutes);
  });
});

describe("mmss", () => {
  it.each([
    [0, "00:00"],
    [9, "00:09"],
    [59, "00:59"],
    [60, "01:00"],
    [300, "05:00"],
    [3600, "60:00"],
    [-5, "00:00"],
    [205.9, "03:25"],
  ])("writes %d seconds as %s", (seconds, text) => {
    expect(mmss(seconds)).toBe(text);
  });
});

// SPEC-065 CA-03: the clock counts from the end of the round and the time of the server
describe("secondsLeft", () => {
  const endsAt = "2026-10-14T10:05:00Z";
  const at = (iso: string) => Date.parse(iso);

  it("counts what is left until the end", () => {
    expect(secondsLeft(endsAt, 0, at("2026-10-14T10:00:00Z"))).toBe(300);
    expect(secondsLeft(endsAt, 0, at("2026-10-14T10:04:59Z"))).toBe(1);
  });

  it("counts a started second as a second left, so the clock reaches zero at the end", () => {
    expect(secondsLeft(endsAt, 0, at("2026-10-14T10:00:00.400Z"))).toBe(300);
    expect(secondsLeft(endsAt, 0, at("2026-10-14T10:04:59.999Z"))).toBe(1);
  });

  it("corrects the clock of the browser by how far it is from the server", () => {
    expect(secondsLeft(endsAt, 2000, at("2026-10-14T10:00:00Z"))).toBe(298);
    expect(secondsLeft(endsAt, -3000, at("2026-10-14T10:00:00Z"))).toBe(303);
  });

  it("never goes below zero", () => {
    expect(secondsLeft(endsAt, 0, at("2026-10-14T10:05:00Z"))).toBe(0);
    expect(secondsLeft(endsAt, 0, at("2026-10-14T11:00:00Z"))).toBe(0);
  });
});

// SPEC-065 CA-06: "Sem sinal" after 15 s with no progress
describe("cardState", () => {
  const startedAt = "2026-10-14T10:00:00Z";
  const start = Date.parse(startedAt);
  const entry = (over: Partial<ExerciseProgressEntry> = {}): ExerciseProgressEntry => ({ studentId: "u-1", met: 1, total: 3, last: "ls", at: startedAt, ...over });

  it("is 15 seconds, as the spec says", () => {
    expect(SIGNAL_TIMEOUT_MS).toBe(15_000);
  });

  it("is doing while the last progress is recent", () => {
    expect(cardState(entry({ at: "2026-10-14T10:00:20Z" }), startedAt, start + 25_000)).toBe("doing");
  });

  it("is doing at exactly 15 seconds and without signal after that", () => {
    expect(cardState(entry({ at: "2026-10-14T10:00:20Z" }), startedAt, start + 35_000)).toBe("doing");
    expect(cardState(entry({ at: "2026-10-14T10:00:20Z" }), startedAt, start + 35_001)).toBe("silent");
  });

  it("counts from the start of the round for a student who never sent progress", () => {
    expect(cardState(undefined, startedAt, start + 15_000)).toBe("doing");
    expect(cardState(undefined, startedAt, start + 15_001)).toBe("silent");
  });

  it("counts from the start of the round when the progress has no valid time", () => {
    expect(cardState(entry({ at: "" }), startedAt, start + 10_000)).toBe("doing");
    expect(cardState(entry({ at: "not a time" }), startedAt, start + 16_000)).toBe("silent");
  });

  it("is done for whoever finished, however long ago", () => {
    expect(cardState(entry({ completedAt: "2026-10-14T10:03:00Z" }), startedAt, start + 3_600_000)).toBe("done");
  });
});

// SPEC-065 CA-08: the tip goes to the chat with its text and the command of reference
describe("hintMessage", () => {
  it("has the text of the tip", () => {
    expect(hintMessage({ text: "Veja o ls", command: "" })).toBe("Dica: Veja o ls");
  });

  it("has the command of reference on a line of its own", () => {
    expect(hintMessage({ text: "Veja o ls", command: "ls -l /etc" })).toBe("Dica: Veja o ls\nComando: ls -l /etc");
  });

  it("keeps what the chat takes: no control characters, and the line breaks in order", () => {
    expect(hintMessage({ text: "a\u0007b\n\n\n\n\nc", command: "" })).toBe("Dica: ab\n\n\nc");
  });

  it("is never longer than a message of the chat", () => {
    expect(Array.from(hintMessage({ text: "x".repeat(900), command: "" })).length).toBe(500);
  });
});
