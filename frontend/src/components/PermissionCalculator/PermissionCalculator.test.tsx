import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { PermissionCalculator } from "./PermissionCalculator";

afterEach(cleanup);

const m = contentMessages.calculator;

// Covers SPEC-012 CA-08 for the permission calculator.
describe("PermissionCalculator", () => {
  it("starts at 754 like the legacy widget", () => {
    render(<PermissionCalculator />);
    expect(screen.getByTestId("symbolic").textContent).toBe("-rwxr-xr--");
    expect(screen.getByTestId("command").textContent).toBe(m.command("754"));
  });

  it("updates the octal value when bits are toggled", () => {
    render(<PermissionCalculator />);
    fireEvent.click(screen.getByLabelText(`${m.who.g} w`));
    expect(screen.getByTestId("sum-g").textContent).toBe("7");
    expect(screen.getByTestId("command").textContent).toBe(m.command("774"));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("774");
  });

  it("updates the checkboxes when a valid octal is typed and ignores invalid input", () => {
    render(<PermissionCalculator />);
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "640" } });
    expect(screen.getByTestId("symbolic").textContent).toBe("-rw-r-----");
    fireEvent.change(field, { target: { value: "98" } });
    expect(screen.getByTestId("symbolic").textContent).toBe("-rw-r-----");
    expect((screen.getByLabelText(`${m.who.u} x`) as HTMLInputElement).checked).toBe(false);
  });
});
