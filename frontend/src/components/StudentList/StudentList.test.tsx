import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import type { StudentSummary } from "@/services/studentService";
import { StudentList } from "./StudentList";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudentList", () => {
  const sampleStudents: StudentSummary[] = [
    {
      id: "std-1",
      academicId: "1234567",
      name: "Maria Silva",
      email: "maria@alunos.utfpr.edu.br",
      whatsapp: "(42) 99999-1111",
      discord: "maria#1234",
      avatarUrl: "http://storage/avatar1.webp",
      totalClassesEnrolled: 2,
      createdAt: "2026-10-08T10:00:00Z",
    },
    {
      id: "std-2",
      academicId: "7654321",
      name: "",
      email: "semturma@alunos.utfpr.edu.br",
      totalClassesEnrolled: 0,
      createdAt: "2026-10-08T11:00:00Z",
    },
  ];

  it("renders empty state when students list is empty", () => {
    render(
      <StudentList
        students={[]}
        totalCount={0}
        page={1}
        perPage={10}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getByText(messages.students.noStudents)).toBeDefined();
  });

  it("renders loading state", () => {
    render(
      <StudentList
        students={[]}
        totalCount={0}
        page={1}
        perPage={10}
        onPageChange={vi.fn()}
        isLoading={true}
      />
    );

    expect(screen.getByText("Carregando estudantes...")).toBeDefined();
  });

  it("renders students table and badges for students without class", () => {
    render(
      <StudentList
        students={sampleStudents}
        totalCount={2}
        page={1}
        perPage={10}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getByText("a1234567")).toBeDefined();
    expect(screen.getByText("Maria Silva")).toBeDefined();
    expect(screen.getByText("maria@alunos.utfpr.edu.br")).toBeDefined();
    expect(screen.getByText("a7654321")).toBeDefined();
    expect(screen.getByText(messages.students.noClassBadge)).toBeDefined();
  });

  it("handles pagination clicks", () => {
    const onPageChange = vi.fn();
    render(
      <StudentList
        students={sampleStudents}
        totalCount={25}
        page={1}
        perPage={10}
        onPageChange={onPageChange}
      />
    );

    const nextBtn = screen.getByText(
      messages.students.pagination.next
    ) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(2);

    const prevBtn = screen.getByText(
      messages.students.pagination.previous
    ) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });
});
