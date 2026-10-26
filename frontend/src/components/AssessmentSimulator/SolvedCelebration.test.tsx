import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SolvedCelebration } from "./SolvedCelebration";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

function show(over: Partial<Parameters<typeof SolvedCelebration>[0]> = {}) {
  const props = { last: false, onNext: vi.fn(), onDeliver: vi.fn(), onClose: vi.fn(), ...over };
  render(<SolvedCelebration {...props} />);
  return props;
}

// SPEC-087 CA-06, CA-07, CA-08, CA-11, CA-12 (D-03, D-04): the celebration of a solved question, over the column of the question.
describe("SolvedCelebration", () => {
  it("is a dialog named by its title, says the next question can be opened, and focuses Próxima questão", () => {
    const { onNext } = show();
    const dialog = screen.getByRole("dialog", { name: "Questão resolvida!" });
    expect(dialog.textContent).toContain("Você pode ir para a próxima questão.");
    const next = screen.getByRole("button", { name: "Próxima questão" });
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
    // no mascot: the mark is drawn by the style, not an image (D-04)
    expect(dialog.querySelector("img")).toBeNull();
  });

  it("on the last question says the exam can be delivered and offers Entregar instead", () => {
    const { onDeliver, onNext } = show({ last: true });
    expect(screen.getByRole("dialog").textContent).toContain("Era a última questão. Você pode entregar a prova.");
    expect(screen.queryByRole("button", { name: "Próxima questão" })).toBeNull();
    const deliver = screen.getByRole("button", { name: "Entregar" });
    expect(document.activeElement).toBe(deliver);
    fireEvent.click(deliver);
    expect(onDeliver).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("closes with Continuar nesta questão, with Escape and with a click outside, without moving on", () => {
    const first = show();
    fireEvent.click(screen.getByRole("button", { name: "Continuar nesta questão" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const second = show();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(second.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const third = show();
    fireEvent.click(screen.getByTestId("celebration-backdrop"));
    expect(third.onClose).toHaveBeenCalledTimes(1);
    expect(third.onNext).not.toHaveBeenCalled();
  });

  it("gives the focus back to where it was when it goes away", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    const { unmount } = render(<SolvedCelebration last={false} onNext={vi.fn()} onDeliver={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(button);
    unmount();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("keeps the Tab key inside, between its two buttons", () => {
    show();
    const dialog = screen.getByRole("dialog");
    const stay = screen.getByRole("button", { name: "Continuar nesta questão" });
    stay.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Próxima questão" }));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(stay);
  });

  it("shows the same content without motion when the system asks for less of it", () => {
    window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("prefers-reduced-motion"), addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    show();
    const dialog = screen.getByRole("dialog", { name: "Questão resolvida!" });
    expect(dialog.getAttribute("data-motion")).toBe("reduced");
    expect(dialog.textContent).toContain("Você pode ir para a próxima questão.");
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    show();
    expect(screen.getByRole("dialog").getAttribute("data-motion")).toBe("full");
  });
});
