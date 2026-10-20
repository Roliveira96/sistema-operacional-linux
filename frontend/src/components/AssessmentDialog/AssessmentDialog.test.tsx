import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentDialog } from "./AssessmentDialog";

afterEach(cleanup);

function setup() {
  const onClose = vi.fn();
  render(
    <AssessmentDialog title="Reagendar avaliação: Prova 1" onClose={onClose}>
      <input aria-label="primeiro" />
      <button type="button">segundo</button>
      <button type="button" disabled>
        desligado
      </button>
      <button type="button">último</button>
    </AssessmentDialog>,
  );
  return { onClose, dialog: screen.getByRole("dialog", { name: "Reagendar avaliação: Prova 1" }) };
}

// SPEC-075 CA-29: the dialogs are named, close with Escape and keep the Tab key inside.
describe("AssessmentDialog", () => {
  it("is a modal dialog named by its title", () => {
    const { dialog } = setup();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("closes with Escape", () => {
    const { dialog, onClose } = setup();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends the Tab key from the last control to the first, skipping what is disabled", () => {
    const { dialog } = setup();
    screen.getByRole("button", { name: "último" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("primeiro"));
  });

  it("sends Shift+Tab from the first control to the last", () => {
    const { dialog } = setup();
    screen.getByLabelText("primeiro").focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "último" }));
  });

  it("leaves the Tab key alone in the middle of the dialog", () => {
    const { dialog } = setup();
    screen.getByRole("button", { name: "segundo" }).focus();
    const notPrevented = fireEvent.keyDown(dialog, { key: "Tab" });
    expect(notPrevented).toBe(true);
  });
});
