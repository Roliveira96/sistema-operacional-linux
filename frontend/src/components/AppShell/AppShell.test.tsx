import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { AppShell } from "./AppShell";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders teacher navigation links including students", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: "1",
        email: "prof@utfpr.edu.br",
        role: "TEACHER",
        status: "ACTIVE",
        name: "Professora",
        mustChangePassword: false,
        sessionCreatedAt: "2026-10-08T00:00:00Z",
        sessionExpiresAt: "2026-10-08T05:00:00Z",
      },
      logout: vi.fn(),
      refresh: vi.fn(),
    });

    render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>
    );

    expect(screen.getByText(messages.classes.title)).toBeDefined();
    expect(screen.getByText(messages.students.title)).toBeDefined();
    expect(screen.getByText(messages.modules.title)).toBeDefined();
    expect(screen.getByText("Conteúdo")).toBeDefined();
  });

  it("does not render teacher-specific links for students", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: "2",
        email: "aluno@utfpr.edu.br",
        role: "STUDENT",
        status: "ACTIVE",
        name: "Aluno",
        mustChangePassword: false,
        sessionCreatedAt: "2026-10-08T00:00:00Z",
        sessionExpiresAt: "2026-10-08T05:00:00Z",
      },
      logout: vi.fn(),
      refresh: vi.fn(),
    });

    render(
      <AppShell>
        <div>Conteúdo Discente</div>
      </AppShell>
    );

    expect(screen.queryByText(messages.classes.title)).toBeNull();
    expect(screen.queryByText(messages.students.title)).toBeNull();
    expect(screen.queryByText(messages.modules.title)).toBeNull();
    expect(screen.getByText("Conteúdo Discente")).toBeDefined();
  });
});
