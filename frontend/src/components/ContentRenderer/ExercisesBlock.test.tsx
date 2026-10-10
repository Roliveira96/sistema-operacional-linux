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
