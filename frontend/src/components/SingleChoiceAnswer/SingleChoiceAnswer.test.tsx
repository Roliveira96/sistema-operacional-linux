import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { SingleChoiceAnswer } from "./SingleChoiceAnswer";

afterEach(cleanup);
const m = contentMessages.singleChoice;
const tf = contentMessages.trueFalse;
const choices = [
  { id: "a", html: "<p><code>chmod</code></p>" },
  { id: "b", html: "<p>chown</p>" },
  { id: "c", html: "<p>ls</p>" },
];

describe("SingleChoiceAnswer", () => {
  // Covers SPEC-036 CA-07 and CA-15 (screen): the alternatives with their formatting, the click is the answer, and the result locks it.
  it("in an exercise, answers on the click and then shows the result locked", () => {
    const onAnswer = vi.fn();
    const { rerender, container } = render(<SingleChoiceAnswer mode="exercise" choices={choices} result={null} onAnswer={onAnswer} />);
    expect(container.querySelector("code")?.textContent).toBe("chmod");
    expect(screen.getAllByRole("button").map((b) => b.textContent?.slice(0, 1))).toEqual(["A", "B", "C"]);
    fireEvent.click(screen.getByRole("button", { name: /chown/ }));
    expect(onAnswer).toHaveBeenCalledWith("b");

    rerender(<SingleChoiceAnswer mode="exercise" choices={choices} result={{ choice: "b", passed: false, correctChoice: "a", explanation: "<p>mode</p>" }} onAnswer={onAnswer} />);
    expect(screen.getByText(tf.wrong)).toBeTruthy();
    expect(screen.getByText(m.correctIs)).toBeTruthy();
    expect(screen.getByText("mode")).toBeTruthy();
    expect(screen.getByRole("button", { name: /chmod/ }).textContent).toContain(m.correct);
    expect(screen.getByRole("button", { name: /chown/ }).textContent).toContain(m.yourChoice);
    expect(screen.getByRole("button", { name: /chown/ }).getAttribute("aria-pressed")).toBe("true");
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);

    rerender(<SingleChoiceAnswer mode="exercise" choices={choices} result={{ choice: "a", passed: true, correctChoice: "a" }} onAnswer={onAnswer} />);
    expect(screen.getByText(tf.right)).toBeTruthy();
    expect(screen.queryByText(m.correctIs)).toBeNull();
  });

  it("in an exercise, says why it cannot answer and while it sends", () => {
    const { rerender } = render(<SingleChoiceAnswer mode="exercise" choices={choices} result={null} onAnswer={vi.fn()} disabled message="Entre" />);
    expect(screen.getByRole("alert").textContent).toBe("Entre");
    rerender(<SingleChoiceAnswer mode="exercise" choices={choices} result={null} onAnswer={vi.fn()} busy />);
    expect(screen.getByText(tf.sending)).toBeTruthy();
  });

  // Covers SPEC-036 CA-09 and CA-13: in an assessment the choice changes at any time and nothing says whether it is right.
  it("in an assessment, lets the choice change and never shows the result", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SingleChoiceAnswer mode="assessment" choices={choices} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /ls/ }));
    expect(onChange).toHaveBeenLastCalledWith("c");
    rerender(<SingleChoiceAnswer mode="assessment" choices={choices} value="c" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /ls/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(m.chosen)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /chmod/ }));
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(screen.queryByText(tf.right)).toBeNull();
    expect(screen.queryByText(tf.wrong)).toBeNull();
  });
});
