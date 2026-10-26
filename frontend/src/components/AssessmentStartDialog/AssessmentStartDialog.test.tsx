import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { AssessmentStartDialog } from "./AssessmentStartDialog";

afterEach(cleanup);

function setup(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<AssessmentStartDialog assessment={{ title: "Prova 1: permissões" }} onClose={onClose} onConfirm={onConfirm} />);
  return { onClose, onConfirm };
}

// SPEC-083 CA-09, section 3.1: the teacher confirms before starting the exam, because the start cannot be undone.
describe("AssessmentStartDialog", () => {
  it("asks whether to start now and says what the start means", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Iniciar a prova agora?" });
    expect(within(dialog).getByText("Os alunos só entram depois de habilitados por você. O início não pode ser desfeito.")).toBeDefined();
    expect(within(dialog).getByText("Prova 1: permissões")).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Iniciar a prova" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Voltar" })).toBeDefined();
  });

  it("starts when confirmed and does not close by itself: whoever opened it does", async () => {
    const { onConfirm, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar a prova" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without starting on Back and on Escape", () => {
    const { onConfirm, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and says why when the server refuses, and lets the teacher try again", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(problem("assessment-not-open-yet", 409)).mockResolvedValue(undefined);
    setup(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar a prova" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Ainda não chegou o horário de início da prova.");
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar a prova" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not start twice while it is starting", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setup(onConfirm);
    const start = screen.getByRole("button", { name: "Iniciar a prova" }) as HTMLButtonElement;
    fireEvent.click(start);
    fireEvent.click(start);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(start.disabled).toBe(true);
    finish();
    await waitFor(() => expect(start.disabled).toBe(false));
  });
});
