import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ModuleForm } from "./ModuleForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockClasses = [
  { id: "c-1", name: "Sistemas Operacionais 1" },
  { id: "c-2", name: "Sistemas Operacionais 2" },
];

describe("ModuleForm", () => {
  it("renders form fields and submits successfully for public module", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByLabelText(/Título do Módulo/i), {
      target: { value: "Novo Módulo de Threads" },
    });
    fireEvent.change(screen.getByLabelText(/Descrição e Ementa/i), {
      target: { value: "Conceitos de concorrência e sincronização" },
    });

    const submitBtn = screen.getByRole("button", { name: "Criar Módulo" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        title: "Novo Módulo de Threads",
        description: "Conceitos de concorrência e sincronização",
        visibility: "PUBLIC",
        activationStart: undefined,
        activationEnd: undefined,
        classIds: [],
      });
    });
  });

  it("shows class selection when visibility is PRIVATE and enforces class selection", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm availableClasses={mockClasses} onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByLabelText(/Modalidade de Visibilidade/i), {
      target: { value: "PRIVATE" },
    });

    expect(screen.getByText("Sistemas Operacionais 1")).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Título do Módulo/i), {
      target: { value: "Módulo Privado" },
    });
    fireEvent.change(screen.getByLabelText(/Descrição e Ementa/i), {
      target: { value: "Conteúdo restrito" },
    });

    // Submit without selecting class
    fireEvent.click(screen.getByRole("button", { name: "Criar Módulo" }));

    await waitFor(() => {
      expect(
        screen.getByText("Selecione ao menos uma turma para um módulo privado.")
      ).toBeDefined();
    });
    expect(handleSubmit).not.toHaveBeenCalled();

    // Select class c-1
    fireEvent.click(screen.getByLabelText("Sistemas Operacionais 1"));
    fireEvent.click(screen.getByRole("button", { name: "Criar Módulo" }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: "PRIVATE",
          classIds: ["c-1"],
        })
      );
    });
  });

  it("validates inverted dates", async () => {
    const handleSubmit = vi.fn();
    render(<ModuleForm onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByLabelText(/Título do Módulo/i), {
      target: { value: "Módulo Datas" },
    });
    fireEvent.change(screen.getByLabelText(/Descrição e Ementa/i), {
      target: { value: "Descrição" },
    });
    fireEvent.change(screen.getByLabelText(/Início da Vigência/i), {
      target: { value: "2026-10-10T10:00" },
    });
    fireEvent.change(screen.getByLabelText(/Término da Vigência/i), {
      target: { value: "2026-10-09T10:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Criar Módulo" }));

    await waitFor(() => {
      expect(
        screen.getByText("A data de início da vigência não pode ser posterior ao término.")
      ).toBeDefined();
    });
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
