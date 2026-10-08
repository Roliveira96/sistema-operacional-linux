import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { importStudentsCSV } from "@/services/studentService";
import { StudentImportCsvModal } from "./StudentImportCsvModal";

vi.mock("@/services/studentService", () => ({
  importStudentsCSV: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudentImportCsvModal", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    availableClasses: [{ id: "c-1", name: "SO - 2026/2" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(<StudentImportCsvModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("validates file extension and rejects non-csv files", () => {
    render(<StudentImportCsvModal {...defaultProps} />);

    const file = new File(["test"], "documento.pdf", { type: "application/pdf" });
    const input = screen.getByRole("button", {
      name: (text) => text.includes("Arraste"),
    }).querySelector("input[type='file']") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    expect(
      screen.getByText(messages.students.importModal.invalidFileType)
    ).toBeDefined();
  });

  it("supports drag and drop interactions and file selection", () => {
    render(<StudentImportCsvModal {...defaultProps} />);

    const dropArea = screen.getByRole("button", {
      name: (text) => text.includes("Arraste"),
    });

    fireEvent.dragOver(dropArea);
    fireEvent.dragLeave(dropArea);

    const csvFile = new File(["email,academic_id\na@b.com,1234567"], "turma.csv", {
      type: "text/csv",
    });

    fireEvent.drop(dropArea, {
      dataTransfer: { files: [csvFile] },
    });

    expect(
      screen.getByText(messages.students.importModal.selectedFile("turma.csv"))
    ).toBeDefined();

    // Trigger keydown Enter
    fireEvent.keyDown(dropArea, { key: "Enter" });
  });

  it("handles cancel button and close x button", () => {
    render(<StudentImportCsvModal {...defaultProps} />);

    const cancelBtn = screen.getByRole("button", {
      name: messages.students.importModal.cancel,
    });
    fireEvent.click(cancelBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();

    const closeXBtn = screen.getByRole("button", { name: "Fechar janela" });
    fireEvent.click(closeXBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(2);
  });

  it("displays error message if import service fails", async () => {
    vi.mocked(importStudentsCSV).mockRejectedValueOnce(
      new Error("Erro de infraestrutura no servidor")
    );

    render(<StudentImportCsvModal {...defaultProps} />);

    const csvFile = new File(["email,academic_id\na@b.com,1234567"], "dados.csv", {
      type: "text/csv",
    });
    const input = screen.getByRole("button", {
      name: (text) => text.includes("Arraste"),
    }).querySelector("input[type='file']") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [csvFile] } });

    const submitBtn = screen.getByRole("button", {
      name: messages.students.importModal.submit,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Erro de infraestrutura no servidor")
      ).toBeDefined();
    });
  });

  it("processes CSV upload and displays detailed summary report with errors (CA-04, CA-05, CA-06)", async () => {
    vi.mocked(importStudentsCSV).mockResolvedValueOnce({
      totalRows: 5,
      created: 3,
      enrolled: 4,
      alreadyEnrolled: 1,
      errors: [
        { line: 3, reason: "RA inválido: deve conter 7 dígitos" },
        { line: 5, reason: "email ausente" },
      ],
    });

    render(<StudentImportCsvModal {...defaultProps} />);

    const select = screen.getByLabelText(
      messages.students.importModal.classGroupLabel
    );
    fireEvent.change(select, { target: { value: "c-1" } });

    const csvFile = new File(
      ["email,academic_id\na@b.com,1234567\nc@d.com,7654321"],
      "turma.csv",
      { type: "text/csv" }
    );

    const input = screen.getByRole("button", {
      name: (text) => text.includes("Arraste"),
    }).querySelector("input[type='file']") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [csvFile] } });

    const submitBtn = screen.getByRole("button", {
      name: messages.students.importModal.submit,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(importStudentsCSV).toHaveBeenCalledWith(csvFile, "c-1");
    });

    expect(
      screen.getByText(messages.students.importModal.successSummary)
    ).toBeDefined();
    expect(screen.getByText("5")).toBeDefined(); // totalRows
    expect(screen.getByText("3")).toBeDefined(); // created
    expect(screen.getByText("4")).toBeDefined(); // enrolled
    expect(screen.getByText("1")).toBeDefined(); // alreadyEnrolled

    expect(
      screen.getByText(
        messages.students.importModal.report.errorLine(
          3,
          "RA inválido: deve conter 7 dígitos"
        )
      )
    ).toBeDefined();

    expect(
      screen.getByText(
        messages.students.importModal.report.errorLine(5, "email ausente")
      )
    ).toBeDefined();

    expect(defaultProps.onSuccess).toHaveBeenCalled();

    // Close button appears in report mode
    const closeBtn = screen.getByRole("button", {
      name: messages.students.importModal.close,
    });
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
