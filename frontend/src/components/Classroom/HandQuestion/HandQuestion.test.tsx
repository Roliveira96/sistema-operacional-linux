import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HandQuestion } from "./HandQuestion";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

afterEach(cleanup);

const field = () => screen.getByRole("textbox", { name: "Escreva sua dúvida (opcional)" }) as HTMLInputElement;
const send = () => screen.getByRole("button", { name: "Enviar dúvida" }) as HTMLButtonElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

function setup(saved = "") {
  const onSend = vi.fn();
  const view = render(<HandQuestion saved={saved} onSend={onSend} />);
  return { onSend, view };
}

// SPEC-058 CA-04: the doubt that goes with the raised hand, on the strip of controls of the student
describe("HandQuestion", () => {
  it("has the field, the counter out of 300 and the button, with nothing to send at first", () => {
    setup();
    expect(field().value).toBe("");
    expect(field().getAttribute("placeholder")).toBe("Escreva sua dúvida (opcional)");
    expect(screen.getByText("0/300")).toBeDefined();
    expect(send().disabled).toBe(true);
    expect(screen.queryByText("Dúvida enviada")).toBeNull();
  });

  it("counts the characters as they are typed", () => {
    setup();
    type("Como uso o chmod?");
    expect(screen.getByText("17/300")).toBeDefined();
    expect(send().disabled).toBe(false);
  });

  it("sends the doubt with the button, trimmed", () => {
    const { onSend } = setup();
    type("  Como uso o chmod?  ");
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Como uso o chmod?");
  });

  it("sends the doubt with Enter too, but not while an input method is still composing the text", () => {
    const { onSend } = setup();
    type("Como uso o chmod?");
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "a" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Como uso o chmod?");
  });

  it("sends nothing with Enter while there is nothing new to send", () => {
    const { onSend } = setup();
    fireEvent.keyDown(field(), { key: "Enter" });
    type("   ");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(send().disabled).toBe(true);
  });

  it("keeps at most 300 characters", () => {
    setup();
    type("a".repeat(305));
    expect(field().value).toBe("a".repeat(300));
    expect(screen.getByText("300/300")).toBeDefined();
  });

  it("counts characters and not bytes, as the server does: 300 emoji fit", () => {
    setup();
    type("😀".repeat(305));
    expect(Array.from(field().value)).toHaveLength(300);
    expect(screen.getByText("300/300")).toBeDefined();
    expect(field().value.endsWith("😀")).toBe(true);
  });

  it("takes the control characters out of what is typed or pasted, which the server would not take", () => {
    setup();
    type("a\tb\u0007c\r\nd");
    expect(field().value).toBe("abcd");
  });

  // CA-04: "Dúvida enviada", and the doubt can be edited and sent again
  it("says that the doubt was sent once the hand is known to carry it, and the button has nothing more to send", () => {
    const { onSend, view } = setup();
    type("Como uso o chmod?");
    fireEvent.click(send());
    view.rerender(<HandQuestion saved="Como uso o chmod?" onSend={onSend} />);
    expect(screen.getByRole("status").textContent).toBe("Dúvida enviada");
    expect(field().value).toBe("Como uso o chmod?");
    expect(send().disabled).toBe(true);
  });

  it("lets the doubt be edited and sent again, and stops saying it was sent while the text is another one", () => {
    const { onSend } = setup("Como uso o chmod?");
    expect(screen.getByRole("status").textContent).toBe("Dúvida enviada");
    type("Como uso o chmod com -R?");
    expect(screen.queryByText("Dúvida enviada")).toBeNull();
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    expect(onSend).toHaveBeenLastCalledWith("Como uso o chmod com -R?");
  });

  it("says it was sent again when the text goes back to the one that was sent", () => {
    setup("Como uso o chmod?");
    type("Como uso o chmod");
    expect(screen.queryByText("Dúvida enviada")).toBeNull();
    type("  Como uso o chmod?  ");
    expect(screen.getByText("Dúvida enviada")).toBeDefined();
  });

  it("takes the doubt away when it is sent with no text", () => {
    const { onSend } = setup("Como uso o chmod?");
    type("");
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledWith("");
  });

  // CA-07: whoever comes back with the hand up finds the doubt in the field
  it("starts with the doubt that the room has for the student, and says it was sent", () => {
    setup("Como uso o chmod?");
    expect(field().value).toBe("Como uso o chmod?");
    expect(screen.getByText("Dúvida enviada")).toBeDefined();
    expect(screen.getByText("17/300")).toBeDefined();
  });

  it("keeps what the student is typing, whatever the room tells about the doubt that was sent: only the 'sent' mark follows it", () => {
    const onSend = vi.fn();
    const view = render(<HandQuestion saved="" onSend={onSend} />);
    type("rascunho ainda não enviado");
    view.rerender(<HandQuestion saved="" onSend={onSend} />);
    expect(field().value).toBe("rascunho ainda não enviado");
    view.rerender(<HandQuestion saved="outra dúvida" onSend={onSend} />);
    expect(screen.queryByText("Dúvida enviada")).toBeNull();
    expect(field().value).toBe("rascunho ainda não enviado");
  });

  it("uses only the tokens of the theme, with no color written in the style", () => {
    const css = styleOf("./HandQuestion.module.scss");
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});
