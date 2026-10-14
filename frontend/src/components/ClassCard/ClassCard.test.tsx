import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassSummary } from "@/services/classService";
import { ClassCard } from "./ClassCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockClass: ClassSummary = {
  id: "c-1",
  teacherId: "t-1",
  name: "Sistemas Operacionais",
  courseCode: "SO34E",
  semester: "2026/2",
  syllabus: "Processos",
  startDate: "2026-10-01T00:00:00Z",
  endDate: "2026-12-01T00:00:00Z",
  scheduleDescription: "Segunda 08:20",
  enableVirtualClassroom: true,
  enableInviteLink: true,
  inviteLinkToken: "token-abc",
  status: "ACTIVE",
  isExpiringSoon: true,
  totalActiveStudents: 25,
  totalPendingRequests: 3,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

describe("ClassCard", () => {
  it("renders class details, counters and badges", () => {
    render(<ClassCard classGroup={mockClass} />);

    expect(screen.getByText("Sistemas Operacionais")).toBeDefined();
    expect(screen.getByText("SO34E • 2026/2")).toBeDefined();
    expect(screen.getByText("Ativa")).toBeDefined();
    expect(screen.getByText("25")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText(/Link de convite ativo/i)).toBeDefined();
  });

  it("renders expiring alert when isExpiringSoon is true", () => {
    render(<ClassCard classGroup={mockClass} />);

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Esta turma encerra em menos de 15 dias/i)).toBeDefined();
  });

  it("calls onArchive when archive button is clicked", () => {
    const handleArchive = vi.fn();
    render(<ClassCard classGroup={mockClass} onArchive={handleArchive} />);

    const archiveBtn = screen.getByText("Arquivar");
    fireEvent.click(archiveBtn);

    expect(handleArchive).toHaveBeenCalledWith("c-1");
  });

  it("copies invite link to clipboard when button is clicked", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<ClassCard classGroup={mockClass} />);

    const copyBtn = screen.getByTitle("Copiar link");
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
  });

  it("renders draft status and inactive invite link correctly", () => {
    const draftClass: ClassSummary = {
      ...mockClass,
      id: "c-2",
      status: "DRAFT",
      isExpiringSoon: false,
      scheduleDescription: undefined,
      enableInviteLink: false,
      inviteLinkToken: undefined,
      totalPendingRequests: 0,
    };

    render(<ClassCard classGroup={draftClass} />);

    expect(screen.getByText("Rascunho")).toBeDefined();
    expect(screen.getByText(/Link desativado/i)).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders archived status and hides archive button", () => {
    const archivedClass: ClassSummary = {
      ...mockClass,
      id: "c-3",
      status: "ARCHIVED",
      isExpiringSoon: false,
    };

    render(<ClassCard classGroup={archivedClass} onArchive={vi.fn()} />);

    expect(screen.getByText("Arquivada")).toBeDefined();
    expect(screen.queryByText("Arquivar")).toBeNull();
  });

  // SPEC-041 CA-19 and CA-10: the card leads to the class page, shows the summary and offers to add students.
  it("leads to the class page, shows the summary and the action to add students", () => {
    render(<ClassCard classGroup={{ ...mockClass, summary: "Linux na prática, do shell ao kernel." }} />);
    expect(screen.getByRole("link", { name: "Sistemas Operacionais" }).getAttribute("href")).toBe("/app/classes/c-1");
    const summary = screen.getByText("Linux na prática, do shell ao kernel.");
    expect(summary.getAttribute("title")).toBe("Linux na prática, do shell ao kernel.");
    expect(screen.getByRole("link", { name: /Adicionar estudantes/i }).getAttribute("href")).toBe("/app/classes/c-1?tab=students");
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/\/members$/);
    }
  });

  // SPEC-046 CA-01 and CA-02
  it.each(["ACTIVE", "DRAFT", "ARCHIVED"] as const)("has a Visualizar link to the class page, before Configurações (%s)", (status) => {
    render(<ClassCard classGroup={{ ...mockClass, status }} />);
    const view = screen.getByRole("link", { name: /Visualizar/i });
    expect(view.getAttribute("href")).toBe("/app/classes/c-1");
    const settings = screen.getByRole("link", { name: /Configurações/i });
    expect(view.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
