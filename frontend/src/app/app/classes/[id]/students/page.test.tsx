import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import {
  classService,
  type ClassGroup,
  type ClassMember,
} from "@/services/classService";
import ClassStudentsPage from "./page";

vi.mock("@/services/classService", () => ({
  classService: {
    getClass: vi.fn(),
    listMembers: vi.fn(),
    moderateMember: vi.fn(),
  },
}));

vi.mock("@/services/studentService", () => ({
  importStudentsCSV: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClassStudentsPage", () => {
  const mockClass = {
    id: "class-123",
    name: "Sistemas Operacionais",
    courseCode: "SO34E",
    semester: "2026/2",
  };

  const mockMembers = [
    {
      id: "mem-1",
      classId: "class-123",
      userId: "u-1",
      userName: "Aluno Ativo",
      userEmail: "ativo@utfpr.edu.br",
      userAcademicId: "1234567",
      status: "ACTIVE",
      origin: "DIRECT_BY_TEACHER",
      requestedAt: "2026-10-01T00:00:00Z",
    },
    {
      id: "mem-2",
      classId: "class-123",
      userId: "u-2",
      userName: "Aluno Pendente",
      userEmail: "pendente@utfpr.edu.br",
      userAcademicId: "7654321",
      status: "PENDING_MODERATION",
      origin: "INVITE_LINK",
      requestedAt: "2026-10-02T00:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classService.getClass).mockResolvedValue(
      mockClass as unknown as ClassGroup
    );
    vi.mocked(classService.listMembers).mockResolvedValue(
      mockMembers as unknown as ClassMember[]
    );
    vi.mocked(classService.moderateMember).mockResolvedValue({
      id: "mem-2",
      status: "ACTIVE",
    });
  });

  it("renders class details and active members table", async () => {
    render(<ClassStudentsPage params={Promise.resolve({ id: "class-123" })} />);

    await waitFor(() => {
      expect(screen.getByText("Sistemas Operacionais")).toBeDefined();
    });

    expect(screen.getByText("Aluno Ativo")).toBeDefined();
  });

  it("moderates pending student by approving (CA-09)", async () => {
    render(<ClassStudentsPage params={Promise.resolve({ id: "class-123" })} />);

    await waitFor(() => {
      expect(screen.getByText("Sistemas Operacionais")).toBeDefined();
    });

    // Switch to pending moderation tab
    const pendingTab = screen.getByText(messages.classes.members.pendingTab);
    fireEvent.click(pendingTab);

    expect(screen.getByText("Aluno Pendente")).toBeDefined();

    // Click approve
    const approveBtn = screen.getByText(messages.classes.members.approveButton);
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(classService.moderateMember).toHaveBeenCalledWith(
        "class-123",
        "mem-2",
        true
      );
    });
  });
});
