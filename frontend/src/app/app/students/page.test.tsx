import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassSummary } from "@/services/classService";
import { listStudents } from "@/services/studentService";
import StudentsPage from "./page";

vi.mock("@/services/studentService", () => ({
  listStudents: vi.fn(),
  createStudentManual: vi.fn(),
  importStudentsCSV: vi.fn(),
}));

vi.mock("@/services/classService", () => ({
  classService: {
    listClasses: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classService.listClasses).mockResolvedValue({
      items: [
        {
          id: "c-1",
          name: "Sistemas Operacionais",
          semester: "2026/2",
        } as unknown as ClassSummary,
      ],
      totalCount: 1,
      page: 1,
      limit: 100,
    });
    vi.mocked(listStudents).mockResolvedValue({
      items: [
        {
          id: "s-1",
          academicId: "1234567",
          email: "student@utfpr.edu.br",
          name: "João Silva",
          totalClassesEnrolled: 1,
          createdAt: "2026-10-08T00:00:00Z",
        },
      ],
      totalCount: 1,
      page: 1,
      perPage: 10,
    });
  });

  it("renders page header and list", async () => {
    render(<StudentsPage />);

    expect(screen.getByText(messages.students.title)).toBeDefined();
    expect(screen.getByText(messages.students.newStudent)).toBeDefined();
    expect(screen.getByText(messages.students.importCsv)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeDefined();
    });
  });

  it("opens manual creation modal on button click", async () => {
    render(<StudentsPage />);

    const newBtn = screen.getByText(messages.students.newStudent);
    fireEvent.click(newBtn);

    expect(screen.getByText(messages.students.form.title)).toBeDefined();
  });

  it("opens CSV import modal on button click", async () => {
    render(<StudentsPage />);

    const importBtn = screen.getByText(messages.students.importCsv);
    fireEvent.click(importBtn);

    expect(screen.getByText(messages.students.importModal.title)).toBeDefined();
  });

  it("updates search input and triggers search query", async () => {
    render(<StudentsPage />);

    const searchInput = screen.getByPlaceholderText(
      messages.students.searchPlaceholder
    );
    fireEvent.change(searchInput, { target: { value: "Maria" } });

    await waitFor(() => {
      expect(listStudents).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Maria" })
      );
    });
  });
});
