import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { ClearanceRejectDialog } from "./ClearanceRejectDialog";

afterEach(cleanup);

function setup(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<ClearanceRejectDialog student="Carla Dias" onClose={onClose} onConfirm={onConfirm} />);
  return { onClose, onConfirm };
}

const reason = () => screen.getByLabelText("Motivo (opcional)") as HTMLTextAreaElement;
const confirm = () => screen.getByRole("button", { name: "Recusar" }) as HTMLButtonElement;

// SPEC-076 section 3.1, D-10: refusing opens a dialog with an optional reason of up to 300 characters.
describe("ClearanceRejectDialog", () => {
  it("is a dialog named for the student, with the focus on the reason", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Recusar a habilitação de Carla Dias" }).getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(reason());
  });

  it("tells what the student will read when the reason is left blank", () => {
    setup();
    expect(screen.getByText('Sem motivo, o aluno lê: "Sua matrícula não foi habilitada para esta avaliação presencial."')).toBeDefined();
  });

  it("limits the reason to 300 characters and counts them", () => {
    setup();
    expect(reason().maxLength).toBe(300);
    fireEvent.change(reason(), { target: { value: "Reprovada por faltas" } });
    expect(screen.getByText("20/300")).toBeDefined();
  });

  it("refuses with the reason, trimmed", async () => {
    const { onConfirm } = setup();
    fireEvent.change(reason(), { target: { value: "  Reprovada por faltas  " } });
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Reprovada por faltas"));
  });

  it("refuses without a reason, because it is optional", async () => {
    const { onConfirm } = setup();
    expect(confirm().disabled).toBe(false);
    fireEvent.change(reason(), { target: { value: "   " } });
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(""));
  });

  it("shows why the server refused, and stays open", async () => {
    const { onClose } = setup(vi.fn().mockRejectedValue(problem("clearance-locked", 409)));
    fireEvent.click(confirm());
    expect((await screen.findByRole("alert")).textContent).toBe("O aluno já começou a prova: a habilitação dele não pode mais mudar.");
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm().disabled).toBe(false);
  });

  it("closes with Escape and with the way back, without refusing", () => {
    const { onClose, onConfirm } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
