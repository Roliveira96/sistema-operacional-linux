import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_KINDS } from "@/lib/questionKinds";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { KindChooser } from "./KindChooser";

afterEach(cleanup);
const m = authoringMessages.questionKinds;

// Covers SPEC-035 CA-01 and CA-18: the kind is asked before a new question opens.
describe("KindChooser", () => {
  it("offers every kind, practical first, and gives back the one chosen", () => {
    const onChoose = vi.fn();
    render(<KindChooser onChoose={onChoose} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: m.chooseTitle })).toBeTruthy();
    expect((screen.getByRole("radio", { name: new RegExp(m.label.PRACTICAL) }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(m.help.THEORETICAL_BOOLEAN)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(m.label.THEORETICAL_BOOLEAN) }));
    fireEvent.click(screen.getByRole("button", { name: m.choose }));
    expect(onChoose).toHaveBeenCalledWith("THEORETICAL_BOOLEAN");
  });

  it("closes with Escape, the cancel button or a click outside", () => {
    const onClose = vi.fn();
    render(<KindChooser onChoose={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: m.cancel }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

it("can be a link to the page of the new question", () => {
  render(<KindChooser hrefFor={(kind) => `/new?kind=${kind}`} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(m.label.THEORETICAL_BOOLEAN) }));
  expect(screen.getByRole("link", { name: m.choose }).getAttribute("href")).toBe("/new?kind=THEORETICAL_BOOLEAN");
});

// Covers SPEC-039 RN-01 and D-09: the bank offers the descriptive kind; the exercises of a card do not.
it("offers the descriptive kind in the bank and only the kinds it is given in a card", () => {
  render(<KindChooser onChoose={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole("radio", { name: new RegExp(m.label.DISCURSIVE) })).toBeTruthy();
  cleanup();
  render(<KindChooser kinds={CARD_KINDS} onChoose={vi.fn()} onClose={vi.fn()} />);
  expect(screen.queryByRole("radio", { name: new RegExp(m.label.DISCURSIVE) })).toBeNull();
  expect(screen.getAllByRole("radio")).toHaveLength(CARD_KINDS.length);
});

// Covers SPEC-040 CA-01, CA-02 and D-02: the example follows the kind selected, and the one under the mouse.
it("shows the example of the kind selected or under the mouse", () => {
  render(<KindChooser onChoose={vi.fn()} onClose={vi.fn()} />);
  const example = (kind: keyof typeof m.label) => screen.queryByRole("figure", { name: m.example.label(m.label[kind]) });
  expect(example("PRACTICAL")).not.toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(m.label.THEORETICAL_SINGLE) }));
  expect(example("THEORETICAL_SINGLE")).not.toBeNull();
  const matching = screen.getByRole("radio", { name: new RegExp(m.label.THEORETICAL_MATCHING) }).closest("label")!;
  fireEvent.mouseEnter(matching);
  expect(example("THEORETICAL_MATCHING")).not.toBeNull();
  fireEvent.mouseLeave(matching);
  expect(example("THEORETICAL_SINGLE")).not.toBeNull();
});
