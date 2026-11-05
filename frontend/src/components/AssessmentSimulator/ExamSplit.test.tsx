import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExamSplit } from "./ExamSplit";

const KEY = "exam-terminal-width";

beforeEach(() => {
  localStorage.clear();
  // the area of the exam is 1200 px wide: the terminal goes from 352 px to 75% (900 px), and the question keeps 288 px
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1200, left: 0, right: 1200, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(hasTerminal = true) {
  render(
    <ExamSplit
      hasTerminal={hasTerminal}
      question={<p>Enunciado da questão</p>}
      terminal={(toggle) => (
        <section aria-label="Terminal">
          {toggle}
          <p>root@servidor</p>
        </section>
      )}
    />,
  );
}

// SPEC-090 revision 4, CA-21: the student moves the divider between the question and the terminal, by the mouse or the arrows, within the limits,
// and the width is kept for the next time.
describe("ExamSplit, the divider", () => {
  it("widens and narrows the terminal with the arrows, within the limits, and keeps the width", () => {
    localStorage.setItem(KEY, "600");
    setup();
    const divider = screen.getByRole("separator", { name: "Largura do terminal" });
    expect(divider.getAttribute("aria-valuenow")).toBe("600");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider.getAttribute("aria-valuenow")).toBe("632");
    expect(localStorage.getItem(KEY)).toBe("632");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider.getAttribute("aria-valuenow")).toBe("568");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider.getAttribute("aria-valuenow")).toBe("900");
    for (let i = 0; i < 40; i++) fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider.getAttribute("aria-valuenow")).toBe("352");
  });

  it("follows the pointer while it is dragged", () => {
    setup();
    const divider = screen.getByRole("separator", { name: "Largura do terminal" });
    fireEvent.pointerDown(divider, { clientX: 700 });
    fireEvent.pointerMove(window, { clientX: 500 });
    fireEvent.pointerUp(window);
    expect(divider.getAttribute("aria-valuenow")).toBe("700");
    expect(localStorage.getItem(KEY)).toBe("700");
  });

  it("has no divider without a question of command Linux", () => {
    setup(false);
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByRole("button", { name: "Expandir terminal" })).toBeNull();
  });
});

// SPEC-090 revision 4, CA-22 (D-09): the terminal takes the whole area, and Recolher or Esc bring the question back.
describe("ExamSplit, expanding the terminal", () => {
  it("expands the terminal and brings the question back with Recolher and with Esc", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Expandir terminal" }));
    expect(screen.getByText("Enunciado da questão").closest("[hidden]")).not.toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.getByText("Enunciado da questão").closest("[hidden]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expandir terminal" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByText("Enunciado da questão").closest("[hidden]")).toBeNull();
  });
});
