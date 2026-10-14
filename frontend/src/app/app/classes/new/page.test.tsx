import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classService } from "@/services/classService";
import { scheduleService } from "@/services/scheduleService";
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

    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalled();
      // SPEC-041 CA-01: after creating, the teacher goes to the students tab of the new class.
      expect(pushMock).toHaveBeenCalledWith("/app/classes/c-1?tab=students&created=1");
    });
  });

  // SPEC-042 CA-01: the weekly meetings typed in the form are saved with the class.
  it("saves the weekly meetings after creating the class", async () => {
    vi.spyOn(classService, "createClass").mockResolvedValueOnce({ id: "c-9" } as never);
    const meetingsSpy = vi.spyOn(scheduleService, "replaceMeetings").mockResolvedValueOnce([]);

    render(<NewClassPage />);
    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), { target: { value: "Turma A" } });
    fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), { target: { value: "SO34E" } });
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), { target: { value: "2026/2" } });
    fireEvent.change(screen.getByLabelText(/Data de Início/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("tab", { name: "Horários" }));
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));

    await waitFor(() => expect(meetingsSpy).toHaveBeenCalledTimes(1));
    expect(meetingsSpy.mock.lastCall?.[0]).toBe("c-9");
    expect(meetingsSpy.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ weekday: 1, startTime: "08:20", endTime: "10:20", lessonCount: 2 }),
    ]);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/c-9?tab=students&created=1"));
  });

  it("does not call the meetings endpoint when there are no meetings", async () => {
    vi.spyOn(classService, "createClass").mockResolvedValueOnce({ id: "c-8" } as never);
    const meetingsSpy = vi.spyOn(scheduleService, "replaceMeetings");

    render(<NewClassPage />);
    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), { target: { value: "Turma B" } });
    fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), { target: { value: "SO34E" } });
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), { target: { value: "2026/2" } });
    fireEvent.change(screen.getByLabelText(/Data de Início/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/c-8?tab=students&created=1"));
    expect(meetingsSpy).not.toHaveBeenCalled();
  });
});
