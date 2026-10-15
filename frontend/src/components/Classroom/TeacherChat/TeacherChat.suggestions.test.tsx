import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTarget } from "@/services/classroomService";
import { TeacherChat } from "./TeacherChat";

afterEach(cleanup);

const ANA: ChatTarget = { studentId: "u-1" };
const BRUNO: ChatTarget = { studentId: "u-2" };
const TIPS = ["Dica: Use o ls\nComando: ls -l", "Dica: Olhe a pasta home", "Dica: <b>forte</b>"];

interface Over {
  target?: ChatTarget | null;
  studentName?: string;
  suggestions?: string[];
  onSend?: (text: string, to: ChatTarget) => boolean;
}

const props = (over: Over = {}) => ({
  target: ANA as ChatTarget | null,
  studentName: "Ana Souza",
  chat: [],
  connected: true,
  onSend: vi.fn(() => true),
  suggestions: TIPS,
  ...over,
});

const field = () => screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;
const group = () => within(screen.getByRole("group", { name: "Dicas do exercício" }));

// SPEC-065 3.3: while the round runs, the tips of the exercise are suggestions in the private conversation, which fill the field
describe("TeacherChat, the suggestions of the exercise", () => {
  it("has no block of suggestions when it has none, which is how it was before", () => {
    render(<TeacherChat {...props({ suggestions: undefined })} />);
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Usar dica/ })).toBeNull();
  });

  it("has no block of suggestions for an empty list either", () => {
    render(<TeacherChat {...props({ suggestions: [] })} />);
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
  });

  it("has a button 'Usar dica N' for each tip, with the text of the tip beside it", () => {
    render(<TeacherChat {...props()} />);
    const items = group().getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByRole("button", { name: "Usar dica 1" })).toBeDefined();
    expect(within(items[1]!).getByRole("button", { name: "Usar dica 2" })).toBeDefined();
    expect(within(items[2]!).getByRole("button", { name: "Usar dica 3" })).toBeDefined();
    expect(items[0]!.textContent).toContain("Dica: Use o ls");
    expect(items[0]!.textContent).toContain("Comando: ls -l");
  });

  it("fills the field with the tip, the line break of the command included, and puts the cursor in it", () => {
    render(<TeacherChat {...props()} />);
    expect(field().value).toBe("");
    fireEvent.click(group().getByRole("button", { name: "Usar dica 1" }));
    expect(field().value).toBe("Dica: Use o ls\nComando: ls -l");
    expect(document.activeElement).toBe(field());
  });

  it("replaces what was written with the tip chosen, and the teacher can still edit it before sending", () => {
    render(<TeacherChat {...props()} />);
    fireEvent.change(field(), { target: { value: "Rascunho" } });
    fireEvent.click(group().getByRole("button", { name: "Usar dica 2" }));
    expect(field().value).toBe("Dica: Olhe a pasta home");
    fireEvent.change(field(), { target: { value: "Dica: Olhe a pasta home, Ana" } });
    expect(field().value).toBe("Dica: Olhe a pasta home, Ana");
  });

  it("sends the tip to the student of the conversation, in private, with the button of always", () => {
    const onSend = vi.fn(() => true);
    render(<TeacherChat {...props({ onSend })} />);
    fireEvent.click(group().getByRole("button", { name: "Usar dica 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar só para Ana Souza" }));
    expect(onSend).toHaveBeenCalledWith("Dica: Olhe a pasta home", ANA);
    expect(field().value).toBe("");
  });

  it("keeps the tips after one is used, for the next student", () => {
    render(<TeacherChat {...props()} />);
    fireEvent.click(group().getByRole("button", { name: "Usar dica 1" }));
    expect(group().getAllByRole("listitem")).toHaveLength(3);
  });

  it("puts the tip only in the conversation that is open, and keeps what each conversation had", () => {
    const view = render(<TeacherChat {...props()} />);
    fireEvent.click(group().getByRole("button", { name: "Usar dica 3" }));
    view.rerender(<TeacherChat {...props({ target: BRUNO, studentName: "Bruno Lima" })} />);
    expect(field().value).toBe("");
    view.rerender(<TeacherChat {...props()} />);
    expect(field().value).toBe("Dica: <b>forte</b>");
  });

  it("shows the suggestions in the channel for everybody too, and the tip goes there", () => {
    const onSend = vi.fn(() => true);
    render(<TeacherChat {...props({ target: "all", studentName: "", onSend })} />);
    fireEvent.click(group().getByRole("button", { name: "Usar dica 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para todos" }));
    expect(onSend).toHaveBeenCalledWith("Dica: Use o ls\nComando: ls -l", "all");
  });

  it("shows none when no conversation is open", () => {
    render(<TeacherChat {...props({ target: null, studentName: "" })} />);
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
  });

  it("draws the tips as text, never as HTML", () => {
    render(<TeacherChat {...props()} />);
    expect(group().getByText("Dica: <b>forte</b>")).toBeDefined();
    expect(screen.getByRole("group", { name: "Dicas do exercício" }).querySelector("b")).toBeNull();
  });

  it("brings a tip longer than a message to the length of one, as the field does for what is typed", () => {
    render(<TeacherChat {...props({ suggestions: ["x".repeat(900)] })} />);
    fireEvent.click(group().getByRole("button", { name: "Usar dica 1" }));
    expect(Array.from(field().value)).toHaveLength(500);
  });

  it("follows the tips the panel gives: a new round brings new ones", () => {
    const view = render(<TeacherChat {...props()} />);
    view.rerender(<TeacherChat {...props({ suggestions: ["Dica: nova"] })} />);
    expect(group().getAllByRole("listitem")).toHaveLength(1);
    view.rerender(<TeacherChat {...props({ suggestions: undefined })} />);
    expect(screen.queryByRole("group", { name: "Dicas do exercício" })).toBeNull();
  });
});
