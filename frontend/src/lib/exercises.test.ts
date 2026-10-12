import { describe, expect, it } from "vitest";
import { cardTestItems, emptyExercise, exercisesPayload, exerciseTestItems, hasExercises, missingAnswer, parseExercises, trueFalseFields, type ExerciseGroup } from "./exercises";

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

// Covers SPEC-035 RN-14, CA-18 and CA-19 on the screen: the true or false item of the exercises of a card.
describe("true or false exercises of a card", () => {
  const block = {
    items: [
      { kind: "THEORETICAL_BOOLEAN", title: "rm -r", difficulty: "EASY", description: "<p>rm -r removes non-empty directories.</p>", correctAnswer: false, explanation: "<p>Why</p>" },
      { kind: "THEORETICAL_BOOLEAN", title: "draft", difficulty: "HARD" },
    ],
  };

  it("reads and writes the answer and the justification, without solution nor conditions", () => {
    const group = parseExercises(block);
    expect(group.items[0]).toMatchObject({ kind: "THEORETICAL_BOOLEAN", correctAnswer: false, explanation: "<p>Why</p>" });
    expect(group.items[1]).toMatchObject({ kind: "THEORETICAL_BOOLEAN", correctAnswer: null, explanation: "" });
    const payload = exercisesPayload({ items: [{ ...group.items[0]!, solution: { summary: "", steps: [{ command: "ls" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/a" }] }] });
    expect(payload.items).toEqual([
      { kind: "THEORETICAL_BOOLEAN", title: "rm -r", difficulty: "EASY", description: "<p>rm -r removes non-empty directories.</p>", correctAnswer: false, explanation: "<p>Why</p>" },
    ]);
    expect((exercisesPayload({ items: [group.items[1]!] }).items as unknown[])[0]).not.toHaveProperty("correctAnswer");
  });

  it("starts a new exercise of the chosen kind", () => {
    expect(emptyExercise("THEORETICAL_BOOLEAN")).toMatchObject({ kind: "THEORETICAL_BOOLEAN", correctAnswer: null, explanation: "" });
    expect(emptyExercise()).not.toHaveProperty("kind");
  });

  // Covers SPEC-035 RN-09 and CA-13 for the test of the card: nothing runs, and an incomplete one fails.
  it("is checked only for being complete in the test of the card", () => {
    const group = parseExercises(block);
    expect(missingAnswer(group.items[0]!)).toEqual([]);
    expect(missingAnswer(group.items[1]!)).toEqual(["statement", "correctAnswer"]);
    expect(missingAnswer(emptyExercise())).toEqual([]);
    const { items } = exerciseTestItems(group);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ noTerminal: true });
    expect(items[1]).toMatchObject({ untestable: "no-answer" });
    expect(items[1]!.command).toContain("falta a descrição, falta a resposta correta");
  });
});

// Covers SPEC-036 RN-02, RN-04, RN-09, D-02 and D-07 on the screen: the single choice item of the exercises of a card.
describe("single choice exercises of a card", () => {
  const block = {
    items: [
      {
        kind: "THEORETICAL_SINGLE",
        title: "chmod",
        difficulty: "EASY",
        description: "<p>Which one changes permissions?</p>",
        choices: [{ id: "a", html: "<p>chmod</p>" }, { id: "b", html: "<p>chown</p>" }],
        correctChoice: "a",
        shuffleChoices: false,
        explanation: "<p>Why</p>",
      },
    ],
  };

  it("reads and writes the alternatives, the correct one and the order", () => {
    const group = parseExercises(block);
    expect(group.items[0]).toMatchObject({ kind: "THEORETICAL_SINGLE", correctChoice: "a", shuffleChoices: false, explanation: "<p>Why</p>" });
    expect(group.items[0]!.choices).toEqual([{ id: "a", html: "<p>chmod</p>" }, { id: "b", html: "<p>chown</p>" }]);
    expect(exercisesPayload(group).items).toEqual([
      {
        kind: "THEORETICAL_SINGLE",
        title: "chmod",
        difficulty: "EASY",
        description: "<p>Which one changes permissions?</p>",
        choices: [{ id: "a", html: "<p>chmod</p>" }, { id: "b", html: "<p>chown</p>" }],
        correctChoice: "a",
        shuffleChoices: false,
        explanation: "<p>Why</p>",
      },
    ]);
    const bare = parseExercises({ items: [{ kind: "THEORETICAL_SINGLE", title: "x", difficulty: "EASY", choices: [{ html: "a" }, "junk"] }] }).items[0]!;
    expect(bare.choices).toHaveLength(1);
    expect(bare.choices![0]!.id).not.toBe("");
    expect(bare).toMatchObject({ correctChoice: null, shuffleChoices: true });
  });

  it("starts a new one with two empty alternatives that shuffle", () => {
    const ex = emptyExercise("THEORETICAL_SINGLE");
    expect(ex.choices).toHaveLength(2);
    expect(ex).toMatchObject({ kind: "THEORETICAL_SINGLE", correctChoice: null, shuffleChoices: true });
    expect(ex).not.toHaveProperty("correctAnswer");
  });

  // Covers SPEC-036 RN-04 and CA-04, CA-11.
  it("says what it misses: alternatives, empty or repeated ones, the correct one", () => {
    const ok = parseExercises(block).items[0]!;
    expect(missingAnswer(ok)).toEqual([]);
    expect(missingAnswer({ ...ok, choices: [{ id: "a", html: "<p>x</p>" }] })).toEqual(["choices"]);
    expect(missingAnswer({ ...ok, choices: [{ id: "a", html: "<p>Chmod</p>" }, { id: "b", html: "<b>chmod</b>" }, { id: "c", html: "<p> </p>" }] })).toEqual(["choiceEmpty", "choiceRepeated"]);
    expect(missingAnswer({ ...ok, description: "", correctChoice: "zz" })).toEqual(["statement", "correctChoice"]);
    expect(missingAnswer({ ...ok, choices: [{ id: "a", html: '<img src="https://x/a.avif">' }, { id: "b", html: "<p>b</p>" }] })).toEqual([]);
    const { items } = exerciseTestItems({ items: [ok, { ...ok, correctChoice: null }] });
    expect(items[0]).toMatchObject({ noTerminal: true });
    expect(items[1]).toMatchObject({ untestable: "no-answer" });
    expect(items[1]!.command).toContain("falta marcar a alternativa correta");
  });
});

// Covers SPEC-037 RN-02, RN-04, RN-09, D-09 and D-10 on the screen: the matching item of the exercises of a card.
describe("matching exercises of a card", () => {
  const block = {
    items: [
      {
        kind: "THEORETICAL_MATCHING",
        title: "commands",
        difficulty: "EASY",
        description: "<p>Link them.</p>",
        left: [{ id: "l1", text: "chmod" }, { id: "l2", text: "chown" }],
        right: [{ id: "r1", text: "owner" }, { id: "r2", text: "mode" }],
        pairs: [{ left: "l1", right: "r2" }, { left: "l2", right: "r1" }],
        shuffleChoices: false,
      },
    ],
  };

  it("reads and writes the columns, the pairs and the order", () => {
    const group = parseExercises(block);
    expect(group.items[0]).toMatchObject({ kind: "THEORETICAL_MATCHING", shuffleChoices: false, pairs: block.items[0]!.pairs });
    expect(group.items[0]!.left).toEqual(block.items[0]!.left);
    expect(exercisesPayload(group).items).toEqual([
      { kind: "THEORETICAL_MATCHING", title: "commands", difficulty: "EASY", description: "<p>Link them.</p>", left: block.items[0]!.left, right: block.items[0]!.right, pairs: block.items[0]!.pairs, shuffleChoices: false },
    ]);
    const bare = parseExercises({ items: [{ kind: "THEORETICAL_MATCHING", title: "x", difficulty: "EASY", left: [{ text: "a" }, 3], pairs: [{ left: "x" }] }] }).items[0]!;
    expect(bare.left).toHaveLength(1);
    expect(bare.left![0]!.id).not.toBe("");
    expect(bare.right).toEqual([]);
    expect(bare.pairs).toEqual([]);
    expect(bare.shuffleChoices).toBe(true);
  });

  it("starts a new one with two empty items in each column", () => {
    const ex = emptyExercise("THEORETICAL_MATCHING");
    expect(ex.left).toHaveLength(2);
    expect(ex.right).toHaveLength(2);
    expect(ex).toMatchObject({ kind: "THEORETICAL_MATCHING", pairs: [], shuffleChoices: true });
  });

  // Covers SPEC-037 RN-04, CA-04 and CA-12.
  it("says what it misses: items, empty or repeated ones, and the pairs", () => {
    const ok = parseExercises(block).items[0]!;
    expect(missingAnswer(ok)).toEqual([]);
    expect(missingAnswer({ ...ok, left: [{ id: "l1", text: "Chmod" }, { id: "l2", text: "chmod " }], right: [{ id: "r1", text: "" }, { id: "r2", text: "mode" }] })).toEqual([
      "itemEmpty",
      "itemRepeated",
    ]);
    expect(missingAnswer({ ...ok, right: [{ id: "r1", text: "x" }], pairs: [] })).toEqual(["columns", "pairs"]);
    expect(missingAnswer({ ...ok, description: "", pairs: [{ left: "l1", right: "r2" }] })).toEqual(["statement", "pairs"]);
    const { items } = exerciseTestItems({ items: [ok, { ...ok, pairs: [] }] });
    expect(items[0]).toMatchObject({ noTerminal: true });
    expect(items[1]!.command).toContain("falta ligar os pares corretos");
  });
});

// Covers SPEC-039 RN-01, RN-02 and D-05 on the screen: the descriptive question.
describe("descriptive questions", () => {
  it("starts with no correct answer and the default size", () => {
    expect(emptyExercise("DISCURSIVE")).toMatchObject({ kind: "DISCURSIVE", expectedAnswer: "", maxLength: 2000 });
  });

  it("reads the correct answer and the size, and a size out of the list is the default", () => {
    expect(trueFalseFields({ kind: "DISCURSIVE", expectedAnswer: "<p>rwx</p>", maxLength: 5000 })).toEqual({ kind: "DISCURSIVE", expectedAnswer: "<p>rwx</p>", maxLength: 5000 });
    expect(trueFalseFields({ kind: "DISCURSIVE", maxLength: 1234 })).toEqual({ kind: "DISCURSIVE", expectedAnswer: "", maxLength: 2000 });
  });

  it("needs only a description to be published", () => {
    const ex = { ...emptyExercise("DISCURSIVE"), description: "<p>Explain chmod 750.</p>" };
    expect(missingAnswer(ex)).toEqual([]);
    expect(missingAnswer({ ...ex, description: "<p> </p>" })).toEqual(["statement"]);
  });
});
