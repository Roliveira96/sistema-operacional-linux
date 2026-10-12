import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseChecker } from "./exerciseContext";
import { ExerciseCheckContext } from "./exerciseContext";
import { ExercisesBlock } from "./ExercisesBlock";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const payload = {
  items: [
    {
      title: "Criar a pasta financeiro",
      difficulty: "EASY",
      description: "<p>Crie a pasta <b>financeiro</b> em /home/ricardo.</p>",
      hints: [{ text: "Use o mkdir" }, { text: "Dê o caminho completo", command: "mkdir /home/ricardo/financeiro" }, { text: "Confira com ls" }],
      solution: { steps: [{ command: "mkdir /home/ricardo/financeiro" }], files: [{ path: "/home/ricardo/financeiro/a.txt" }] },
      conditions: [{ kind: "DIR_EXISTS", path: "/home/ricardo/financeiro" }],
    },
    { title: "Sem nada", difficulty: "HARD" },
  ],
};

const machine = (...folders: string[]) => ({
  raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: folders.map((nome) => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] })) },
  contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
});

function renderWith(checker: ExerciseChecker | null) {
  return render(
    <ExerciseCheckContext.Provider value={checker}>
      <ExercisesBlock payload={payload} />
    </ExerciseCheckContext.Provider>,
  );
}

// Covers SPEC-022 CA-06, CA-10 and CA-11: what the student sees of the exercises.
describe("ExercisesBlock", () => {
  it("shows each exercise with its title, level and statement, and no tip until the student asks", () => {
    renderWith(null);
    expect(screen.getByRole("heading", { name: "Exercícios" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Criar a pasta financeiro" })).toBeDefined();
    expect(screen.getByText("Fácil")).toBeDefined();
    expect(screen.getByText("Difícil")).toBeDefined();
    expect(screen.getByText("financeiro", { selector: "b" })).toBeDefined();
    expect(screen.queryByText("Use o mkdir")).toBeNull();
    expect(screen.queryByRole("list", { name: "Dicas" })).toBeNull();
  });

  it("reveals one tip at a time, in order, with its command, and stops offering when there are no more", () => {
    renderWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar dica (1 de 3)" }));
    expect(screen.getByText("Use o mkdir")).toBeDefined();
    expect(screen.queryByText("Dê o caminho completo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar dica (2 de 3)" }));
    expect(screen.getByText("Dê o caminho completo")).toBeDefined();
    expect(screen.getByText("mkdir /home/ricardo/financeiro", { selector: "code" })).toBeDefined();
    expect(screen.queryByText("Confira com ls")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar dica (3 de 3)" }));
    expect(screen.getByText("Confira com ls")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Mostrar dica/ })).toBeNull();
  });

  it("shows how the teacher did it only when asked, and says it is one of the ways", () => {
    renderWith(null);
    expect(screen.queryByText(/Esta é uma das formas de fazer/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver como o professor fez" }));
    expect(screen.getByText(/Esta é uma das formas de fazer/)).toBeDefined();
    expect(screen.getByText("mkdir /home/ricardo/financeiro", { selector: "code" })).toBeDefined();
    expect(screen.getByText("Escreve o arquivo /home/ricardo/financeiro/a.txt")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Esconder como o professor fez" }));
    expect(screen.queryByText(/Esta é uma das formas de fazer/)).toBeNull();
    // An exercise with no solution does not offer it.
    expect(screen.getAllByRole("button", { name: /como o professor fez/ })).toHaveLength(1);
  });

  it("checks how it ended on the machine of the student, tells what is missing, and marks it done when everything holds", () => {
    let current = machine();
    renderWith({ check: (conditions) => ({ done: conditions.every((c) => c.path === "/home/ricardo/financeiro" && current.raiz.filhos.some((f) => f.nome === "financeiro")), missing: conditions.filter(() => !current.raiz.filhos.length) }) });
    fireEvent.click(screen.getByRole("button", { name: "Verificar meu exercício" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Ainda falta:");
    expect(screen.getByRole("alert")).toHaveTextContent("A pasta /home/ricardo/financeiro existe");
    expect(screen.queryByText("✓ Exercício concluído")).toBeNull();

    current = machine("financeiro");
    fireEvent.click(screen.getByRole("button", { name: "Verificar meu exercício" }));
    expect(screen.getByText("✓ Exercício concluído")).toBeDefined();
    expect(screen.queryByText("Ainda falta:")).toBeNull();
  });

  it("remembers in this browser that an exercise is done", () => {
    const checker: ExerciseChecker = { check: () => ({ done: true, missing: [] }) };
    const first = renderWith(checker);
    fireEvent.click(screen.getByRole("button", { name: "Verificar meu exercício" }));
    expect(screen.getByText("✓ Exercício concluído")).toBeDefined();
    first.unmount();
    renderWith(checker);
    expect(screen.getByText("✓ Exercício concluído")).toBeDefined();
  });

  it("only offers the check when the screen can check, and when the exercise has conditions", () => {
    renderWith(null);
    expect(screen.queryByRole("button", { name: "Verificar meu exercício" })).toBeNull();
    cleanup();
    renderWith({ check: vi.fn(() => ({ done: false, missing: [] })) });
    // The second exercise has no conditions, so only the first one has the button.
    expect(screen.getAllByRole("button", { name: "Verificar meu exercício" })).toHaveLength(1);
  });

  it("asks the student to wait when the terminal is not there yet", () => {
    renderWith({ check: () => null });
    fireEvent.click(screen.getByRole("button", { name: "Verificar meu exercício" }));
    expect(screen.getByRole("alert")).toHaveTextContent("O terminal ainda está carregando");
  });

  it("shows nothing for a group with no exercises", () => {
    const { container } = render(<ExercisesBlock payload={{ items: [], setup: { steps: [] } }} />);
    expect(container.textContent).toBe("");
  });
});

// Covers SPEC-035 CA-20 and D-14: the true or false exercise of a card, answered once and checked on the screen.
describe("ExercisesBlock with a true or false exercise", () => {
  const trueFalse = {
    items: [
      {
        kind: "THEORETICAL_BOOLEAN",
        title: "rm -r",
        difficulty: "MEDIUM",
        description: "<p>rm -r removes non-empty directories.</p>",
        hints: [{ text: "Think of -r" }],
        correctAnswer: true,
        explanation: "<p>It is recursive.</p>",
      },
    ],
  };
  const checker: ExerciseChecker = { check: () => null };
  const show = (value: ExerciseChecker | null) =>
    render(
      <ExerciseCheckContext.Provider value={value}>
        <ExercisesBlock payload={trueFalse} />
      </ExerciseCheckContext.Provider>,
    );

  it("shows the result at once, locks the answer and keeps it in this browser", () => {
    show(checker);
    expect(screen.queryByRole("button", { name: "Verificar meu exercício" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar dica (1 de 1)" }));
    expect(screen.getByText("Think of -r")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Falso" }));
    expect(screen.getByText("Você errou.")).toBeDefined();
    expect(screen.getByText("It is recursive.")).toBeDefined();
    expect((screen.getByRole("button", { name: "Verdadeiro" }) as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    show(checker);
    expect(screen.getByText("Você errou."), "the answer stays locked after reloading").toBeDefined();
  });

  it("in the preview of the teacher, answers without keeping anything", () => {
    show(null);
    fireEvent.click(screen.getByRole("button", { name: "Verdadeiro" }));
    expect(screen.getByText("Você acertou!")).toBeDefined();
    cleanup();
    show(null);
    expect(screen.queryByText("Você acertou!")).toBeNull();
  });
});

// Covers SPEC-036 CA-10, D-03 and D-07: the single choice exercise of a card, answered once and checked on the screen.
describe("ExercisesBlock with a single choice exercise", () => {
  const item = (shuffleChoices: boolean) => ({
    items: [
      {
        kind: "THEORETICAL_SINGLE",
        title: "chmod",
        difficulty: "EASY",
        description: "<p>Which one?</p>",
        hints: [{ text: "Think of mode" }],
        choices: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `c${n}`, html: `<p>opção ${n}</p>` })),
        correctChoice: "c1",
        shuffleChoices,
        explanation: "<p>Because.</p>",
      },
    ],
  });
  const checker: ExerciseChecker = { check: () => null };
  const show = (payload: Record<string, unknown>, value: ExerciseChecker | null = checker) =>
    render(
      <ExerciseCheckContext.Provider value={value}>
        <ExercisesBlock payload={payload} />
      </ExerciseCheckContext.Provider>,
    );
  const order = () => screen.getAllByRole("button", { name: /opção/ }).map((b) => b.textContent?.match(/opção (\d)/)?.[1]).join("");

  it("keeps the order of the teacher when asked, and shuffles it otherwise", () => {
    show(item(false));
    expect(order()).toBe("1234567");
    cleanup();
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      show(item(true));
      seen.add(order());
      cleanup();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("shows the result at once, locks the answer and keeps it in this browser", () => {
    show(item(false));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar dica (1 de 1)" }));
    expect(screen.getByText("Think of mode")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /opção 3/ }));
    expect(screen.getByText("Você errou.")).toBeDefined();
    expect(screen.getByText("Because.")).toBeDefined();
    cleanup();
    show(item(false));
    expect(screen.getByText("Você errou."), "locked after reloading").toBeDefined();
  });

  it("in the preview of the teacher, answers without keeping anything", () => {
    show(item(false), null);
    fireEvent.click(screen.getByRole("button", { name: /opção 1/ }));
    expect(screen.getByText("Você acertou!")).toBeDefined();
    cleanup();
    show(item(false), null);
    expect(screen.queryByText("Você acertou!")).toBeNull();
  });
});

// Covers SPEC-037 CA-11 and D-10: the matching exercise of a card, checked on the screen and locked in this browser.
describe("ExercisesBlock with a matching exercise", () => {
  const payload = (shuffleChoices: boolean) => ({
    items: [
      {
        kind: "THEORETICAL_MATCHING",
        title: "commands",
        difficulty: "EASY",
        left: [1, 2, 3, 4, 5].map((n) => ({ id: `l${n}`, text: `cmd ${n}` })),
        right: [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, text: `what ${n}` })),
        pairs: [1, 2, 3, 4, 5].map((n) => ({ left: `l${n}`, right: `r${n}` })),
        shuffleChoices,
        hints: [{ text: "Think" }],
      },
    ],
  });
  const checker: ExerciseChecker = { check: () => null };
  const show = (p: Record<string, unknown>, value: ExerciseChecker | null = checker) =>
    render(
      <ExerciseCheckContext.Provider value={value}>
        <ExercisesBlock payload={p} />
      </ExerciseCheckContext.Provider>,
    );
  const order = () => screen.getAllByRole("button", { name: /^what/ }).map((b) => b.textContent?.match(/what (\d)/)?.[1]).join("");

  it("keeps the order of the teacher when asked, and shuffles it otherwise", () => {
    show(payload(false));
    expect(order()).toBe("12345");
    cleanup();
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      show(payload(true));
      seen.add(order());
      cleanup();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("checks the links on the screen and keeps the answer locked", () => {
    show(payload(false));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar dica (1 de 1)" }));
    for (let n = 1; n <= 5; n++) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^cmd ${n}`) }));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^what ${n === 1 ? 2 : n === 2 ? 1 : n}`) }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Conferir minhas ligações" }));
    expect(screen.getByText("Você errou.")).toBeDefined();
    expect(screen.getAllByText("ligação errada")).toHaveLength(2);
    cleanup();
    show(payload(false));
    expect(screen.getByText("Você errou."), "locked after reloading").toBeDefined();
  });

  it("in the preview of the teacher, checks without keeping anything", () => {
    show(payload(false), null);
    for (let n = 1; n <= 5; n++) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^cmd ${n}`) }));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^what ${n}`) }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Conferir minhas ligações" }));
    expect(screen.getByText("Você acertou!")).toBeDefined();
    cleanup();
    show(payload(false), null);
    expect(screen.queryByText("Você acertou!")).toBeNull();
  });
});
