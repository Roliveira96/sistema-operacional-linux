import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { getStudentProfile } from "@/services/studentService";
import ProfilePage from "./page";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/services/studentService", () => ({
  getStudentProfile: vi.fn(),
  uploadAvatar: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and renders student profile and avatar uploader", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: "s-1",
        name: "Carlos Teste",
        email: "carlos@utfpr.edu.br",
        role: "STUDENT",
        status: "ACTIVE",
        mustChangePassword: false,
        sessionCreatedAt: "2026-10-08T00:00:00Z",
        sessionExpiresAt: "2026-10-08T05:00:00Z",
      },
      logout: vi.fn(),
      refresh: vi.fn(),
    });

    vi.mocked(getStudentProfile).mockResolvedValueOnce({
      id: "s-1",
      name: "Carlos Teste",
      academicId: "1234567",
      email: "carlos@utfpr.edu.br",
      whatsapp: "(42) 99999-8888",
      discord: "carlos#0001",
      avatarUrl: "http://storage/avatar.webp",
      createdAt: "2026-10-08T00:00:00Z",
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(messages.students.profile.title)).toBeDefined();
    });

    expect(screen.getByText("a1234567")).toBeDefined();
    expect(screen.getByText("(42) 99999-8888")).toBeDefined();
    expect(screen.getByText("carlos#0001")).toBeDefined();
    expect(screen.getByText(messages.students.profile.avatarTitle)).toBeDefined();
    expect(getStudentProfile).toHaveBeenCalled();
  });

  it("does not fetch student profile if user is TEACHER", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: "t-1",
        name: "Profa Sediane",
        email: "prof@utfpr.edu.br",
        role: "TEACHER",
        status: "ACTIVE",
        mustChangePassword: false,
        sessionCreatedAt: "2026-10-08T00:00:00Z",
        sessionExpiresAt: "2026-10-08T05:00:00Z",
      },
      logout: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ProfilePage />);

    expect(screen.getByText(messages.students.profile.title)).toBeDefined();
    expect(screen.getByText("Profa Sediane")).toBeDefined();
    expect(getStudentProfile).not.toHaveBeenCalled();
    expect(screen.queryByText(messages.students.profile.avatarTitle)).toBeNull();
  });
});
