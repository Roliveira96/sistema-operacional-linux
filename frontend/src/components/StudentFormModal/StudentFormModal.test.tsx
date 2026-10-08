import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { createStudentManual } from "@/services/studentService";
import { StudentFormModal } from "./StudentFormModal";

vi.mock("@/services/studentService", () => ({
  createStudentManual: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudentFormModal", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    availableClasses: [
      { id: "c-1", name: "SO - 2026/2" },
      { id: "c-2", name: "Redes - 2026/2" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(<StudentFormModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders form and warning when no class is selected (CA-01)", () => {
    render(<StudentFormModal {...defaultProps} />);
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText(messages.students.noClassWarning)).toBeDefined();
  });

  it("validates RA format before submitting", async () => {
    render(<StudentFormModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(messages.students.form.academicId), {
      target: { value: "123" }, // only 3 digits
    });
    fireEvent.change(screen.getByLabelText(messages.students.form.email), {
      target: { value: "test@utfpr.edu.br" },
    });

    fireEvent.click(screen.getByRole("button", { name: messages.students.form.submit }));

    await waitFor(() => {
      expect(screen.getByText(messages.auth.errors.invalidAcademicId)).toBeDefined();
    });
    expect(createStudentManual).not.toHaveBeenCalled();
  });

  it("normalizes RA with prefix 'a' and submits successfully (CA-01, CA-02)", async () => {
    vi.mocked(createStudentManual).mockResolvedValueOnce({
      id: "std-1",
      academicId: "1234567",
      email: "test@utfpr.edu.br",
      enrollmentStatus: "NOT_ENROLLED",
      createdAt: "2026-10-08T00:00:00Z",
    });

    render(<StudentFormModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(messages.students.form.academicId), {
      target: { value: "a1234567" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.form.email), {
      target: { value: "test@utfpr.edu.br" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.form.name), {
      target: { value: "João da Silva" },
    });

    fireEvent.click(screen.getByRole("button", { name: messages.students.form.submit }));

    await waitFor(() => {
      expect(createStudentManual).toHaveBeenCalledWith({
        academicId: "1234567",
        email: "test@utfpr.edu.br",
        name: "João da Silva",
        whatsapp: undefined,
        discord: undefined,
        classGroupId: undefined,
      });
    });

    expect(defaultProps.onSuccess).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("displays conflict error when email already exists (CA-03)", async () => {
    vi.mocked(createStudentManual).mockRejectedValueOnce(
      new Error("conflict: user with email already exists")
    );

    render(<StudentFormModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(messages.students.form.academicId), {
      target: { value: "1234567" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.form.email), {
      target: { value: "dup@utfpr.edu.br" },
    });

    fireEvent.click(screen.getByRole("button", { name: messages.students.form.submit }));

    await waitFor(() => {
      expect(screen.getByText(messages.students.form.conflictEmail)).toBeDefined();
    });
  });

  it("displays conflict error when academicId already exists (CA-03)", async () => {
    vi.mocked(createStudentManual).mockRejectedValueOnce(
      new Error("conflict: student profile with academic_id already exists")
    );

    render(<StudentFormModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(messages.students.form.academicId), {
      target: { value: "1234567" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.form.email), {
      target: { value: "unique@utfpr.edu.br" },
    });

    fireEvent.click(screen.getByRole("button", { name: messages.students.form.submit }));

    await waitFor(() => {
      expect(screen.getByText(messages.students.form.conflictAcademicId)).toBeDefined();
    });
  });

  it("calls onClose when cancel button is clicked", () => {
    render(<StudentFormModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: messages.students.form.cancel }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
