import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveChatMessage } from "@/services/classroomService";
import { StudentChat } from "./StudentChat";

// A path in a variable, because Vite turns a literal `new URL("./file", import.meta.url)` into an asset URL.
const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const styles = styleOf("./StudentChat.module.scss");
const rule = (name: string) => styles.slice(styles.indexOf(`.${name} {`), styles.indexOf("}", styles.indexOf(`.${name} {`)));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const message = (over: Partial<LiveChatMessage> & { id: string }): LiveChatMessage => ({ scope: "all", from: "TEACHER", text: "texto", createdAt: "2026-10-14T10:00:00Z", ...over });
const forAll = (id: string, text: string) => message({ id, scope: "all", from: "TEACHER", text });
const toMe = (id: string, text: string) => message({ id, scope: "private", studentId: "u-1", from: "TEACHER", text });
const mine = (id: string, text: string) => message({ id, scope: "private", studentId: "u-1", from: "STUDENT", text });

const field = () => screen.getByRole("textbox", { name: "Mensagem para o professor" }) as HTMLTextAreaElement;
const send = () => screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const log = () => screen.getByRole("log");

function setup(over: { messages?: LiveChatMessage[]; connected?: boolean; accepted?: boolean } = {}) {
  const onSend = vi.fn<(text: string) => boolean>(() => over.accepted ?? true);
  const props = { messages: over.messages ?? [], connected: over.connected ?? true, onSend };
  const view = render(<StudentChat {...props} />);
  return { onSend, props, view, again: (next: Partial<typeof props>) => view.rerender(<StudentChat {...props} {...next} />) };
}

// SPEC-063 CA-08, CA-10: what is inside the column of the conversation of the student
describe("StudentChat", () => {
  describe("the messages", () => {
    it("tells the student what to do while there is nothing to read, with no list", () => {
      setup();
      expect(within(log()).getByText("Escreva para o professor. As mensagens do professor para todos aparecem aqui.")).toBeDefined();
      expect(screen.queryByRole("list")).toBeNull();
    });

    it("has no empty text once there is a message", () => {
      setup({ messages: [forAll("m-1", "Bom dia")] });
      expect(screen.queryByText(/Escreva para o professor\. As mensagens/)).toBeNull();
    });

    // The three kinds of message are told by a text, never by a color alone
    it("marks each message: for everybody, only for the student, and the student's own", () => {
      setup({ messages: [forAll("m-1", "Bom dia a todos"), toMe("m-2", "Veja o slide 3"), mine("m-3", "Obrigado")] });
      const items = within(log()).getAllByRole("listitem");
      expect(items).toHaveLength(3);
      const [everybody, onlyMe, own] = items as [HTMLElement, HTMLElement, HTMLElement];
      expect(within(everybody).getByText("Professor · para todos")).toBeDefined();
      expect(within(everybody).getByText("Bom dia a todos")).toBeDefined();
      expect(within(onlyMe).getByText("Professor · só para você")).toBeDefined();
      expect(within(onlyMe).getByText("Veja o slide 3")).toBeDefined();
      expect(within(own).getByText("Você")).toBeDefined();
      expect(within(own).getByText("Obrigado")).toBeDefined();
    });

    it("keeps the order the room gave, which is the order of the time, the newest last", () => {
      setup({ messages: [forAll("m-1", "primeira"), mine("m-2", "segunda"), toMe("m-3", "terceira"), forAll("m-4", "quarta")] });
      expect(within(log()).getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent)).toEqual(["primeira", "segunda", "terceira", "quarta"]);
    });

    it("draws the messages that come after, and keeps the ones it had", () => {
      const { again } = setup({ messages: [forAll("m-1", "primeira")] });
      again({ messages: [forAll("m-1", "primeira"), toMe("m-2", "segunda")] });
      expect(within(log()).getAllByRole("listitem")).toHaveLength(2);
      expect(screen.getByText("segunda")).toBeDefined();
    });

    // CA-10: text and nothing else
    it("draws a message as plain text, never as HTML", () => {
      const view = setup({ messages: [toMe("m-1", "<b>negrito</b> e <img src=x onerror=alert(1)>")] }).view;
      expect(screen.getByText("<b>negrito</b> e <img src=x onerror=alert(1)>")).toBeDefined();
      expect(view.container.querySelector("b, img")).toBeNull();
    });

    it("keeps the line breaks of a message, which the style leaves as they are", () => {
      setup({ messages: [forAll("m-1", "linha um\nlinha dois\n\nlinha quatro")] });
      const text = screen.getByText(/linha um/);
      expect(text.textContent).toBe("linha um\nlinha dois\n\nlinha quatro");
      expect(rule("text")).toMatch(/white-space:\s*pre-wrap/);
    });

    it("breaks a long word instead of running over the column", () => {
      expect(rule("text")).toMatch(/overflow-wrap:\s*anywhere|word-break:\s*break-word/);
    });
  });

  describe("the newest message in view", () => {
    // jsdom has no layout: the height of the list is given, and the place of the scroll says whether it went to the end
    it("has the list at the end when it opens with the history", () => {
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(900);
      setup({ messages: [forAll("m-1", "a"), forAll("m-2", "b")] });
      expect(log().scrollTop).toBe(900);
    });

    it("goes to the end when a message comes, even if the student had gone up", () => {
      const height = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(900);
      const { again } = setup({ messages: [forAll("m-1", "a")] });
      log().scrollTop = 10;
      height.mockReturnValue(1300);
      again({ messages: [forAll("m-1", "a"), forAll("m-2", "b")] });
      expect(log().scrollTop).toBe(1300);
    });

    it("does not pull the list down when what changed is not a message", () => {
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(900);
      const { props, again } = setup({ messages: [forAll("m-1", "a")] });
      log().scrollTop = 10;
      again({ connected: false, messages: props.messages });
      expect(log().scrollTop).toBe(10);
    });

    it("has the list scroll by itself, with the field always under it, and be reached by the keyboard", () => {
      setup();
      expect(rule("list")).toMatch(/overflow-y:\s*auto/);
      expect(rule("list")).toMatch(/flex:\s*1/);
      expect(log().getAttribute("tabindex")).toBe("0");
    });
  });

  describe("the field", () => {
    it("has the labelled field, the counter out of 500 and the button, which has nothing to send at first", () => {
      setup();
      expect(field().value).toBe("");
      expect(screen.getByText("0/500")).toBeDefined();
      expect(send().disabled).toBe(true);
      expect(screen.queryByText("Sem conexão. Reconectando…")).toBeNull();
    });

    it("counts by character as it is typed, as the server counts, and not by byte", () => {
      setup();
      type("Olá");
      expect(screen.getByText("3/500")).toBeDefined();
      type("😀😀");
      expect(screen.getByText("2/500")).toBeDefined();
    });

    it("takes no more than 500 characters, whatever they are made of", () => {
      setup();
      type("a".repeat(600));
      expect(field().value).toHaveLength(500);
      expect(screen.getByText("500/500")).toBeDefined();
      type("😀".repeat(501));
      expect(Array.from(field().value)).toHaveLength(500);
      expect(screen.getByText("500/500")).toBeDefined();
    });

    // What the server does not take: control characters except the line break, and more than three line breaks in a row
    it("drops the control characters but keeps the line break", () => {
      setup();
      type("a\u0007b\tc\r\nd\u0000");
      expect(field().value).toBe("abc\nd");
    });

    it("does not let more than three line breaks in a row through, which the server would refuse", () => {
      setup();
      type("a\n\n\n\n\n\nb\n\n\nc");
      expect(field().value).toBe("a\n\n\nb\n\n\nc");
    });

    it("has a button that wakes up with the first character, and sleeps with only blanks", () => {
      setup();
      type("   \n  ");
      expect(send().disabled).toBe(true);
      type("oi");
      expect(send().disabled).toBe(false);
    });
  });

  describe("sending", () => {
    it("sends the text, trimmed, with the button, and empties the field once it went", () => {
      const { onSend } = setup();
      type("  Como uso o chmod?  ");
      fireEvent.click(send());
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith("Como uso o chmod?");
      expect(field().value).toBe("");
      expect(screen.getByText("0/500")).toBeDefined();
      expect(send().disabled).toBe(true);
    });

    it("sends with Enter, and empties the field", () => {
      const { onSend } = setup();
      type("Como uso o chmod?");
      const free = fireEvent.keyDown(field(), { key: "Enter" });
      expect(free).toBe(false);
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith("Como uso o chmod?");
      expect(field().value).toBe("");
    });

    it("breaks the line with Shift+Enter and sends nothing", () => {
      const { onSend } = setup();
      type("linha um");
      const free = fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
      expect(free).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
      expect(field().value).toBe("linha um");
    });

    it("sends the line breaks of the text it has, inside it", () => {
      const { onSend } = setup();
      type("linha um\nlinha dois");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onSend).toHaveBeenCalledWith("linha um\nlinha dois");
    });

    it("does not send with the Enter that only confirms a word of an input method", () => {
      const { onSend } = setup();
      type("こんにちは");
      const free = fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
      expect(free).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
      expect(field().value).toBe("こんにちは");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it("sends nothing with Enter on an empty field, or on blanks, and keeps the line break out of the way", () => {
      const { onSend } = setup();
      fireEvent.keyDown(field(), { key: "Enter" });
      type("  \n ");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("keeps what was written when the message did not go, so it is not lost", () => {
      const { onSend } = setup({ accepted: false });
      type("Como uso o chmod?");
      fireEvent.click(send());
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(field().value).toBe("Como uso o chmod?");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onSend).toHaveBeenCalledTimes(2);
      expect(field().value).toBe("Como uso o chmod?");
    });

    it("keeps what the student is writing when a message comes in", () => {
      const { again } = setup();
      type("meio da frase");
      again({ messages: [forAll("m-1", "Atenção")] });
      expect(field().value).toBe("meio da frase");
      expect(screen.getByText("13/500")).toBeDefined();
    });

    it("shows no message of its own before the room gives it back", () => {
      setup();
      type("oi");
      fireEvent.click(send());
      expect(screen.queryByRole("listitem")).toBeNull();
    });
  });

  // CA-08: without a connection nothing goes
  describe("without a connection", () => {
    it("tells it, and has the button off even with a text to send", () => {
      setup({ connected: false });
      expect(screen.getByText("Sem conexão. Reconectando…")).toBeDefined();
      type("oi");
      expect(send().disabled).toBe(true);
    });

    it("sends nothing with Enter, and keeps the text for when the connection is back", () => {
      const { onSend, again } = setup({ connected: false });
      type("oi");
      fireEvent.keyDown(field(), { key: "Enter" });
      fireEvent.click(send());
      expect(onSend).not.toHaveBeenCalled();
      expect(field().value).toBe("oi");
      again({ connected: true });
      expect(screen.queryByText("Sem conexão. Reconectando…")).toBeNull();
      expect(send().disabled).toBe(false);
    });

    it("lets him keep writing, and still reads what is there", () => {
      setup({ connected: false, messages: [forAll("m-1", "Atenção")] });
      expect(field().disabled).toBe(false);
      expect(screen.getByText("Atenção")).toBeDefined();
    });

    it("says the loss of the connection to the screen reader, as a status", () => {
      setup({ connected: false });
      expect(screen.getByRole("status").textContent).toBe("Sem conexão. Reconectando…");
    });
  });

  describe("the style", () => {
    it("uses only the tokens of the theme, no color written in it", () => {
      expect(styles.length).toBeGreaterThan(0);
      expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(styles).not.toMatch(/\brgba?\(/);
      expect(styles).not.toMatch(/\bhsla?\(/);
    });

    it("shows where the focus is in the field and in the list", () => {
      expect(styles).toMatch(/@include mixins\.focusable/);
      expect(rule("field")).toMatch(/@include mixins\.focusable/);
      expect(rule("list")).toMatch(/@include mixins\.focusable/);
    });
  });
});
