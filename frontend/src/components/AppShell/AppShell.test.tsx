import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import type { CurrentUser, Role } from "@/services/authService";
import { getStudentProfile } from "@/services/studentService";
import { AppShell } from "./AppShell";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/services/studentService", () => ({
  getStudentProfile: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const logout = vi.fn();

function signIn(role: Role, overrides: Partial<CurrentUser> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      userId: "1",
      email: `${role.toLowerCase()}@utfpr.edu.br`,
      role,
      status: "ACTIVE",
      name: role === "STUDENT" ? "Aluno" : "Professora",
      mustChangePassword: false,
      sessionCreatedAt: "2026-10-08T00:00:00Z",
      sessionExpiresAt: "2026-10-08T05:00:00Z",
      ...overrides,
    },
    logout,
    refresh: vi.fn(),
  });
}

const renderShell = () =>
  render(
    <AppShell>
      <div>Conteúdo</div>
    </AppShell>,
  );

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders teacher navigation links including students", () => {
    signIn("TEACHER");
    renderShell();

    expect(screen.getByText(messages.classes.title)).toBeDefined();
    expect(screen.getByText(messages.students.title)).toBeDefined();
    expect(screen.getByText(messages.modules.title)).toBeDefined();
    expect(screen.getByText("Conteúdo")).toBeDefined();
  });

  it("does not render teacher-specific links for students", async () => {
    signIn("STUDENT");
    vi.mocked(getStudentProfile).mockResolvedValue({ id: "1", name: "Aluno", academicId: "1234567", email: "a@b.c", createdAt: "" });
    renderShell();

    expect(screen.queryByText(messages.classes.title)).toBeNull();
    expect(screen.queryByText(messages.students.title)).toBeNull();
    expect(screen.queryByText(messages.modules.title)).toBeNull();
    expect(screen.getByText("Conteúdo")).toBeDefined();
    await screen.findByText("RA 1234567");
  });

  // Covers SPEC-015: the bar follows the pattern of the study screen.
  it("shows the logo of the university and the platform at the left", () => {
    signIn("ADMIN");
    renderShell();

    const brand = screen.getByRole("link", { name: `${messages.public.nav.brand} - ${messages.public.nav.institution}` });
    expect(brand.getAttribute("href")).toBe("/app");
    expect(screen.getByRole("img", { name: messages.public.nav.logoAlt }).getAttribute("src")).toContain("utfpr-logo.svg");
  });

  it("shows an administrator by name with the role under it, since there is no academic ID", () => {
    signIn("ADMIN", { name: "Administrador Geral" });
    renderShell();

    expect(screen.getByText("Administrador Geral")).toBeDefined();
    expect(screen.getByText(messages.home.role.ADMIN!)).toBeDefined();
    expect(screen.queryByText(/^RA /)).toBeNull();
    expect(getStudentProfile).not.toHaveBeenCalled();
  });

  it("falls back to the e-mail when the account has no name", () => {
    signIn("TEACHER", { name: undefined, email: "prof@utfpr.edu.br" });
    renderShell();
    expect(screen.getByText("prof@utfpr.edu.br")).toBeDefined();
  });

  it("shows the photo and the academic ID of a student, keeping the name if the profile fails", async () => {
    signIn("STUDENT");
    vi.mocked(getStudentProfile).mockRejectedValue(new Error("boom"));
    renderShell();

    await waitFor(() => expect(getStudentProfile).toHaveBeenCalled());
    expect(screen.getByText("Aluno")).toBeDefined();
    expect(screen.queryByText(/^RA /)).toBeNull();
    expect(screen.getByText(messages.home.role.STUDENT!)).toBeDefined();
  });

  it("keeps the security link and ends the session on Sair", () => {
    signIn("TEACHER");
    renderShell();

    expect(screen.getByRole("link", { name: messages.home.security }).getAttribute("href")).toBe("/app/profile/security");
    fireEvent.click(screen.getByRole("button", { name: messages.auth.logout }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
