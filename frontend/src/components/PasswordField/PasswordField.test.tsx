import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { messages } from "@/messages/pt-BR";
import { PasswordField } from "./PasswordField";

afterEach(cleanup);

const LABEL = "Senha de teste";
const field = () => screen.getByLabelText(LABEL) as HTMLInputElement;
const toggle = (name: string) => screen.getByRole("button", { name });
const drawing = (button: HTMLElement) => button.querySelector("svg");

// SPEC-066: the eye that shows and hides the password
describe("PasswordField", () => {
  // CA-02, CA-05
  it("starts with the password hidden, the open eye and the button that says how to show it", () => {
    render(<PasswordField label={LABEL} />);
    const button = toggle(messages.auth.showPassword);

    expect(field().type).toBe("password");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const eye = drawing(button);
    expect(eye).not.toBeNull();
    expect(eye!.getAttribute("aria-hidden")).toBe("true");
    expect(eye!.querySelector("line"), "the open eye has no slash").toBeNull();
  });

  // CA-03
  it("shows the password with the crossed eye and the button that says how to hide it", () => {
    render(<PasswordField label={LABEL} />);
    const before = drawing(toggle(messages.auth.showPassword))!.innerHTML;

    fireEvent.click(toggle(messages.auth.showPassword));

    const button = toggle(messages.auth.hidePassword);
    expect(field().type).toBe("text");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    const eye = drawing(button)!;
    expect(eye.getAttribute("aria-hidden")).toBe("true");
    expect(eye.querySelector("line"), "the crossed eye has the slash").not.toBeNull();
    expect(eye.innerHTML).not.toBe(before);
  });

  // CA-04
  it("hides the password again, with the first eye and the first name of the button", () => {
    render(<PasswordField label={LABEL} />);
    const first = drawing(toggle(messages.auth.showPassword))!.innerHTML;
    fireEvent.click(toggle(messages.auth.showPassword));
    fireEvent.click(toggle(messages.auth.hidePassword));

    const button = toggle(messages.auth.showPassword);
    expect(field().type).toBe("password");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(drawing(button)!.innerHTML).toBe(first);
  });

  // CA-06
  it("keeps what was typed when it shows and hides the password", () => {
    render(<PasswordField label={LABEL} />);
    fireEvent.change(field(), { target: { value: "Segredo123!" } });

    fireEvent.click(toggle(messages.auth.showPassword));
    expect(field().value).toBe("Segredo123!");
    fireEvent.click(toggle(messages.auth.hidePassword));
    expect(field().value).toBe("Segredo123!");
  });

  // CA-05
  it("does not draw the eye with characters, in either state", () => {
    const { container } = render(<PasswordField label={LABEL} />);
    expect(container.textContent).not.toMatch(/[◎◉]/);
    fireEvent.click(toggle(messages.auth.showPassword));
    expect(container.textContent).not.toMatch(/[◎◉]/);
  });
});
