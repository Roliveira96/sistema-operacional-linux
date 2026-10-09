import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type IdentitySources } from "@/hooks/useIdentity";
import { messages } from "@/messages/pt-BR";
import { NavbarPublic } from "./NavbarPublic";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
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
    expect(await screen.findByText("RA 2345678")).toBeTruthy();
    expect(screen.getByText("Ana Souza")).toBeTruthy();
    expect(entrar()).toBeNull();
    expect(cadastrar()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: messages.public.nav.myArea }));
    expect(mockPush).toHaveBeenCalledWith("/app");
  });

  it("shows a teacher by name, without academic ID, and no sign-in buttons", async () => {
    render(<NavbarPublic identity={teacher()} />);
    expect(await screen.findByText("Profa. Sediane")).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: messages.public.nav.logout }));

    await waitFor(() => expect(entrar()).toBeTruthy());
    expect(logout).toHaveBeenCalledTimes(1);
    expect(cadastrar()).toBeTruthy();
    expect(screen.queryByText("Ana Souza")).toBeNull();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("leaves locally even when the server cannot end the session", async () => {
    render(<NavbarPublic identity={student()} logout={vi.fn().mockRejectedValue(new Error("down"))} />);
    fireEvent.click(await screen.findByRole("button", { name: messages.public.nav.logout }));
    await waitFor(() => expect(entrar()).toBeTruthy());
  });

  it("renders the header and navigation without a theme toggle (SPEC-015 CA-08)", async () => {
    const { container } = render(<NavbarPublic identity={visitor()} />);
    expect(container.querySelector("header")).toBeTruthy();
    expect(container.querySelector("nav")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /tema/i })).toBeNull();
    await waitFor(() => expect(entrar()).toBeTruthy());
  });
});
