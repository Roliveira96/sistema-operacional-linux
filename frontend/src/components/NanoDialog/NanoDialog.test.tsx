import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { NanoDialog } from "./NanoDialog";

afterEach(cleanup);
const m = contentMessages.nano;
const request = { editor: "nano" as const, path: "/root/a.txt", content: "abc", isNew: true, readOnly: false, warning: "aviso" };

// Covers SPEC-014 CA-09 (dialog side).
describe("NanoDialog", () => {
  it("saves with the button and with Ctrl+O", () => {
    const onClose = vi.fn();
    render(<NanoDialog request={request} onClose={onClose} />);
    expect(screen.getByText(m.newFile)).toBeTruthy();
    expect(screen.getByText("aviso")).toBeTruthy();
    const area = screen.getByLabelText(m.contentLabel);
    fireEvent.change(area, { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: m.save }));
    expect(onClose).toHaveBeenLastCalledWith("xyz");
    fireEvent.keyDown(area, { key: "o", ctrlKey: true });
    expect(onClose).toHaveBeenLastCalledWith("xyz");
  });

  it("cancels with the button and with Escape", () => {
    const onClose = vi.fn();
    render(<NanoDialog request={request} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: m.cancel }));
    expect(onClose).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not save read-only files", () => {
    const onClose = vi.fn();
    render(<NanoDialog request={{ ...request, readOnly: true, isNew: false }} onClose={onClose} />);
    expect(screen.getByText(m.readOnly)).toBeTruthy();
    expect((screen.getByRole("button", { name: m.save }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "o", ctrlKey: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});
