import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthButton } from "./GoogleAuthButton";
import { messages } from "@/messages/pt-BR";

afterEach(() => {
  cleanup();
});

describe("GoogleAuthButton", () => {
  it("renders with proper accessible label and text", () => {
    render(<GoogleAuthButton />);
    const button = screen.getByRole("button", { name: messages.auth.google.button });
    expect(button).toBeDefined();
    expect(button.textContent).toContain(messages.auth.google.button);
  });

  it("calls custom onClick when provided", () => {
    const handleClick = vi.fn();
    render(<GoogleAuthButton onClick={handleClick} />);
    const button = screen.getByRole("button", { name: messages.auth.google.button });
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop is true", () => {
    render(<GoogleAuthButton disabled />);
    const button = screen.getByRole("button", { name: messages.auth.google.button }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
