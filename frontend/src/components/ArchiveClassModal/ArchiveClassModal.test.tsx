import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveClassModal } from "./ArchiveClassModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ArchiveClassModal", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ArchiveClassModal
        isOpen={false}
        className="SO"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders when isOpen is true and disables confirm button while reason is empty", () => {
    render(
      <ArchiveClassModal
        isOpen={true}
        className="SO - Turma A"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText(/Arquivar Turma: SO - Turma A/i)).toBeDefined();

    const confirmBtn = screen.getByText("Confirmar Arquivamento") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const textarea = screen.getByLabelText(/Justificativa/i);
    fireEvent.change(textarea, { target: { value: "Semestre encerrado" } });

    expect(confirmBtn.disabled).toBe(false);
  });

  it("calls onConfirm with trimmed reason", async () => {
    const handleConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ArchiveClassModal
        isOpen={true}
        className="SO - Turma A"
        onClose={vi.fn()}
        onConfirm={handleConfirm}
      />
    );

    const textarea = screen.getByLabelText(/Justificativa/i);
    fireEvent.change(textarea, { target: { value: "   Encerramento do período letivo   " } });

    const confirmBtn = screen.getByText("Confirmar Arquivamento");
    fireEvent.click(confirmBtn);

    expect(handleConfirm).toHaveBeenCalledWith("Encerramento do período letivo");
  });

  it("calls onClose when cancel button is clicked", () => {
    const handleClose = vi.fn();
    render(
      <ArchiveClassModal
        isOpen={true}
        className="SO - Turma A"
        onClose={handleClose}
        onConfirm={vi.fn()}
      />
    );

    const cancelBtn = screen.getByText("Cancelar");
    fireEvent.click(cancelBtn);

    expect(handleClose).toHaveBeenCalled();
  });
});
