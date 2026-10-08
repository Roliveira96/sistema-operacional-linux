import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassMember } from "@/services/classService";
import { ClassMembersTable } from "./ClassMembersTable";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockMembers: ClassMember[] = [
  {
    id: "m-1",
    classId: "c-1",
    userId: "u-1",
    userName: "João da Silva",
    userEmail: "joao@utfpr.edu.br",
    userAcademicId: "2345678",
    status: "ACTIVE",
    origin: "DIRECT_BY_TEACHER",
    requestedAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "m-2",
    classId: "c-1",
    userId: "u-2",
    userName: "Maria Santos",
    userEmail: "maria@utfpr.edu.br",
    userAcademicId: "8765432",
    status: "PENDING_MODERATION",
    origin: "INVITE_LINK",
    requestedAt: "2026-10-05T00:00:00Z",
  },
];

describe("ClassMembersTable", () => {
  it("renders active members when ACTIVE tab is selected", () => {
    render(
      <ClassMembersTable
        members={mockMembers}
        activeTab="ACTIVE"
        onTabChange={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText("João da Silva")).toBeDefined();
    expect(screen.getByText("2345678")).toBeDefined();
    expect(screen.getByText("Inscrição Direta")).toBeDefined();
    expect(screen.queryByText("Maria Santos")).toBeNull();
  });

  it("renders pending requests with approve and reject buttons when PENDING tab is selected", () => {
    const handleApprove = vi.fn().mockResolvedValue(undefined);
    const handleReject = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "prompt").mockReturnValue("Motivo qualquer");

    render(
      <ClassMembersTable
        members={mockMembers}
        activeTab="PENDING_MODERATION"
        onTabChange={vi.fn()}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    );

    expect(screen.getByText("Maria Santos")).toBeDefined();
    expect(screen.getByText("Link de Convite")).toBeDefined();

    const approveBtn = screen.getByText("Aprovar");
    fireEvent.click(approveBtn);
    expect(handleApprove).toHaveBeenCalledWith("m-2");

    const rejectBtn = screen.getByText("Rejeitar");
    fireEvent.click(rejectBtn);
    expect(handleReject).toHaveBeenCalledWith("m-2", "Motivo qualquer");
  });

  it("calls onTabChange when tab button is clicked", () => {
    const handleTabChange = vi.fn();

    render(
      <ClassMembersTable
        members={mockMembers}
        activeTab="ACTIVE"
        onTabChange={handleTabChange}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    const pendingTab = screen.getByText("Solicitações Pendentes");
    fireEvent.click(pendingTab);

    expect(handleTabChange).toHaveBeenCalledWith("PENDING_MODERATION");
  });

  it("renders empty state message when list is empty", () => {
    render(
      <ClassMembersTable
        members={[]}
        activeTab="ACTIVE"
        onTabChange={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText(/Nenhum aluno matriculado nesta turma/i)).toBeDefined();
  });
});
