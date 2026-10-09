import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { NavbarPublic } from "./NavbarPublic";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

afterEach(() => {
  cleanup();
  mockPush.mockClear();
});

describe("NavbarPublic", () => {
  it("renders the brand, links, and action buttons", () => {
    render(<NavbarPublic />);

    expect(screen.getByText(messages.public.nav.brand)).toBeTruthy();
    expect(screen.getByText(messages.public.nav.institution)).toBeTruthy();

    const homeLink = screen.getByRole("link", { name: messages.public.nav.home });
    expect(homeLink.getAttribute("href")).toBe("/");

    const materialsLink = screen.getByRole("link", { name: messages.public.nav.materials });
    expect(materialsLink.getAttribute("href")).toBe("/materials");

    const simulationsLink = screen.getByRole("link", { name: messages.public.nav.simulations });
    expect(simulationsLink.getAttribute("href")).toBe("/simulations");

    expect(screen.getByRole("button", { name: messages.public.nav.login })).toBeTruthy();
    expect(screen.getByRole("button", { name: messages.public.nav.register })).toBeTruthy();
  });

  it("navigates to /login when clicking the Entrar button", () => {
    render(<NavbarPublic />);
    fireEvent.click(screen.getByRole("button", { name: messages.public.nav.login }));
    expect(mockPush).toHaveBeenCalledWith("/login");
  });

  it("navigates to /register when clicking the Cadastrar button", () => {
    render(<NavbarPublic />);
    fireEvent.click(screen.getByRole("button", { name: messages.public.nav.register }));
    expect(mockPush).toHaveBeenCalledWith("/register");
  });

  it("renders the header and navigation without a theme toggle (SPEC-015 CA-08)", () => {
    const { container } = render(<NavbarPublic />);
    expect(container.querySelector("header")).toBeTruthy();
    expect(container.querySelector("nav")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /tema/i })).toBeNull();
  });
});
