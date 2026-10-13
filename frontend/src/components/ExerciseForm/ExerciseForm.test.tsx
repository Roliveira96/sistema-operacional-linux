import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyExercise, type Exercise } from "@/lib/exercises";
import { ExerciseForm } from "./ExerciseForm";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
afterEach(cleanup);

const form = (exercise: Exercise, onChange = vi.fn()) => {
  render(<ExerciseForm exercise={exercise} onChange={onChange} before={[]} loadBase={vi.fn()} errors={{}} uploadImage={vi.fn()} />);
  return onChange;
};

// Covers SPEC-035 CA-02 and SPEC-036 CA-02, CA-03 and D-07: the parts of the form of each kind without a terminal.
describe("ExerciseForm without a terminal", () => {
  it("chooses the answer of a true or false question", () => {
    const onChange = form({ ...emptyExercise("THEORETICAL_BOOLEAN"), correctAnswer: true });
    expect((screen.getByRole("radio", { name: "Verdadeiro" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Falso" }));
    expect(onChange).toHaveBeenCalledWith({ correctAnswer: false });
    expect(screen.queryByText(/Como fazer/)).toBeNull();
  });

  it("edits the alternatives of a single choice question within 2 and 7", () => {
    const ex: Exercise = {
      ...emptyExercise("THEORETICAL_SINGLE"),
      choices: [
        { id: "a", html: "<p>a</p>" },
        { id: "b", html: "<p>b</p>" },
        { id: "c", html: "<p>c</p>" },
      ],
      correctChoice: "b",
      shuffleChoices: false,
    };
    const onChange = form(ex);
    expect((screen.getByRole("checkbox", { name: /Embaralhar/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /Embaralhar/ }));
    expect(onChange).toHaveBeenLastCalledWith({ shuffleChoices: true });
    fireEvent.click(screen.getByRole("radio", { name: "Marcar a alternativa 3 como correta" }));
    expect(onChange).toHaveBeenLastCalledWith({ correctChoice: "c" });
    fireEvent.click(screen.getByRole("button", { name: "Remover a alternativa 1" }));
    expect(onChange).toHaveBeenLastCalledWith({ choices: [ex.choices![1], ex.choices![2]] });
    fireEvent.click(screen.getByRole("button", { name: "Remover a alternativa 2" }));
    expect(onChange).toHaveBeenLastCalledWith({ choices: [ex.choices![0], ex.choices![2]], correctChoice: null });
    fireEvent.click(screen.getByRole("button", { name: "Descer a alternativa 1" }));
    expect(onChange).toHaveBeenLastCalledWith({ choices: [ex.choices![1], ex.choices![0], ex.choices![2]] });
    fireEvent.click(screen.getByRole("button", { name: "Subir a alternativa 3" }));
    expect(onChange).toHaveBeenLastCalledWith({ choices: [ex.choices![0], ex.choices![2], ex.choices![1]] });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar alternativa" }));
    expect(onChange.mock.lastCall![0].choices).toHaveLength(4);
  });

  it("starts from nothing when the alternatives are missing", () => {
    form({ ...emptyExercise("THEORETICAL_SINGLE"), choices: undefined, shuffleChoices: undefined });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect((screen.getByRole("checkbox", { name: /Embaralhar/ }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("ExerciseForm editors and tips", () => {
  it("passes on what is written in the editors of the alternatives and of the justification, and edits the tips", async () => {
    const ex: Exercise = {
      ...emptyExercise("THEORETICAL_SINGLE"),
      choices: [
        { id: "a", html: "<p>a</p>" },
        { id: "b", html: "<p>b</p>" },
      ],
      hints: [
        { id: "h1", text: "one", command: "" },
        { id: "h2", text: "two", command: "" },
      ],
    };
    const onChange = form(ex);
    const editors = await waitFor(() => {
      const found = [...document.querySelectorAll(".ProseMirror")] as (HTMLElement & { editor: Editor })[];
      if (found.length < 4) throw new Error("editors not ready");
      return found;
    });
    // The description, the two alternatives and the justification.
    act(() => {
      editors[1]!.editor.commands.setContent("<p>chmod</p>", { emitUpdate: true });
    });
    expect(onChange).toHaveBeenCalledWith({ choices: [{ id: "a", html: "<p>chmod</p>" }, ex.choices![1]] });
    act(() => {
      editors[3]!.editor.commands.setContent("<p>why</p>", { emitUpdate: true });
    });
    expect(onChange).toHaveBeenCalledWith({ explanation: "<p>why</p>" });

    fireEvent.change(screen.getByLabelText("Comando de referência (1.1)"), { target: { value: "ls" } });
    expect(onChange).toHaveBeenLastCalledWith({ hints: [{ ...ex.hints[0], command: "ls" }, ex.hints[1]] });
    fireEvent.click(screen.getAllByRole("button", { name: /Descer/ }).find((b) => /dica/i.test(b.getAttribute("aria-label") ?? ""))!);
    expect(onChange).toHaveBeenLastCalledWith({ hints: [ex.hints[1], ex.hints[0]] });
    fireEvent.click(screen.getAllByRole("button", { name: /Remover/ }).find((b) => /dica/i.test(b.getAttribute("aria-label") ?? ""))!);
    expect(onChange).toHaveBeenLastCalledWith({ hints: [ex.hints[1]] });
  });

  it("passes on the justification of a true or false question", async () => {
    const onChange = form(emptyExercise("THEORETICAL_BOOLEAN"));
    const editors = await waitFor(() => {
      const found = [...document.querySelectorAll(".ProseMirror")] as (HTMLElement & { editor: Editor })[];
      if (found.length < 2) throw new Error("editors not ready");
      return found;
    });
    act(() => {
      editors[1]!.editor.commands.setContent("<p>recursive</p>", { emitUpdate: true });
    });
    expect(onChange).toHaveBeenCalledWith({ explanation: "<p>recursive</p>" });
  });
});

// Covers SPEC-037 CA-02, CA-03, CA-15 and D-10: the form of a matching question.
describe("ExerciseForm for a matching question", () => {
  const ex = (): Exercise => ({
    ...emptyExercise("THEORETICAL_MATCHING"),
    left: [
      { id: "l1", text: "chmod" },
      { id: "l2", text: "chown" },
    ],
    right: [
      { id: "r1", text: "owner" },
      { id: "r2", text: "mode" },
    ],
    pairs: [{ left: "l1", right: "r2" }],
    shuffleChoices: true,
  });

  it("edits the two columns, selects the pairs and the order", () => {
    const current = ex();
    const onChange = form(current);
    fireEvent.change(screen.getByLabelText("Item 1 da esquerda"), { target: { value: "ls" } });
    expect(onChange).toHaveBeenLastCalledWith({ left: [{ id: "l1", text: "ls" }, current.left![1]] });
    fireEvent.change(screen.getByLabelText("Item 2 da direita"), { target: { value: "lists" } });
    expect(onChange).toHaveBeenLastCalledWith({ right: [current.right![0], { id: "r2", text: "lists" }] });

    // The pair of an item only offers the right items no other item took.
    const second = screen.getByLabelText("Par correto do item 2 da esquerda") as HTMLSelectElement;
    expect([...second.options].map((o) => o.value)).toEqual(["", "r1"]);
    fireEvent.change(second, { target: { value: "r1" } });
    expect(onChange).toHaveBeenLastCalledWith({ pairs: [{ left: "l1", right: "r2" }, { left: "l2", right: "r1" }] });
    fireEvent.change(screen.getByLabelText("Par correto do item 1 da esquerda"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ pairs: [] });

    fireEvent.click(screen.getByRole("checkbox", { name: /Sortear a ordem/ }));
    expect(onChange).toHaveBeenLastCalledWith({ shuffleChoices: false });
  });

  it("adds and removes items in both columns within 2 and 5, and moves each column apart", () => {
    const current = ex();
    const onChange = form(current);
    expect((screen.getByRole("button", { name: "Remover o item 1 das duas colunas" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar item em cada coluna" }));
    const added = onChange.mock.lastCall![0];
    expect(added.left).toHaveLength(3);
    expect(added.right).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Descer o item 1 da direita" }));
    expect(onChange).toHaveBeenLastCalledWith({ right: [current.right![1], current.right![0]] });
    fireEvent.click(screen.getByRole("button", { name: "Subir o item 2 da esquerda" }));
    expect(onChange).toHaveBeenLastCalledWith({ left: [current.left![1], current.left![0]] });
  });

  it("removes the last item of each column with its pairs, and stops at 5", () => {
    const full: Exercise = {
      ...ex(),
      left: [1, 2, 3, 4, 5].map((n) => ({ id: `l${n}`, text: `${n}` })),
      right: [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, text: `${n}` })),
      pairs: [{ left: "l5", right: "r1" }, { left: "l1", right: "r5" }],
    };
    const onChange = form(full);
    expect((screen.getByRole("button", { name: "+ Adicionar item em cada coluna" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remover o item 5 das duas colunas" }));
    const next = onChange.mock.lastCall![0];
    expect(next.left).toHaveLength(4);
    expect(next.right).toHaveLength(4);
    expect(next.pairs, "the pairs of the removed items go away").toEqual([]);
  });
});

// Covers SPEC-039 CA-01 and D-05: the form of a descriptive question has the correct answer and the size of the answer, and nothing of
// the other kinds.
describe("ExerciseForm for a descriptive question", () => {
  it("edits the correct answer and chooses the size from the list", () => {
    const onChange = form({ ...emptyExercise("DISCURSIVE"), expectedAnswer: "<p>rwx</p>", maxLength: 2000 });
    expect(screen.getAllByText("Resposta correta (opcional) (1)").length).toBeGreaterThan(0);
    const size = screen.getByRole("combobox", { name: /Tamanho máximo da resposta/ }) as HTMLSelectElement;
    expect(size.value).toBe("2000");
    expect(Array.from(size.options).map((o) => o.value)).toEqual(["500", "1000", "2000", "5000", "10000"]);
    expect(screen.getByRole("option", { name: "2.000 caracteres (padrão)" })).toBeTruthy();
    fireEvent.change(size, { target: { value: "5000" } });
    expect(onChange).toHaveBeenCalledWith({ maxLength: 5000 });
    expect(screen.queryByRole("radio", { name: "Verdadeiro" })).toBeNull();
    expect(screen.queryByText(/Como fazer/)).toBeNull();
    expect(screen.queryByText(/Justificativa/)).toBeNull();
  });
});
