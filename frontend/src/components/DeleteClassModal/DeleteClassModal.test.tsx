import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteClassModal } from "./DeleteClassModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// SPEC-050, section 3.1
describe("DeleteClassModal", () => {
  it("does not render when it is closed", () => {
    const { container } = render(<DeleteClassModal isOpen={false} className="SO" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("names the class, warns that the history is kept and offers to cancel or delete", () => {
    render(<DeleteClassModal isOpen className="SO - Turma A" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: /Excluir turma: SO - Turma A/ })).toBeDefined();
    expect(screen.getByText(/O histórico acadêmico é preservado/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Excluir turma" }).getAttribute("data-variant")).toBe("danger");
  });

  // CA-07
  it("confirms and cancels", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<DeleteClassModal isOpen className="SO" onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Excluir turma" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(<DeleteClassModal isOpen className="SO" onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // CA-07
  it("shows the error of the server in the dialog and blocks the buttons while it is deleting", () => {
    const { rerender } = render(<DeleteClassModal isOpen className="SO" error="Esta turma ainda não pode ser excluída." onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toBe("Esta turma ainda não pode ser excluída.");
    rerender(<DeleteClassModal isOpen className="SO" isSubmitting onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Excluindo…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
