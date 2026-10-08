import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";
import { messages } from "@/messages/pt-BR";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn().mockReturnValue(null) }),
}));

afterEach(() => {
  cleanup();
});

describe("LoginPage", () => {
  it("renders the unified AuthContainer with login active", () => {
    render(<LoginPage />);
    expect(screen.getByRole("tab", { name: messages.auth.login.title })).toBeDefined();
    expect(screen.getByRole("button", { name: messages.auth.google.button })).toBeDefined();
    expect(screen.getByLabelText(messages.auth.login.identifier)).toBeDefined();
  });
});
