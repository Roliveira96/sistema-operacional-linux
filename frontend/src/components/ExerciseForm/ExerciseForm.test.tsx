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
