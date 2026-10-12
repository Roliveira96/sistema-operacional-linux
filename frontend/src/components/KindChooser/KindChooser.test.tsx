import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
