import { describe, expect, it } from "vitest";
import { cardTestItems, emptyExercise, exercisesPayload, exerciseTestItems, hasExercises, parseExercises, type ExerciseGroup } from "./exercises";

const NL = String.fromCharCode(10);

const stored = {
  items: [
    {
      title: "Criar a pasta",
      difficulty: "EASY",
      description: "<p>Crie a pasta</p>",
      hints: [{ text: "Use o mkdir", command: "mkdir /srv/x" }, { text: "Sem comando" }],
      solution: { summary: "", steps: [{ command: "mkdir /srv/x", terminal: 2, login: { user: "ana", password: "1" } }], files: [{ path: "/srv/x/a.txt", content: "oi" + NL }] },
      conditions: [{ kind: "DIR_EXISTS", path: "/srv/x" }, { kind: "FILE_CONTENT", path: "/srv/x/a.txt", content: "oi" + NL, match: "contains" }],
    },
    { title: "Sem solução", difficulty: "HARD" },
  ],
  setup: { summary: "base", steps: [{ command: "mkdir /srv" }] },
};

// Covers SPEC-022: the group of exercises of a card.
describe("exercises", () => {
  it("reads the group of a block, with the level, tips, solution and conditions", () => {
    const group = parseExercises(stored, "b1", "2026-10-10T12:00:00Z");
    expect(group.blockId).toBe("b1");
    expect(group.setup?.steps).toEqual([{ command: "mkdir /srv" }]);
    expect(group.items.map((i) => [i.title, i.difficulty])).toEqual([["Criar a pasta", "EASY"], ["Sem solução", "HARD"]]);
    expect(group.items[0]!.hints.map((h) => [h.text, h.command])).toEqual([["Use o mkdir", "mkdir /srv/x"], ["Sem comando", ""]]);
    expect(group.items[0]!.solution?.steps[0]).toMatchObject({ command: "mkdir /srv/x", terminal: 2 });
    expect(group.items[0]!.conditions).toHaveLength(2);
    expect(group.items[0]!.conditions[1]).toMatchObject({ match: "contains" });
  });

  it("falls back to a medium level, and tolerates a block that is not what it should be", () => {
    expect(parseExercises({ items: [{ title: "A", difficulty: "IMPOSSIVEL" }] }).items[0]!.difficulty).toBe("MEDIUM");
    expect(parseExercises({}).items).toEqual([]);
    expect(parseExercises({ items: [null, 3, "x"] }).items).toHaveLength(3);
  });

  it("builds the payload trimmed and without the empty parts, and a payload read again is the same", () => {
    const group = parseExercises(stored);
    const payload = exercisesPayload(group) as { items: Record<string, unknown>[]; setup: unknown };
    expect(payload.items[1]).toEqual({ title: "Sem solução", difficulty: "HARD" });
    expect(payload.items[0]).toMatchObject({ title: "Criar a pasta", description: "<p>Crie a pasta</p>" });
    expect(payload.setup).toEqual({ summary: "base", steps: [{ command: "mkdir /srv" }] });
    expect(exercisesPayload(parseExercises(payload))).toEqual(payload);

    const loose: ExerciseGroup = { items: [{ ...emptyExercise(), title: "  A  ", hints: [{ id: "h", text: " dica ", command: "  " }] }] };
    expect(exercisesPayload(loose)).toEqual({ items: [{ title: "A", difficulty: "MEDIUM", hints: [{ text: "dica" }] }] });
  });

  it("has something to store with an exercise or with a snapshot, and nothing otherwise", () => {
    expect(hasExercises(undefined)).toBe(false);
    expect(hasExercises({ items: [] })).toBe(false);
    expect(hasExercises({ items: [emptyExercise()] })).toBe(true);
    expect(hasExercises({ items: [], setup: { summary: "", steps: [{ command: "ls" }] } })).toBe(true);
  });
});

describe("exerciseTestItems", () => {
  it("runs the solution of each exercise, in order, and then checks how it ends; an exercise that cannot be tested is marked, not skipped", () => {
    const { items, sections } = exerciseTestItems(parseExercises(stored));
    expect(items.map((i) => i.command)).toEqual([
      "mkdir /srv/x",
      "(1 arquivo da solução)",
      "(conferir como o exercício termina: 2 condições)",
      "(sem solução gravada: grave como fazer o exercício no terminal para poder testá-lo)",
    ]);
    expect(items[3]).toMatchObject({ untestable: "no-solution" });
    expect(items[0]).toMatchObject({ terminal: 2, login: { user: "ana", password: "1" } });
    expect(items[1]!.files).toEqual([{ path: "/srv/x/a.txt", content: "oi" + NL }]);
    expect(items[2]!.check).toHaveLength(2);
    expect(sections).toEqual({ 0: "Exercício: Criar a pasta", 3: "Exercício: Sem solução" });
  });

  it("marks an exercise that has a solution but no conditions, since how it ends cannot be checked", () => {
    const group = parseExercises({ items: [{ title: "Só solução", difficulty: "EASY", solution: { summary: "", steps: [{ command: "ls" }] } }] });
    const { items } = exerciseTestItems(group);
    expect(items.map((i) => i.untestable)).toEqual([undefined, "no-conditions"]);
  });

  it("puts the exercises after the commands of the card, with the labels at the right place", () => {
    const commands = [{ id: "c1", terminal: 1, command: "ls", expectError: false, answers: [] }];
    const { items, exerciseSections } = cardTestItems({ commands, exercises: parseExercises(stored) });
    expect(items.map((i) => i.command)[0]).toBe("ls");
    expect(items).toHaveLength(5);
    expect(exerciseSections).toEqual({ 1: "Exercício: Criar a pasta", 4: "Exercício: Sem solução" });
    expect(cardTestItems({ commands, exercises: undefined })).toEqual({ items: commands, exerciseSections: {} });
  });
});
