import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStudentManual,
  importStudentsCSV,
  listStudents,
} from "@/services/studentService";
import { useStudents } from "./useStudents";

vi.mock("@/services/studentService", () => ({
  listStudents: vi.fn(),
  createStudentManual: vi.fn(),
  importStudentsCSV: vi.fn(),
}));

describe("useStudents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches students list on mount with default pagination", async () => {
    vi.mocked(listStudents).mockResolvedValueOnce({
      items: [
        {
          id: "s-1",
          academicId: "1234567",
          email: "student@utfpr.edu.br",
          name: "Aluno Teste",
          totalClassesEnrolled: 1,
          createdAt: "2026-10-08T00:00:00Z",
        },
      ],
      totalCount: 1,
      page: 1,
      perPage: 10,
    });

    const { result } = renderHook(() => useStudents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.students).toHaveLength(1);
    expect(result.current.students[0]?.academicId).toBe("1234567");
    expect(result.current.totalCount).toBe(1);
    expect(listStudents).toHaveBeenCalledWith({
      page: 1,
      perPage: 10,
      search: undefined,
    });
  });

  it("handles search and page updates", async () => {
    vi.mocked(listStudents).mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      perPage: 10,
    });

    const { result } = renderHook(() => useStudents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setSearch("Silva");
      result.current.setPage(2);
    });

    await waitFor(() => {
      expect(listStudents).toHaveBeenCalledWith({
        page: 2,
        perPage: 10,
        search: "Silva",
      });
    });
  });

  it("handles fetch error gracefully", async () => {
    vi.mocked(listStudents).mockRejectedValueOnce(new Error("Falha na API"));

    const { result } = renderHook(() => useStudents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Falha na API");
    expect(result.current.students).toEqual([]);
  });

  it("calls createStudent and reloads the list", async () => {
    vi.mocked(listStudents).mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      perPage: 10,
    });
    vi.mocked(createStudentManual).mockResolvedValueOnce({
      id: "std-new",
      academicId: "7654321",
      email: "novo@utfpr.edu.br",
      enrollmentStatus: "NOT_ENROLLED",
      createdAt: "2026-10-08T00:00:00Z",
    });

    const { result } = renderHook(() => useStudents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createStudent({
        academicId: "7654321",
        email: "novo@utfpr.edu.br",
      });
    });

    expect(createStudentManual).toHaveBeenCalledWith({
      academicId: "7654321",
      email: "novo@utfpr.edu.br",
    });
    expect(listStudents).toHaveBeenCalledTimes(2);
  });

  it("calls importCSV and reloads the list", async () => {
    vi.mocked(listStudents).mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      perPage: 10,
    });
    vi.mocked(importStudentsCSV).mockResolvedValueOnce({
      totalRows: 2,
      created: 2,
      enrolled: 0,
      alreadyEnrolled: 0,
      errors: [],
    });

    const { result } = renderHook(() => useStudents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const file = new File(["test"], "test.csv");
    await act(async () => {
      await result.current.importCSV(file, "class-1");
    });

    expect(importStudentsCSV).toHaveBeenCalledWith(file, "class-1");
    expect(listStudents).toHaveBeenCalledTimes(2);
  });
});
