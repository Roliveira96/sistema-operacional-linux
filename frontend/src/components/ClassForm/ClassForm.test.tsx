import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassForm } from "./ClassForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClassForm", () => {
  it("renders form fields and submits payload", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(<ClassForm onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), {
      target: { value: "Turma A" },
    });
    fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), {
      target: { value: "SO34E" },
    });
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), {
      target: { value: "2026/2" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Início/i), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), {
      target: { value: "2026-12-01" },
    });

    fireEvent.click(screen.getByText("Criar Turma"));

    expect(handleSubmit).toHaveBeenCalled();
  });

  it("dynamically shows invite link dates when checkbox is enabled", () => {
    render(<ClassForm onSubmit={vi.fn()} />);

    expect(screen.queryByLabelText(/Início da Validade do Link/i)).toBeNull();

    const inviteCheckbox = screen.getByLabelText(/Habilitar Link de Ingresso/i);
    fireEvent.click(inviteCheckbox);

    expect(screen.getByLabelText(/Início da Validade do Link/i)).toBeDefined();
    expect(screen.getByLabelText(/Fim da Validade do Link/i)).toBeDefined();
  });

  it("validates that start date cannot be after end date", async () => {
    const handleSubmit = vi.fn();
    render(<ClassForm onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), {
      target: { value: "Turma Inválida" },
    });
    fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), {
      target: { value: "SO34E" },
    });
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), {
      target: { value: "2026/2" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Início/i), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), {
      target: { value: "2026-10-01" },
    });

    fireEvent.click(screen.getByText("Criar Turma"));

    expect(handleSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/A data de início deve ser anterior ou igual à data de término/i)
    ).toBeDefined();
  });
});
