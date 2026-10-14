import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classService, type ClassGroup } from "@/services/classService";
import { scheduleService, type Meeting } from "@/services/scheduleService";
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

  // SPEC-042: the form of a saved class starts from its meetings and saves them again.
  it("loads the saved meetings into the form and saves the changed ones", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    vi.spyOn(scheduleService, "getMeetings").mockResolvedValueOnce([
      { id: "m-1", classId: "class-123", weekday: 3, startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "IN_PERSON" } as unknown as Meeting,
    ]);
    vi.spyOn(classService, "updateClass").mockResolvedValueOnce(mockClass);
    const meetingsSpy = vi.spyOn(scheduleService, "replaceMeetings").mockResolvedValueOnce([]);

    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");
    expect((screen.getByLabelText("Início (Quarta-feira)") as HTMLInputElement).value).toBe("13:50");

    fireEvent.click(screen.getByText("Salvar Alterações"));

    await waitFor(() => expect(meetingsSpy).toHaveBeenCalledTimes(1));
    expect(meetingsSpy.mock.lastCall?.[0]).toBe("class-123");
    expect(meetingsSpy.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ weekday: 3, startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "IN_PERSON" }),
    ]);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes"));
  });

  // SPEC-044 CA-09: the settings screen shows the calendar of the saved term in the Horários tab.
  it("shows the calendar preview of the saved meetings in the Horários tab", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce({ ...mockClass, startDate: "2026-10-05T03:00:00Z", endDate: "2026-10-31T23:59:59Z" });
    vi.spyOn(scheduleService, "getMeetings").mockResolvedValueOnce([
      { id: "m-1", classId: "class-123", weekday: 1, startTime: "08:20", endTime: "10:20", lessonCount: 2, mode: "IN_PERSON" } as unknown as Meeting,
    ]);

    const { container } = render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");
    fireEvent.click(screen.getByRole("tab", { name: "Horários" }));

    expect(screen.getByRole("region", { name: "Prévia do calendário" })).toBeDefined();
    expect(container.querySelectorAll("[data-marker]").length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('[data-date="2026-10-05"] [data-marker]')?.textContent).toContain("08:20");
  });
});
