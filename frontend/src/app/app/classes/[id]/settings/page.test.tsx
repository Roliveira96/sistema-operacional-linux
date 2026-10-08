import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classService, type ClassGroup } from "@/services/classService";
import ClassSettingsPage from "./page";

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

const mockClass: ClassGroup = {
  id: "class-123",
  teacherId: "teacher-1",
  name: "Sistemas Operacionais",
  courseCode: "SO34E",
  semester: "2026/2",
  syllabus: "Ementa",
  startDate: "2026-10-01T00:00:00Z",
  endDate: "2026-12-01T00:00:00Z",
  enableVirtualClassroom: false,
  enableInviteLink: false,
  status: "ACTIVE",
  isExpiringSoon: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

describe("ClassSettingsPage", () => {
  it("loads class details and submits update", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    const updateSpy = vi.spyOn(classService, "updateClass").mockResolvedValueOnce(mockClass);

    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);

    await waitFor(() => {
      expect(screen.getByText("Configurações da Turma")).toBeDefined();
      expect(screen.getByDisplayValue("Sistemas Operacionais")).toBeDefined();
    });

    const nameInput = screen.getByDisplayValue("Sistemas Operacionais");
    fireEvent.change(nameInput, { target: { value: "SO Prática" } });

    fireEvent.click(screen.getByText("Salvar Alterações"));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("class-123", expect.objectContaining({ name: "SO Prática" }));
      expect(pushMock).toHaveBeenCalledWith("/app/classes");
    });
  });
});
