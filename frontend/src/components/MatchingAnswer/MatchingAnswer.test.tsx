import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { MatchingAnswer } from "./MatchingAnswer";

afterEach(cleanup);
const m = contentMessages.matching;
const tf = contentMessages.trueFalse;
const left = [
  { id: "l1", text: "chmod" },
  { id: "l2", text: "chown" },
];
const right = [
  { id: "r1", text: "changes the owner" },
  { id: "r2", text: "changes the mode" },
];
const item = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

describe("MatchingAnswer", () => {
  // Covers SPEC-037 CA-06, CA-07 and CA-14: linking by click (or Enter), the same number on both sides, relinking, and the check only
  // with every item linked.
  it("links an item of each column, relinks, and checks only with everything linked", () => {
    const onAnswer = vi.fn();
    render(<MatchingAnswer mode="exercise" left={left} right={right} result={null} onAnswer={onAnswer} />);
    const check = screen.getByRole("button", { name: m.check }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);

    fireEvent.click(item("^chmod"));
    expect(item("^chmod").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(item("changes the owner"));
    expect(item("^chmod").textContent).toContain("1");
    expect(item("changes the owner").textContent).toContain("1");
    expect(screen.getByRole("status").textContent).toBe(m.linked(1, 2));

    // The right item first, then the left one, also links; choosing chmod again moves its link.
    fireEvent.click(item("changes the mode"));
    fireEvent.click(item("^chown"));
    expect(check.disabled).toBe(false);
    fireEvent.click(item("^chmod"));
    fireEvent.click(item("changes the mode"));
    expect(check.disabled, "chown lost its link when chmod took its pair").toBe(true);

    fireEvent.click(item("^chown"));
    fireEvent.click(item("changes the owner"));
    fireEvent.click(check);
    expect(onAnswer).toHaveBeenCalledWith([
      { left: "l1", right: "r2" },
      { left: "l2", right: "r1" },
    ]);
  });

  // Covers SPEC-037 CA-08: the result of each link, the correct pairs and the justification, locked.
  it("shows each link right or wrong and the correct pairs, locked", () => {
    render(
      <MatchingAnswer
        mode="exercise"
        left={left}
        right={right}
        onAnswer={vi.fn()}
        result={{
          links: [
            { left: "l1", right: "r1" },
            { left: "l2", right: "r2" },
          ],
          passed: false,
          pairs: [
            { left: "l1", right: "r2" },
            { left: "l2", right: "r1" },
          ],
          results: [
            { left: "l1", right: "r1", correct: false },
            { left: "l2", right: "r2", correct: false },
          ],
          explanation: "<p>Think of the mode.</p>",
        }}
      />,
    );
    expect(screen.getByText(tf.wrong)).toBeTruthy();
    expect(screen.getByText(m.correctPairs)).toBeTruthy();
    expect(screen.getByText("chmod → changes the mode")).toBeTruthy();
    expect(screen.getByText("Think of the mode.")).toBeTruthy();
    expect(screen.getAllByText(m.wrongLink)).toHaveLength(2);
    expect((item("^chmod") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: m.check })).toBeNull();
  });

  it("says why it cannot answer and while it sends", () => {
    const { rerender } = render(<MatchingAnswer mode="exercise" left={left} right={right} result={null} onAnswer={vi.fn()} disabled message="Entre" />);
    expect(screen.getByRole("alert").textContent).toBe("Entre");
    expect((item("^chmod") as HTMLButtonElement).disabled).toBe(true);
    rerender(<MatchingAnswer mode="exercise" left={left} right={right} result={null} onAnswer={vi.fn()} busy />);
    expect(screen.getByText(tf.sending)).toBeTruthy();
  });

  // Covers SPEC-037 CA-10: in an assessment the links change at any time, with no check and no result.
  it("in an assessment, links and unlinks with no check", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MatchingAnswer mode="assessment" left={left} right={right} value={[]} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: m.check })).toBeNull();
    fireEvent.click(item("^chown"));
    fireEvent.click(item("changes the mode"));
    expect(onChange).toHaveBeenLastCalledWith([{ left: "l2", right: "r2" }]);
    rerender(<MatchingAnswer mode="assessment" left={left} right={right} value={[{ left: "l2", right: "r2" }]} onChange={onChange} />);
    expect(item("^chown").textContent).toContain("2");
    fireEvent.click(item("^chmod"));
    fireEvent.click(item("changes the mode"));
    expect(onChange).toHaveBeenLastCalledWith([{ left: "l1", right: "r2" }]);
    expect(screen.queryByText(tf.wrong)).toBeNull();
  });
});
