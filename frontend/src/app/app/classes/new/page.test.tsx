import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classService } from "@/services/classService";
import NewClassPage from "./page";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewClassPage", () => {
  it("renders new class form and submits", async () => {
    const createSpy = vi.spyOn(classService, "createClass").mockResolvedValueOnce({
      id: "c-1",
      teacherId: "t-1",
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
    });

    render(<NewClassPage />);

    expect(screen.getByText("Criar Nova Turma")).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), {
      target: { value: "Sistemas Operacionais" },
    });
    fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), {
      target: { value: "SO34E" },
    });
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), {
      target: { value: "2026/2" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Início/i), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), {
      target: { value: "2026-12-01" },
    });

    fireEvent.click(screen.getByText("Criar Turma"));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalledWith("/app/classes");
    });
  });
});
