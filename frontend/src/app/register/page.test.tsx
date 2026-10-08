import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "./page";
import { messages } from "@/messages/pt-BR";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

describe("RegisterPage", () => {
  it("renders the unified AuthContainer with register active", () => {
    render(<RegisterPage />);
    const registerTab = screen.getByRole("tab", { name: messages.auth.register.title });
    expect(registerTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText(messages.auth.register.name)).toBeDefined();
    expect(screen.getByLabelText(messages.auth.register.email)).toBeDefined();
    expect(screen.getByRole("button", { name: messages.auth.google.button })).toBeDefined();
  });
});
