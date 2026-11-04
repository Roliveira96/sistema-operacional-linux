import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExamChatMessage } from "@/services/assessmentService";
import { ChatComposer, ChatThread } from "./ExamChat";

afterEach(cleanup);

const msg = (over: Partial<ExamChatMessage> = {}): ExamChatMessage => ({
  id: "m-1", scope: "private", studentId: "s-ana", from: "STUDENT", text: "Posso?", createdAt: "2026-10-21T09:10:00-03:00", ...over,
});

// SPEC-093 CA-10: the messages are plain text with their new lines, marked with who wrote them, the hour and the question.
describe("ChatThread", () => {
  it("draws the text as text, with the new lines, never as HTML", () => {
    render(<ChatThread viewer="teacher" studentName="Ana" messages={[msg({ text: "<b>oi</b>\nsegunda linha", position: 4 })]} />);
    const list = screen.getByRole("list", { name: "Conversa" });
    const item = within(list).getByRole("listitem");
    expect(item.textContent).toContain("<b>oi</b>");
    expect(item.querySelector("b")).toBeNull();
    expect(item.textContent).toContain("Ana");
    expect(item.textContent).toContain("09:10");
    expect(item.textContent).toContain("Questão 4");
    expect(within(item).getByText(/segunda linha/).textContent).toBe("<b>oi</b>\nsegunda linha");
  });

  it("marks who wrote it as the teacher reads it, and as the student reads it", () => {
    const list = [msg(), msg({ id: "m-2", from: "TEACHER", text: "Pode" }), msg({ id: "m-3", scope: "all", studentId: undefined, from: "TEACHER", text: "Atenção" })];
    const { unmount } = render(<ChatThread viewer="teacher" studentName="Ana" messages={list} />);
    let items = screen.getAllByRole("listitem").map((l) => l.textContent);
    expect(items[0]).toContain("Ana");
    expect(items[1]).toContain("Você");
    expect(items[2]).toContain("Para todos");
    unmount();
    render(<ChatThread viewer="student" messages={list} />);
    items = screen.getAllByRole("listitem").map((l) => l.textContent);
    expect(items[0]).toContain("Você");
    expect(items[1]).toContain("Docente · só para você");
    expect(items[2]).toContain("Docente · para todos");
  });

  it("names the one who wrote each message when the list brings the name", () => {
    render(<ChatThread viewer="record" messages={[msg({ senderName: "Ana" }), msg({ id: "m-2", from: "TEACHER", senderName: "Profa. Sediane", text: "Pode" })]} />);
    const items = screen.getAllByRole("listitem").map((l) => l.textContent);
    expect(items[0]).toContain("Ana");
    expect(items[1]).toContain("Profa. Sediane");
    expect(items[0]).toContain("21/10/2026");
  });
});

// SPEC-093 CA-07, CA-08: the field of the message, up to 500 characters with its counter; Enter sends with the first button, Shift+Enter breaks the line.
describe("ChatComposer", () => {
  it("sends with Enter and with each button, counts the characters and clears the field", () => {
    const toAna = vi.fn();
    const toAll = vi.fn();
    render(<ChatComposer actions={[{ label: "Enviar só para Ana", send: toAna }, { label: "Enviar para todos", send: toAll }]} />);
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    expect(field.maxLength).toBe(500);
    expect(screen.getByText("0/500")).toBeDefined();
    fireEvent.change(field, { target: { value: "  Leia de novo " } });
    expect(screen.getByText("15/500")).toBeDefined();
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(toAna).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(toAna).toHaveBeenCalledWith("Leia de novo");
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "Faltam 10 minutos" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar para todos" }));
    expect(toAll).toHaveBeenCalledWith("Faltam 10 minutos");
  });

  it("does not send an empty message, nor while it is turned off", () => {
    const send = vi.fn();
    const { rerender } = render(<ChatComposer actions={[{ label: "Enviar", send }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    rerender(<ChatComposer actions={[{ label: "Enviar", send }]} disabled />);
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Oi" } });
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
