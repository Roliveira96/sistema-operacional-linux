import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { scheduleService } from "@/services/scheduleService";
import { octoberCalendar } from "@/test/scheduleFixtures";
import CalendarPage from "./page";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

function asRole(role: "ADMIN" | "TEACHER" | "STUDENT") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-042 D-05 and CA-12: the general calendar of the user.
describe("CalendarPage", () => {
  it("shows the classes of the teacher with the class filter and a link to each agenda", async () => {
    asRole("TEACHER");
    const myCalendar = vi.spyOn(scheduleService, "myCalendar").mockResolvedValue(octoberCalendar());
    render(<CalendarPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Calendário" })).toBeDefined();
    expect(await screen.findByLabelText("Turma")).toBeDefined();
    expect(myCalendar).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /19 de outubro/ }));
    expect(screen.getByRole("link", { name: "Abrir a agenda de Sistemas Operacionais" }).getAttribute("href")).toBe("/app/classes/c-1?tab=schedule");
    expect(screen.queryByRole("button", { name: "Alterar esta aula" })).toBeNull();
  });

  it("is read-only for a student", async () => {
    asRole("STUDENT");
    vi.spyOn(scheduleService, "myCalendar").mockResolvedValue(octoberCalendar());
    render(<CalendarPage />);
    fireEvent.click(await screen.findByRole("button", { name: /19 de outubro/ }));
    expect(screen.queryByRole("button", { name: "Selecionar período" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Incluir evento" })).toBeNull();
  });

  // Holidays moved into the calendar screen (ajustes gerais): only the administrator reaches them, from here.
  it("shows the holidays link to an administrator, pointing to /app/admin/holidays", () => {
    asRole("ADMIN");
    vi.spyOn(scheduleService, "myCalendar").mockResolvedValue(octoberCalendar());
    render(<CalendarPage />);
    expect(screen.getByRole("link", { name: messages.schedule.holidays.nav }).getAttribute("href")).toBe("/app/admin/holidays");
  });

  it.each(["TEACHER", "STUDENT"] as const)("does not show the holidays link to a %s", (role) => {
    asRole(role);
    vi.spyOn(scheduleService, "myCalendar").mockResolvedValue(octoberCalendar());
    render(<CalendarPage />);
    expect(screen.queryByRole("link", { name: messages.schedule.holidays.nav })).toBeNull();
  });
});
