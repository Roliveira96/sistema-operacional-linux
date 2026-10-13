import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type IdentitySources } from "@/hooks/useIdentity";
import { messages } from "@/messages/pt-BR";
import { NavbarPublic } from "./NavbarPublic";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/services/classService", () => ({
  classService: { myClasses: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

afterEach(() => {
  cleanup();
  mockPush.mockClear();
  mockRefresh.mockClear();
});

const visitor = (): IdentitySources => ({ me: vi.fn().mockRejectedValue(new Error("401")), studentProfile: vi.fn() });

const student = (): IdentitySources => ({
  me: vi.fn().mockResolvedValue({ name: "Ana Souza", email: "ana@example.com", role: "STUDENT" }),
  studentProfile: vi.fn().mockResolvedValue({ name: "Ana Souza", academicId: "2345678", avatarUrl: undefined }),
});

const teacher = (): IdentitySources => ({
  me: vi.fn().mockResolvedValue({ name: "Profa. Sediane", email: "s@utfpr.edu.br", role: "TEACHER" }),
  studentProfile: vi.fn(),
});

const entrar = () => screen.queryByRole("button", { name: messages.public.nav.login });
const cadastrar = () => screen.queryByRole("button", { name: messages.public.nav.register });

describe("NavbarPublic", () => {
  it("renders the brand with the real logo of the university, and the links", async () => {
    render(<NavbarPublic identity={visitor()} />);

    expect(screen.getByText(messages.public.nav.brand)).toBeTruthy();
    const logo = screen.getByRole("img", { name: messages.public.nav.logoAlt });
    expect(logo.getAttribute("src")).toContain("utfpr-logo.svg");

    const homeLink = screen.getByRole("link", { name: messages.public.nav.home });
    expect(homeLink.getAttribute("href")).toBe("/");
    const materialsLink = screen.getByRole("link", { name: messages.public.nav.materials });
    expect(materialsLink.getAttribute("href")).toBe("/materials");
    const simulationsLink = screen.getByRole("link", { name: messages.public.nav.simulations });
    expect(simulationsLink.getAttribute("href")).toBe("/simulations");
    await waitFor(() => expect(entrar()).toBeTruthy());
  });

  // Covers SPEC-007 CA: a visitor gets the sign-in and sign-up buttons.
  it("shows Entrar and Cadastrar to a visitor and navigates with them", async () => {
    render(<NavbarPublic identity={visitor()} />);
    fireEvent.click(await screen.findByRole("button", { name: messages.public.nav.login }));
    expect(mockPush).toHaveBeenCalledWith("/login");
    fireEvent.click(screen.getByRole("button", { name: messages.public.nav.register }));
    expect(mockPush).toHaveBeenCalledWith("/register");
    expect(screen.queryByRole("button", { name: messages.public.nav.logout })).toBeNull();
  });

  // The student said it: a signed-in student must never be offered to sign in or sign up.
  it("shows the signed-in student, their area and a way out instead of Entrar and Cadastrar", async () => {
    render(<NavbarPublic identity={student()} />);
    expect(await screen.findByRole("button", { name: "Ana Souza" })).toBeTruthy();
    expect(screen.queryByText(/^RA /)).toBeNull();
    expect(screen.queryByRole("button", { name: messages.public.nav.logout })).toBeNull();
    expect(entrar()).toBeNull();
    expect(cadastrar()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: messages.public.nav.myArea }));
    expect(mockPush).toHaveBeenCalledWith("/app");
  });

  it("shows a teacher by name, without academic ID, and no sign-in buttons", async () => {
    render(<NavbarPublic identity={teacher()} />);
    expect(await screen.findByRole("button", { name: "Profa. Sediane" })).toBeTruthy();
    expect(screen.queryByText(/^RA /)).toBeNull();
    expect(entrar()).toBeNull();
    expect(cadastrar()).toBeNull();
  });

  // No flash of "Entrar" for someone who is signed in while the session is read.
  it("shows neither the sign-in buttons nor the user while the session is being read", () => {
    const pending: IdentitySources = { me: vi.fn().mockReturnValue(new Promise(() => {})), studentProfile: vi.fn() };
    render(<NavbarPublic identity={pending} />);
    expect(entrar()).toBeNull();
    expect(cadastrar()).toBeNull();
    expect(screen.queryByRole("button", { name: messages.public.nav.logout })).toBeNull();
  });

  it("ends the session on Sair and goes back to the visitor buttons", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    render(<NavbarPublic identity={student()} logout={logout} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ana Souza" }));
    fireEvent.click(screen.getByRole("button", { name: messages.public.nav.logout }));

    await waitFor(() => expect(entrar()).toBeTruthy());
    expect(logout).toHaveBeenCalledTimes(1);
    expect(cadastrar()).toBeTruthy();
    expect(screen.queryByText("Ana Souza")).toBeNull();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("leaves locally even when the server cannot end the session", async () => {
    render(<NavbarPublic identity={student()} logout={vi.fn().mockRejectedValue(new Error("down"))} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ana Souza" }));
    fireEvent.click(screen.getByRole("button", { name: messages.public.nav.logout }));
    await waitFor(() => expect(entrar()).toBeTruthy());
  });

  it("renders the header and navigation without a theme toggle (SPEC-015 CA-08)", async () => {
    const { container } = render(<NavbarPublic identity={visitor()} />);
    expect(container.querySelector("header")).toBeTruthy();
    expect(container.querySelector("nav")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /tema/i })).toBeNull();
    await waitFor(() => expect(entrar()).toBeTruthy());
  });

  // SPEC-043: Mobile navigation menu
  describe("Mobile navigation (SPEC-043)", () => {
    it("has a mobile menu toggle button that opens and closes public navigation", async () => {
      render(<NavbarPublic identity={visitor()} />);
      const toggleBtn = screen.getByRole("button", { name: messages.public.nav.openMenu });
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("button", { name: messages.public.nav.closeMenu })).toBeDefined();

      const mobileNav = screen.getByRole("navigation", { name: messages.public.nav.mobileAriaLabel });
      expect(within(mobileNav).getByRole("link", { name: messages.public.nav.home })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.public.nav.materials })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.public.nav.simulations })).toBeDefined();

      // For visitor, login and register buttons appear in mobile nav
      expect(within(mobileNav).getByRole("button", { name: messages.public.nav.login })).toBeDefined();
      expect(within(mobileNav).getByRole("button", { name: messages.public.nav.register })).toBeDefined();

      // Press Escape closes it
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("navigation", { name: messages.public.nav.mobileAriaLabel })).toBeNull();
    });

    it("shows myArea button in mobile nav for signed-in student and navigates", async () => {
      render(<NavbarPublic identity={student()} />);
      fireEvent.click(await screen.findByRole("button", { name: messages.public.nav.openMenu }));
      const mobileNav = screen.getByRole("navigation", { name: messages.public.nav.mobileAriaLabel });
      const myAreaBtn = within(mobileNav).getByRole("button", { name: messages.public.nav.myArea });
      fireEvent.click(myAreaBtn);
      expect(mockPush).toHaveBeenCalledWith("/app");
      expect(screen.queryByRole("navigation", { name: messages.public.nav.mobileAriaLabel })).toBeNull();
    });
  });
});
