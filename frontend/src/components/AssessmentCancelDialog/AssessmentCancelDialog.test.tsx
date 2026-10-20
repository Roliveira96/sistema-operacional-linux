import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { summary } from "@/test/assessmentFixtures";
import { AssessmentCancelDialog } from "./AssessmentCancelDialog";

afterEach(cleanup);

function setup(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<AssessmentCancelDialog assessment={summary({ title: "Prova 1: permissões" })} onClose={onClose} onConfirm={onConfirm} />);
  return { onClose, onConfirm };
}

const confirm = () => screen.getByRole("button", { name: "Cancelar avaliação" }) as HTMLButtonElement;
const reason = () => screen.getByLabelText(/Motivo/) as HTMLTextAreaElement;
const sure = () => screen.getByRole("checkbox", { name: "Entendo que o cancelamento não pode ser desfeito" }) as HTMLInputElement;

// SPEC-075 CA-26, RN-12.
describe("AssessmentCancelDialog", () => {
  it("is a dialog named for the assessment, with the focus on the reason", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Cancelar avaliação: Prova 1: permissões" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(reason());
  });

  it("asks for the reason and for the confirmation before it lets the assessment be canceled", () => {
    setup();
    expect(confirm().disabled).toBe(true);
    fireEvent.change(reason(), { target: { value: "   " } });
    fireEvent.click(sure());
    expect(confirm().disabled).toBe(true);
    fireEvent.change(reason(), { target: { value: "Falta de energia" } });
    expect(confirm().disabled).toBe(false);
    fireEvent.click(sure());
    expect(confirm().disabled).toBe(true);
  });

  it("limits the reason to 500 characters and counts them", () => {
    setup();
    expect(reason().maxLength).toBe(500);
    fireEvent.change(reason(), { target: { value: "Falta de energia" } });
    expect(screen.getByText("16/500")).toBeDefined();
  });

  it("cancels with the reason, trimmed", async () => {
    const { onConfirm } = setup();
    fireEvent.change(reason(), { target: { value: "  Falta de energia  " } });
    fireEvent.click(sure());
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Falta de energia"));
  });

  it("shows why the server refused, and stays open", async () => {
    const { onClose } = setup(vi.fn().mockRejectedValue(problem("grades-homologated", 409)));
    fireEvent.change(reason(), { target: { value: "Falta de energia" } });
    fireEvent.click(sure());
    fireEvent.click(confirm());
    expect((await screen.findByRole("alert")).textContent).toBe("Há nota homologada nesta avaliação; ela não pode ser cancelada.");
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm().disabled).toBe(false);
  });

  it("closes with Escape and with the way back, without canceling", () => {
    const { onClose, onConfirm } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
