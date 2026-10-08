import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classService,
  type ClassGroup,
  type ClassMember,
} from "@/services/classService";
import ClassMembersPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockClass: ClassGroup = {
  id: "class-123",
  teacherId: "teacher-1",
  name: "Sistemas Operacionais",
  courseCode: "SO34E",
  semester: "2026/2",
  startDate: "2026-10-01T00:00:00Z",
  endDate: "2026-12-01T00:00:00Z",
  enableVirtualClassroom: false,
  enableInviteLink: false,
  status: "ACTIVE",
  isExpiringSoon: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

const mockMembers: ClassMember[] = [
  {
    id: "m-1",
    classId: "class-123",
    userId: "u-1",
    userName: "Lucas Teste",
    userEmail: "lucas@utfpr.edu.br",
    userAcademicId: "1234567",
    status: "ACTIVE",
    origin: "DIRECT_BY_TEACHER",
    requestedAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "m-2",
    classId: "class-123",
    userId: "u-2",
    userName: "Beatriz Teste",
    userEmail: "beatriz@utfpr.edu.br",
    userAcademicId: "7654321",
    status: "PENDING_MODERATION",
    origin: "INVITE_LINK",
    requestedAt: "2026-10-05T00:00:00Z",
  },
];

describe("ClassMembersPage", () => {
  it("renders members table and allows moderation approval", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValue(mockClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue(mockMembers);
    const modSpy = vi.spyOn(classService, "moderateMember").mockResolvedValue({ id: "m-2", status: "ACTIVE" });

    render(<ClassMembersPage params={Promise.resolve({ id: "class-123" })} />);

    await waitFor(() => {
      expect(screen.getByText("Lucas Teste")).toBeDefined();
    });

    const pendingTab = screen.getByText("Solicitações Pendentes");
    fireEvent.click(pendingTab);

    await waitFor(() => {
      expect(screen.getByText("Beatriz Teste")).toBeDefined();
    });

    const approveBtn = screen.getByText("Aprovar");
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(modSpy).toHaveBeenCalledWith("class-123", "m-2", true);
      expect(screen.getByText(/Matrícula aprovada com sucesso/i)).toBeDefined();
    });
  });
});
