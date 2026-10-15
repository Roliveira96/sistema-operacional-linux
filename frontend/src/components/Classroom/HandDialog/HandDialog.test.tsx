import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HandDialog } from "./HandDialog";

afterEach(cleanup);

const props = (over: Partial<Parameters<typeof HandDialog>[0]> = {}) => ({ saved: "", onSend: vi.fn(), onLower: vi.fn(), onClose: vi.fn(), ...over });
const dialog = () => screen.getByRole("dialog", { name: "Sua dúvida para o professor" });
const field = () => within(dialog()).getByRole("textbox", { name: "Escreva sua dúvida (opcional)" }) as HTMLInputElement;

// SPEC-062 CA-04: the modal where the student writes the doubt of the raised hand
describe("HandDialog", () => {
  it("is a modal dialog with a name, the field with the doubt the room has, the counter and the three buttons", () => {
    render(<HandDialog {...props({ saved: "Como uso o chmod?" })} />);
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(field().value).toBe("Como uso o chmod?");
    expect(within(dialog()).getByText("17/300")).toBeDefined();
    expect(within(dialog()).getByRole("button", { name: "Enviar dúvida" })).toBeDefined();
    expect(within(dialog()).getByRole("button", { name: "Abaixar a mão" })).toBeDefined();
    expect(within(dialog()).getByRole("button", { name: "Fechar" })).toBeDefined();
    expect(within(dialog()).getByText("Dúvida enviada")).toBeDefined();
  });

  it("sends the doubt with the button and with Enter, up to 300 characters", () => {
    const p = props();
    render(<HandDialog {...p} />);
    fireEvent.change(field(), { target: { value: "Como uso o chmod?" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Enviar dúvida" }));
    expect(p.onSend).toHaveBeenLastCalledWith("Como uso o chmod?");
    fireEvent.change(field(), { target: { value: "E o chown?" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(p.onSend).toHaveBeenLastCalledWith("E o chown?");
    fireEvent.change(field(), { target: { value: "x".repeat(400) } });
    expect(field().value.length).toBe(300);
  });

  it("lowers the hand with its button, and only closes with the other one, which leaves the hand up", () => {
    const p = props();
    render(<HandDialog {...p} />);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Fechar" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onLower).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Abaixar a mão" }));
    expect(p.onLower).toHaveBeenCalledTimes(1);
  });

  it("closes with Esc and does not send what was written and not sent", () => {
    const p = props();
    render(<HandDialog {...p} />);
    fireEvent.change(field(), { target: { value: "ainda escrevendo" } });
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("puts the focus in the field when it opens", () => {
    render(<HandDialog {...props()} />);
    expect(document.activeElement).toBe(field());
  });

  it("keeps Tab and Shift+Tab inside, from the last button to the field and back", () => {
    render(<HandDialog {...props()} />);
    const close = within(dialog()).getByRole("button", { name: "Fechar" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it("gives the focus back to what opened it when it goes away", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(<HandDialog {...props()} />);
    expect(document.activeElement).toBe(field());
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("uses only the tokens of the theme, with no color written in the style", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "HandDialog.module.scss"), "utf8");
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});
