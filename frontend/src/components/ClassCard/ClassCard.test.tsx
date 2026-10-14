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

  // SPEC-046 CA-01 (its CA-02, the order before Configurações, is replaced by SPEC-047 CA-07)
  it.each(["ACTIVE", "DRAFT", "ARCHIVED"] as const)("has a Visualizar link to the class page (%s)", (status) => {
    render(<ClassCard classGroup={{ ...mockClass, status }} />);
    expect(screen.getByRole("link", { name: /Visualizar/i }).getAttribute("href")).toBe("/app/classes/c-1");
  });

  // SPEC-047 CA-01 and CA-06: Visualizar is the main action and every action follows the pattern of button
  it("puts Visualizar first as the primary button and gives each action its variant", () => {
    render(<ClassCard classGroup={mockClass} onArchive={vi.fn()} />);
    const view = screen.getByRole("link", { name: /Visualizar/i });
    const add = screen.getByRole("link", { name: /Adicionar estudantes/i });
    expect(view.getAttribute("data-variant")).toBe("primary");
    expect(add.getAttribute("data-variant")).toBe("secondary");
    expect(view.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copiar/i }).getAttribute("data-variant")).toBe("secondary");
    expect(screen.getByRole("button", { name: /Copiar/i }).getAttribute("data-size")).toBe("sm");
    expect(screen.getByRole("link", { name: "Configurações" }).getAttribute("data-variant")).toBe("ghost");
    expect(screen.getByRole("button", { name: "Arquivar" }).getAttribute("data-variant")).toBe("ghost");
  });

  // SPEC-047 CA-02: the icon actions keep a name and a tip
  it("gives the icon actions a name and a tip", () => {
    render(<ClassCard classGroup={mockClass} onArchive={vi.fn()} />);
    for (const name of ["Configurações", "Arquivar"]) {
      const action = screen.getByRole(name === "Arquivar" ? "button" : "link", { name });
      expect(action.getAttribute("title")).toBe(name);
      expect(action.getAttribute("data-icon")).toBe("true");
    }
  });

  // SPEC-047 CA-03: the pending requests stand out only when there are some
  it("marks the pending requests only when there are some", () => {
    const { rerender } = render(<ClassCard classGroup={{ ...mockClass, totalPendingRequests: 3 }} />);
    const pending = () => screen.getByRole("link", { name: /Ingressos pendentes/i });
    expect(pending().getAttribute("data-attention")).toBe("true");
    expect(pending().getAttribute("href")).toBe("/app/classes/c-1?tab=students");
    rerender(<ClassCard classGroup={{ ...mockClass, totalPendingRequests: 0 }} />);
    expect(pending().getAttribute("data-attention")).toBeNull();
  });

  // SPEC-047 CA-07: the two main buttons share a line; the icon actions are in the header
  it("keeps Visualizar and Adicionar estudantes in the same row and the icon actions in the header", () => {
    const { container } = render(<ClassCard classGroup={mockClass} onArchive={vi.fn()} />);
    const view = screen.getByRole("link", { name: /Visualizar/i });
    const add = screen.getByRole("link", { name: /Adicionar estudantes/i });
    expect(view.parentElement).toBe(add.parentElement);
    expect(view.parentElement?.parentElement?.tagName).toBe("FOOTER");
    const header = container.querySelector("header");
    expect(header?.contains(screen.getByRole("link", { name: "Configurações" }))).toBe(true);
    expect(header?.contains(screen.getByRole("button", { name: "Arquivar" }))).toBe(true);
    expect(container.querySelector("footer")?.contains(screen.getByRole("link", { name: "Configurações" }))).toBe(false);
  });
});
