import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { TrueFalseAnswer } from "./TrueFalseAnswer";

afterEach(cleanup);
const m = contentMessages.trueFalse;

describe("TrueFalseAnswer", () => {
  // Covers SPEC-035 CA-09 and CA-10 (screen): the click is the answer, and the result locks the buttons.
  it("in an exercise, answers on the click and then shows the result locked", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<TrueFalseAnswer mode="exercise" result={null} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: m.false }));
    expect(onAnswer).toHaveBeenCalledWith(false);

    rerender(<TrueFalseAnswer mode="exercise" result={{ choice: false, passed: false, correctAnswer: true, explanation: "<p>It is recursive.</p>" }} onAnswer={onAnswer} />);
    expect(screen.getByText(m.wrong)).toBeTruthy();
    expect(screen.getByText(new RegExp(m.correctIs(true)))).toBeTruthy();
    expect(screen.getByText("It is recursive.")).toBeTruthy();
    expect(screen.getByText(m.locked)).toBeTruthy();
    for (const name of [m.true, m.false]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: m.false }).getAttribute("aria-pressed")).toBe("true");

    rerender(<TrueFalseAnswer mode="exercise" result={{ choice: true, passed: true, correctAnswer: true }} onAnswer={onAnswer} />);
    expect(screen.getByText(m.right)).toBeTruthy();
    expect(screen.queryByText(m.explanation)).toBeNull();
  });

  it("in an exercise, says why it cannot answer and while it sends", () => {
    const { rerender } = render(<TrueFalseAnswer mode="exercise" result={null} onAnswer={vi.fn()} disabled message="Entre" />);
    expect(screen.getByRole("alert").textContent).toBe("Entre");
    expect((screen.getByRole("button", { name: m.true }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<TrueFalseAnswer mode="exercise" result={null} onAnswer={vi.fn()} busy />);
    expect(screen.getByText(m.sending)).toBeTruthy();
  });

  // Covers SPEC-035 CA-11 and CA-16: in an assessment the choice changes at any time and nothing says whether it is right.
  it("in an assessment, lets the choice change and never shows the result", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TrueFalseAnswer mode="assessment" value={null} onChange={onChange} />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: m.true }));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<TrueFalseAnswer mode="assessment" value={true} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: m.true }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(m.chosen)).toBeTruthy();
    const other = screen.getByRole("radio", { name: m.false }) as HTMLButtonElement;
    expect(other.disabled).toBe(false);
    other.focus();
    fireEvent.click(other);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText(m.right)).toBeNull();
    expect(screen.queryByText(m.wrong)).toBeNull();
  });
});
