import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classService, type ListClassesResult } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import ClassesPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockListResult: ListClassesResult = {
  items: [
    {
      id: "class-1",
      teacherId: "teacher-1",
      name: "Sistemas Operacionais - Turma A",
      courseCode: "SO34E",
      semester: "2026/2",
      startDate: "2026-10-01T00:00:00Z",
      endDate: "2026-12-01T00:00:00Z",
      enableVirtualClassroom: true,
      enableInviteLink: true,
      inviteLinkToken: "abc-token",
      status: "ACTIVE",
      isExpiringSoon: false,
      totalActiveStudents: 15,
      totalPendingRequests: 2,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    },
  ],
  totalCount: 1,
  page: 1,
  limit: 50,
};

describe("ClassesPage", () => {
  it("renders page header and list of classes", async () => {
    vi.spyOn(classService, "listClasses").mockResolvedValueOnce(mockListResult);

    render(<ClassesPage />);

    expect(screen.getByText("Gestão de Turmas")).toBeDefined();
    expect(screen.getByText("Nova Turma")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Sistemas Operacionais - Turma A")).toBeDefined();
    });
  });

  it("filters classes when tab is changed", async () => {
    const listSpy = vi.spyOn(classService, "listClasses").mockResolvedValue(mockListResult);

    render(<ClassesPage />);

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE" }));
    });

    const draftTab = screen.getByText("Rascunhos");
    fireEvent.click(draftTab);

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "DRAFT" }));
    });
  });

  it("opens archive modal and confirms archiving", async () => {
    vi.spyOn(classService, "listClasses").mockResolvedValue(mockListResult);
    const archiveSpy = vi.spyOn(classService, "archiveClass").mockResolvedValueOnce(mockListResult.items[0]!);

    render(<ClassesPage />);

    await waitFor(() => {
      expect(screen.getByText("Sistemas Operacionais - Turma A")).toBeDefined();
    });

    const archiveBtn = screen.getByText("Arquivar");
    fireEvent.click(archiveBtn);

    expect(screen.getByRole("dialog")).toBeDefined();

    const textarea = screen.getByLabelText(/Justificativa/i);
    fireEvent.change(textarea, { target: { value: "Fim do semestre letivo" } });

    const confirmBtn = screen.getByText("Confirmar Arquivamento");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(archiveSpy).toHaveBeenCalledWith("class-1", "Fim do semestre letivo");
    });
  });

  it("handles search input change and clearing", async () => {
    const listSpy = vi.spyOn(classService, "listClasses").mockResolvedValue(mockListResult);

    render(<ClassesPage />);

    const searchInput = screen.getByPlaceholderText(/Buscar por nome/i);
    fireEvent.change(searchInput, { target: { value: "SO34E" } });

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ search: "SO34E" }));
    });

    const clearBtn = screen.getByLabelText("Limpar busca");
    fireEvent.click(clearBtn);

    expect((searchInput as HTMLInputElement).value).toBe("");
  });

  it("renders empty state when listClasses returns no classes", async () => {
    vi.spyOn(classService, "listClasses").mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      limit: 50,
    });

    render(<ClassesPage />);

    await waitFor(() => {
      expect(screen.getByText("Nenhuma turma encontrada.")).toBeDefined();
    });
  });

  // SPEC-050 CA-06 and CA-07: deleting an archived class of 30 days or more
  const archivedLongAgo: ListClassesResult = {
    ...mockListResult,
    items: [
      {
        ...mockListResult.items[0]!,
        id: "class-9",
        name: "Turma antiga",
        status: "ARCHIVED",
        archivedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  };

  it("opens the delete dialog, deletes and takes the class off the list", async () => {
    const list = vi
      .spyOn(classService, "listClasses")
      .mockResolvedValueOnce(archivedLongAgo)
      .mockResolvedValue({ ...archivedLongAgo, items: [], totalCount: 0 });
    const del = vi.spyOn(classService, "deleteClass").mockResolvedValue(undefined);
    render(<ClassesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    expect(screen.getByRole("dialog", { name: /Excluir turma: Turma antiga/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Excluir turma" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("class-9"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Turma excluída.")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("Turma antiga")).toBeNull());
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("shows the refusal of the server in the dialog and keeps the class", async () => {
    vi.spyOn(classService, "listClasses").mockResolvedValue(archivedLongAgo);
    vi.spyOn(classService, "deleteClass").mockRejectedValue(new ApiProblemError({ type: "class-not-deletable", status: 409 }, 409));
    render(<ClassesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir turma" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Esta turma ainda não pode ser excluída.");
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Turma antiga")).toBeDefined();
  });
});
