import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTarget, LiveChatMessage } from "@/services/classroomService";
import { TeacherChat } from "./TeacherChat";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

afterEach(cleanup);

let n = 0;
const message = (over: Partial<LiveChatMessage> & Pick<LiveChatMessage, "from" | "scope" | "text">): LiveChatMessage => ({
  id: `m-${++n}`,
  createdAt: "2026-10-14T10:00:00Z",
  ...over,
});

const ANA: ChatTarget = { studentId: "u-1" };
const BRUNO: ChatTarget = { studentId: "u-2" };

/** The whole chat of the room, as the panel keeps it: the private conversations of two students and what the teacher said to everybody. */
const history: LiveChatMessage[] = [
  message({ scope: "private", studentId: "u-1", from: "STUDENT", text: "Professor, não entendi o chmod" }),
  message({ scope: "private", studentId: "u-2", from: "STUDENT", text: "Segredo do Bruno" }),
  message({ scope: "all", from: "TEACHER", text: "Atenção turma: prova na sexta" }),
  message({ scope: "private", studentId: "u-1", from: "TEACHER", text: "Use chmod 644 arquivo" }),
  message({ scope: "private", studentId: "u-2", from: "TEACHER", text: "Resposta só para o Bruno" }),
];

interface Over {
  target?: ChatTarget | null;
  studentName?: string;
  chat?: LiveChatMessage[];
  doubt?: string;
  connected?: boolean;
  onSend?: (text: string, to: ChatTarget) => boolean;
}

const props = (over: Over = {}) => ({
  target: ANA as ChatTarget | null,
  studentName: "Ana Souza",
  chat: history,
  doubt: undefined as string | undefined,
  connected: true,
  onSend: vi.fn(() => true),
  ...over,
});

const field = () => screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const sendPrivate = (name = "Ana Souza") => screen.getByRole("button", { name: `Enviar só para ${name}` }) as HTMLButtonElement;
const sendAll = () => screen.getByRole("button", { name: "Enviar para todos" }) as HTMLButtonElement;
const log = () => screen.getByRole("log");
/** What the timeline shows, message by message: who wrote it, the tag if any, and the text. */
const timeline = () => within(log()).queryAllByRole("listitem").map((item) => item.textContent);

// SPEC-063 CA-07 and CA-10: the conversation of the teacher, in the side of the panel
describe("TeacherChat", () => {
  describe("with no conversation open", () => {
    it("has the title and says what to do, with no field to write in", () => {
      render(<TeacherChat {...props({ target: null, studentName: "" })} />);
      expect(screen.getByRole("heading", { level: 2, name: "Conversa" })).toBeDefined();
      expect(screen.getByText('Escolha um aluno ou "Mensagem para todos".')).toBeDefined();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("log")).toBeNull();
    });
  });

  describe("the conversation with a student", () => {
    it("is titled with the name of the student", () => {
      render(<TeacherChat {...props()} />);
      expect(screen.getByRole("heading", { level: 2, name: "Conversa" })).toBeDefined();
      expect(screen.getByRole("heading", { level: 3, name: "Conversa com Ana Souza" })).toBeDefined();
    });

    it("shows his private messages together with the ones for everybody, in order, and nothing of another student", () => {
      render(<TeacherChat {...props()} />);
      expect(timeline()).toEqual([
        "Ana SouzaProfessor, não entendi o chmod",
        "VocêPara todosAtenção turma: prova na sexta",
        "VocêUse chmod 644 arquivo",
      ]);
      expect(screen.queryByText("Segredo do Bruno")).toBeNull();
      expect(screen.queryByText("Resposta só para o Bruno")).toBeNull();
    });

    it("marks each message: the name of the student for what he wrote, 'Você' for the teacher, and the tag only on what went to everybody", () => {
      render(<TeacherChat {...props()} />);
      const [fromStudent, toAll, toStudent] = within(log()).getAllByRole("listitem").map((item) => within(item));
      expect(fromStudent.getByText("Ana Souza")).toBeDefined();
      expect(fromStudent.queryByText("Você")).toBeNull();
      expect(fromStudent.queryByText("Para todos")).toBeNull();
      expect(toAll.getByText("Você")).toBeDefined();
      expect(toAll.getByText("Para todos")).toBeDefined();
      expect(toStudent.getByText("Você")).toBeDefined();
      expect(toStudent.queryByText("Para todos")).toBeNull();
    });

    it("is another conversation for another student: the messages of Bruno, and the ones for everybody", () => {
      render(<TeacherChat {...props({ target: BRUNO, studentName: "Bruno Lima" })} />);
      expect(screen.getByRole("heading", { level: 3, name: "Conversa com Bruno Lima" })).toBeDefined();
      expect(timeline()).toEqual(["Bruno LimaSegredo do Bruno", "VocêPara todosAtenção turma: prova na sexta", "VocêResposta só para o Bruno"]);
    });

    it("says there is no message yet when the student and the teacher have not written, and nothing was said to everybody", () => {
      render(<TeacherChat {...props({ chat: [history[1]!] })} />);
      expect(screen.getByText("Nenhuma mensagem ainda.")).toBeDefined();
      expect(screen.queryByRole("log")?.querySelectorAll("li").length ?? 0).toBe(0);
    });

    it("keeps the history of a student who left the list of the online students: it only needs the name that was given", () => {
      render(<TeacherChat {...props({ studentName: "Ana Souza (saiu)" })} />);
      expect(screen.getByRole("heading", { level: 3, name: "Conversa com Ana Souza (saiu)" })).toBeDefined();
      expect(timeline()[0]).toBe("Ana Souza (saiu)Professor, não entendi o chmod");
    });

    it("shows a message that arrives while it is open", () => {
      const view = render(<TeacherChat {...props()} />);
      const incoming = message({ scope: "private", studentId: "u-1", from: "STUDENT", text: "Obrigada!" });
      view.rerender(<TeacherChat {...props({ chat: [...history, incoming] })} />);
      expect(timeline()).toHaveLength(4);
      expect(timeline()[3]).toBe("Ana SouzaObrigada!");
    });
  });

  describe("the channel for everybody", () => {
    it("is titled for the whole class and shows only what was said to everybody", () => {
      render(<TeacherChat {...props({ target: "all", studentName: "" })} />);
      expect(screen.getByRole("heading", { level: 3, name: "Para todos os alunos" })).toBeDefined();
      expect(timeline()).toEqual(["VocêPara todosAtenção turma: prova na sexta"]);
      expect(screen.queryByText("Professor, não entendi o chmod")).toBeNull();
      expect(screen.queryByText("Use chmod 644 arquivo")).toBeNull();
    });

    it("has only the button for everybody, with the text field", () => {
      render(<TeacherChat {...props({ target: "all", studentName: "" })} />);
      expect(screen.getByRole("textbox", { name: "Mensagem" })).toBeDefined();
      expect(sendAll()).toBeDefined();
      expect(screen.queryByRole("button", { name: /Enviar só para/ })).toBeNull();
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });

    it("says there is no message yet", () => {
      render(<TeacherChat {...props({ target: "all", studentName: "", chat: [history[0]!] })} />);
      expect(screen.getByText("Nenhuma mensagem ainda.")).toBeDefined();
    });

    it("never pins a doubt there", () => {
      render(<TeacherChat {...props({ target: "all", studentName: "", doubt: "Como uso o chmod?" })} />);
      expect(screen.queryByText("Dúvida da mão:")).toBeNull();
      expect(screen.queryByText("Como uso o chmod?")).toBeNull();
    });
  });

  describe("the doubt of the raised hand", () => {
    it("is pinned at the top of the conversation, above the messages, with its label", () => {
      render(<TeacherChat {...props({ doubt: "Como uso o chmod?" })} />);
      const label = screen.getByText("Dúvida da mão:");
      expect(label.parentElement!.textContent).toBe("Dúvida da mão:Como uso o chmod?");
      expect(label.compareDocumentPosition(log()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(log()).queryByText("Como uso o chmod?")).toBeNull();
    });

    it("is not there with no doubt, nor with an empty one", () => {
      const view = render(<TeacherChat {...props()} />);
      expect(screen.queryByText("Dúvida da mão:")).toBeNull();
      view.rerender(<TeacherChat {...props({ doubt: "" })} />);
      expect(screen.queryByText("Dúvida da mão:")).toBeNull();
    });

    it("follows the hand: it comes when the hand goes up with a doubt and goes when the hand goes down", () => {
      const view = render(<TeacherChat {...props()} />);
      view.rerender(<TeacherChat {...props({ doubt: "E o chown?" })} />);
      expect(screen.getByText("E o chown?")).toBeDefined();
      view.rerender(<TeacherChat {...props()} />);
      expect(screen.queryByText("E o chown?")).toBeNull();
    });
  });

  describe("plain text (CA-10)", () => {
    const html = "<b>negrito</b> <img src=x onerror=alert(1)>\nsegunda linha";

    it("draws a message as text, never as HTML, whoever wrote it", () => {
      const chat = [
        message({ scope: "private", studentId: "u-1", from: "STUDENT", text: html }),
        message({ scope: "private", studentId: "u-1", from: "TEACHER", text: "<i>itálico</i>" }),
        message({ scope: "all", from: "TEACHER", text: "<script>x()</script>" }),
      ];
      render(<TeacherChat {...props({ chat })} />);
      expect(screen.getByText(html, { normalizer: (text) => text })).toBeDefined();
      expect(screen.getByText("<i>itálico</i>")).toBeDefined();
      expect(screen.getByText("<script>x()</script>")).toBeDefined();
      expect(log().querySelector("b, i, img, script")).toBeNull();
    });

    it("draws the doubt as text too", () => {
      const { container } = render(<TeacherChat {...props({ doubt: "<b>x</b>" })} />);
      expect(screen.getByText("<b>x</b>")).toBeDefined();
      expect(container.querySelector("b")).toBeNull();
    });

    it("keeps the line breaks of a message and of the doubt, in the style", () => {
      expect(styleOf("./TeacherChat.module.scss")).toMatch(/white-space:\s*pre-wrap/);
    });
  });

  describe("the text field", () => {
    it("has a name, the counter out of 500, and starts empty", () => {
      render(<TeacherChat {...props()} />);
      expect(field().value).toBe("");
      expect(screen.getByText("0/500")).toBeDefined();
    });

    it("counts the characters as they are typed", () => {
      render(<TeacherChat {...props()} />);
      type("Olá, Ana!");
      expect(screen.getByText("9/500")).toBeDefined();
    });

    it("keeps at most 500 characters, counted by character and not by byte: 500 emoji fit", () => {
      render(<TeacherChat {...props()} />);
      type("a".repeat(505));
      expect(field().value).toBe("a".repeat(500));
      expect(screen.getByText("500/500")).toBeDefined();
      type("😀".repeat(505));
      expect(Array.from(field().value)).toHaveLength(500);
      expect(screen.getByText("500/500")).toBeDefined();
      expect(field().value.endsWith("😀")).toBe(true);
    });

    it("takes out the control characters, which the server would not take, and keeps the line break", () => {
      render(<TeacherChat {...props()} />);
      type("a\tb\u0007c\r\nd\ne");
      expect(field().value).toBe("abc\nd\ne");
    });

    it("keeps at most three line breaks in a row, which is all the server takes", () => {
      render(<TeacherChat {...props()} />);
      type("a\n\n\n\n\n\nb\n\nc");
      expect(field().value).toBe("a\n\n\nb\n\nc");
    });

    it("keeps what is written for each conversation, so a click on another card does not lose it nor send it to the wrong place", () => {
      const view = render(<TeacherChat {...props()} />);
      type("Para a Ana");
      view.rerender(<TeacherChat {...props({ target: BRUNO, studentName: "Bruno Lima" })} />);
      expect(field().value).toBe("");
      type("Para o Bruno");
      view.rerender(<TeacherChat {...props({ target: "all", studentName: "" })} />);
      expect(field().value).toBe("");
      view.rerender(<TeacherChat {...props()} />);
      expect(field().value).toBe("Para a Ana");
      view.rerender(<TeacherChat {...props({ target: BRUNO, studentName: "Bruno Lima" })} />);
      expect(field().value).toBe("Para o Bruno");
    });

    it("puts the cursor in the field when a conversation opens, so the teacher can write at once", () => {
      const view = render(<TeacherChat {...props({ target: null, studentName: "" })} />);
      view.rerender(<TeacherChat {...props()} />);
      expect(document.activeElement).toBe(field());
    });
  });

  describe("sending", () => {
    it("sends in private to the student with the main button, with the text as written", () => {
      const p = props();
      render(<TeacherChat {...p} />);
      type("Veja o manual: man chmod");
      fireEvent.click(sendPrivate());
      expect(p.onSend).toHaveBeenCalledTimes(1);
      expect(p.onSend).toHaveBeenCalledWith("Veja o manual: man chmod", ANA);
    });

    it("sends to everybody with the other button, from the conversation with a student", () => {
      const p = props();
      render(<TeacherChat {...p} />);
      type("Pessoal, vejam o man chmod");
      fireEvent.click(sendAll());
      expect(p.onSend).toHaveBeenCalledTimes(1);
      expect(p.onSend).toHaveBeenCalledWith("Pessoal, vejam o man chmod", "all");
    });

    it("sends to everybody with the only button of the channel for everybody", () => {
      const p = props({ target: "all", studentName: "" });
      render(<TeacherChat {...p} />);
      type("Boa aula a todos");
      fireEvent.click(sendAll());
      expect(p.onSend).toHaveBeenCalledWith("Boa aula a todos", "all");
    });

    it("sends in private with Enter, in the conversation with a student, never to everybody", () => {
      const p = props();
      render(<TeacherChat {...p} />);
      type("Resposta só para você");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(p.onSend).toHaveBeenCalledTimes(1);
      expect(p.onSend).toHaveBeenCalledWith("Resposta só para você", ANA);
    });

    it("sends to everybody with Enter in the channel for everybody", () => {
      const p = props({ target: "all", studentName: "" });
      render(<TeacherChat {...p} />);
      type("Aviso geral");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(p.onSend).toHaveBeenCalledTimes(1);
      expect(p.onSend).toHaveBeenCalledWith("Aviso geral", "all");
    });

    it("breaks the line with Shift+Enter instead of sending", () => {
      const p = props();
      render(<TeacherChat {...p} />);
      type("primeira linha");
      const proceeded = fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
      expect(p.onSend).not.toHaveBeenCalled();
      // The default of the key is not stopped, so the browser puts the line break in the field.
      expect(proceeded).toBe(true);
    });

    it("does not send with Enter that only confirms a word of an input method, nor with other keys", () => {
      const p = props();
      render(<TeacherChat {...p} />);
      type("こんにちは");
      fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
      fireEvent.keyDown(field(), { key: "a" });
      expect(p.onSend).not.toHaveBeenCalled();
    });

    it("stops the line break that Enter would add when it sends", () => {
      render(<TeacherChat {...props()} />);
      type("oi");
      expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(false);
    });

    it("clears the field only when the message went", () => {
      const onSend = vi.fn(() => true);
      render(<TeacherChat {...props({ onSend })} />);
      type("Vai");
      fireEvent.click(sendPrivate());
      expect(field().value).toBe("");
      expect(screen.getByText("0/500")).toBeDefined();
    });

    it("keeps the text when the message did not go, and says nothing was sent to everybody", () => {
      const onSend = vi.fn(() => false);
      render(<TeacherChat {...props({ onSend })} />);
      type("Não vai");
      fireEvent.click(sendPrivate());
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(field().value).toBe("Não vai");
      fireEvent.click(sendAll());
      expect(field().value).toBe("Não vai");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(field().value).toBe("Não vai");
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("does not show the message before the room gives it back: there is no optimistic message", () => {
      render(<TeacherChat {...props()} />);
      type("Ainda não chegou");
      fireEvent.click(sendPrivate());
      expect(screen.queryByText("Ainda não chegou")).toBeNull();
      expect(timeline()).toHaveLength(3);
    });
  });

  describe("the notice of the message for everybody", () => {
    it("says it went, with role status, after sending to everybody from the conversation with a student", () => {
      render(<TeacherChat {...props()} />);
      expect(screen.queryByRole("status")).toBeNull();
      type("Para todos");
      fireEvent.click(sendAll());
      expect(screen.getByRole("status").textContent).toBe("Mensagem enviada para todos os alunos.");
    });

    it("does not say it after a message in private", () => {
      render(<TeacherChat {...props()} />);
      type("Só para você");
      fireEvent.click(sendPrivate());
      expect(screen.queryByRole("status")).toBeNull();
      type("Enter também");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("does not say it in the channel for everybody, where there is no doubt about where the message goes", () => {
      render(<TeacherChat {...props({ target: "all", studentName: "" })} />);
      type("Para todos");
      fireEvent.click(sendAll());
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("goes away when the teacher writes again, or sends in private", () => {
      render(<TeacherChat {...props()} />);
      type("Para todos");
      fireEvent.click(sendAll());
      expect(screen.getByRole("status")).toBeDefined();
      type("O");
      expect(screen.queryByRole("status")).toBeNull();
      fireEvent.click(sendAll());
      expect(screen.getByRole("status")).toBeDefined();
      type("Agora em particular");
      fireEvent.click(sendPrivate());
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("belongs to the conversation where it was sent: another conversation does not show it", () => {
      const view = render(<TeacherChat {...props()} />);
      type("Para todos");
      fireEvent.click(sendAll());
      view.rerender(<TeacherChat {...props({ target: BRUNO, studentName: "Bruno Lima" })} />);
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  describe("when there is nothing to send, or no connection", () => {
    it("has both buttons off with an empty field, or with only blanks, and Enter sends nothing", () => {
      const p = props();
      render(<TeacherChat {...p} />);
      expect(sendPrivate().disabled).toBe(true);
      expect(sendAll().disabled).toBe(true);
      fireEvent.keyDown(field(), { key: "Enter" });
      type("   \n  ");
      expect(sendPrivate().disabled).toBe(true);
      expect(sendAll().disabled).toBe(true);
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(p.onSend).not.toHaveBeenCalled();
    });

    it("turns the buttons on with some text", () => {
      render(<TeacherChat {...props()} />);
      type("Oi");
      expect(sendPrivate().disabled).toBe(false);
      expect(sendAll().disabled).toBe(false);
    });

    it("has the button of the channel off with an empty field", () => {
      render(<TeacherChat {...props({ target: "all", studentName: "" })} />);
      expect(sendAll().disabled).toBe(true);
    });

    it("has the buttons off without a connection, says so, and Enter sends nothing", () => {
      const p = props({ connected: false });
      render(<TeacherChat {...p} />);
      type("Escrevi sem rede");
      expect(screen.getByText("Sem conexão. Reconectando…")).toBeDefined();
      expect(sendPrivate().disabled).toBe(true);
      expect(sendAll().disabled).toBe(true);
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(p.onSend).not.toHaveBeenCalled();
      expect(field().value).toBe("Escrevi sem rede");
    });

    it("says nothing about the connection while it is up, and sends again once it is back", () => {
      const p = props({ connected: false });
      const view = render(<TeacherChat {...p} />);
      type("Escrevi sem rede");
      view.rerender(<TeacherChat {...props({ connected: true, onSend: p.onSend })} />);
      expect(screen.queryByText("Sem conexão. Reconectando…")).toBeNull();
      fireEvent.click(sendPrivate());
      expect(p.onSend).toHaveBeenCalledWith("Escrevi sem rede", ANA);
    });
  });

  describe("the list of messages", () => {
    afterEach(() => vi.restoreAllMocks());

    it("is a log that is read as it grows, named after the conversation", () => {
      render(<TeacherChat {...props()} />);
      expect(screen.getByRole("log", { name: "Conversa com Ana Souza" })).toBeDefined();
    });

    it("keeps the newest message in view: it scrolls to the end when it opens and when a message arrives", () => {
      const scrollHeight = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(480);
      const view = render(<TeacherChat {...props()} />);
      expect(log().scrollTop).toBe(480);
      scrollHeight.mockReturnValue(900);
      const incoming = message({ scope: "private", studentId: "u-1", from: "STUDENT", text: "Mais uma" });
      view.rerender(<TeacherChat {...props({ chat: [...history, incoming] })} />);
      expect(log().scrollTop).toBe(900);
    });
  });

  it("uses only the tokens of the theme, with no color written in the style", () => {
    const css = styleOf("./TeacherChat.module.scss");
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});
