import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ExerciseOrderList } from "./ExerciseOrderList";
import type { ExerciseItem } from "@/services/moduleService";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockExercises: ExerciseItem[] = [
  { id: "item-1", moduleId: "mod-1", exerciseId: "ex-11111111", sequenceOrder: 1, isMandatory: true },
  { id: "item-2", moduleId: "mod-1", exerciseId: "ex-22222222", sequenceOrder: 2, isMandatory: false },
  { id: "item-3", moduleId: "mod-1", exerciseId: "ex-33333333", sequenceOrder: 3, isMandatory: true },
];

describe("ExerciseOrderList", () => {
  it("renders exercises in order with position badges", () => {
    const handleSave = vi.fn();
    render(<ExerciseOrderList exercises={mockExercises} onSaveOrder={handleSave} />);

    expect(screen.getByText("1º")).toBeDefined();
    expect(screen.getByText("2º")).toBeDefined();
    expect(screen.getByText("3º")).toBeDefined();
    expect(screen.getByText("Exercício #ex-11111")).toBeDefined();
  });

  it("reorders exercises when move buttons are clicked", async () => {
    const handleSave = vi.fn().mockResolvedValue(undefined);
    render(<ExerciseOrderList exercises={mockExercises} onSaveOrder={handleSave} />);

    // Click "Descer" on the first exercise
    const downButtons = screen.getAllByRole("button", { name: /Descer/i });
    fireEvent.click(downButtons[0] as HTMLElement);

    // Save order
    const saveBtn = screen.getByRole("button", { name: "Salvar Ordem" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(["ex-22222222", "ex-11111111", "ex-33333333"]);
      expect(screen.getByText("Ordem dos exercícios salva com sucesso!")).toBeDefined();
    });
  });

  it("renders empty notice when no exercises exist", () => {
    render(<ExerciseOrderList exercises={[]} onSaveOrder={vi.fn()} />);
    expect(screen.getByText("Nenhum exercício associado a este módulo.")).toBeDefined();
  });
});
