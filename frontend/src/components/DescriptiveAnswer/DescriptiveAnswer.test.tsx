import type { Editor } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { DescriptiveAnswer } from "./DescriptiveAnswer";

afterEach(cleanup);
const m = contentMessages.descriptive;

type Host = HTMLElement & { editor: Editor };

async function editorOf(container: HTMLElement) {
  return waitFor(() => {
    const el = container.querySelector(".ProseMirror") as Host | null;
    if (!el) throw new Error("editor not ready");
    return el;
  });
}

const write = (dom: Host, html: string) =>
  act(() => {
    dom.editor.commands.setContent(html, { emitUpdate: true });
  });

describe("DescriptiveAnswer", () => {
  // Covers SPEC-039 RN-03, D-01 and D-05 (screen): the student writes text and commands within the size and sends it once.
  it("sends the answer once it has text within the size", async () => {
    const onAnswer = vi.fn();
    const { container } = render(<DescriptiveAnswer label="Permissions" maxLength={10} result={null} onAnswer={onAnswer} />);
    const dom = await editorOf(container);
    const send = screen.getByRole("button", { name: m.send }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText(m.count(0, 10))).toBeTruthy();
    expect(screen.getByText(m.once)).toBeTruthy();

    write(dom, "<p>chmod <code>750</code> e mais</p>");
    expect(screen.getByText(m.count(16, 10))).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(m.tooLong(10));
    expect(send.disabled).toBe(true);

    write(dom, "<p><code>ls</code></p>");
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith(expect.stringContaining("<p><code>ls</code></p>"));
  });

  it("says why it cannot answer and while it sends", async () => {
    const { container, rerender } = render(<DescriptiveAnswer maxLength={2000} result={null} onAnswer={vi.fn()} disabled message="Entre para responder" />);
    await editorOf(container);
    expect(screen.getByText("Entre para responder")).toBeTruthy();
    expect((screen.getByRole("button", { name: m.send }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<DescriptiveAnswer maxLength={2000} result={null} onAnswer={vi.fn()} busy />);
    expect(screen.getByText(m.sending)).toBeTruthy();
  });

  // Covers SPEC-039 CA-02 and CA-03 (screen): after sending, the answer is locked, waits for the teacher and the correct answer shows.
  it("shows the answer locked, waiting for the correction, with the correct answer", () => {
    render(
      <DescriptiveAnswer
        maxLength={2000}
        result={{ html: "<p>owner <code>rwx</code></p>", status: "PENDING", score: null, studentNote: null, expectedAnswer: "<p>Owner rwx, group r-x.</p>" }}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: m.send })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("rwx")).toBeTruthy();
    expect(screen.getByText(m.pending)).toBeTruthy();
    expect(screen.getByText(m.expected)).toBeTruthy();
    expect(screen.getByText("Owner rwx, group r-x.")).toBeTruthy();
    expect(screen.queryByText(m.note)).toBeNull();
  });

  // Covers SPEC-039 CA-08 and D-04 (screen): the grade is the percentage of what is right, with the note of the teacher.
  it("shows the grade as a percentage and the note of the teacher", () => {
    render(
      <DescriptiveAnswer
        maxLength={2000}
        result={{ html: "<p>owner rwx</p>", status: "GRADED", score: 75, studentNote: "The group is missing.", expectedAnswer: null }}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(m.score(75))).toBeTruthy();
    const bar = screen.getByRole("meter", { name: m.scoreLabel });
    expect(bar.getAttribute("aria-valuenow")).toBe("75");
    expect(screen.getByText(m.note)).toBeTruthy();
    expect(screen.getByText("The group is missing.")).toBeTruthy();
    expect(screen.queryByText(m.pending)).toBeNull();
    expect(screen.queryByText(m.expected)).toBeNull();
  });
});
