import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { scheduleService } from "@/services/scheduleService";
import HolidaysPage from "./page";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

function asRole(role: "ADMIN" | "TEACHER") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}

const national = { id: "h-1", date: "2026-10-12", name: "Nossa Senhora Aparecida", scope: "NATIONAL" as const, active: true };
const recess = { id: "h-2", date: "2026-11-03", name: "Recesso UTFPR", scope: "RECESS" as const, active: true };

beforeEach(() => {
  vi.spyOn(scheduleService, "holidays").mockResolvedValue([national, recess]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-042 RN-11, D-17 and CA-18.
describe("HolidaysPage", () => {
  it("lists the holidays of the year; national ones can only be turned off", async () => {
    asRole("ADMIN");
    const update = vi.spyOn(scheduleService, "updateHoliday").mockResolvedValue({ ...national, active: false });
    render(<HolidaysPage />);
    const row = (await screen.findByText("Nossa Senhora Aparecida")).closest("tr")!;
    expect(within(row).getByText("Nacional")).toBeDefined();
    expect(within(row).queryByRole("button", { name: /Excluir/ })).toBeNull();
    fireEvent.click(within(row).getByRole("checkbox", { name: "Ativo: Nossa Senhora Aparecida" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("h-1", { date: "2026-10-12", name: "Nossa Senhora Aparecida", scope: "NATIONAL", active: false }));
  });

  it("adds a recess, deletes a local holiday and changes the year", async () => {
    asRole("ADMIN");
    const create = vi.spyOn(scheduleService, "createHoliday").mockResolvedValue({ ...recess, id: "h-3", date: "2026-11-04" });
    const remove = vi.spyOn(scheduleService, "deleteHoliday").mockResolvedValue(undefined);
    render(<HolidaysPage />);
    await screen.findByText("Recesso UTFPR");
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-04" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Recesso" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "RECESS" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ date: "2026-11-04", name: "Recesso", scope: "RECESS", active: true }));

    fireEvent.click(screen.getByRole("button", { name: "Excluir Recesso UTFPR" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("h-2"));

    fireEvent.click(screen.getByRole("button", { name: "Próximo ano" }));
    await waitFor(() => expect(scheduleService.holidays).toHaveBeenLastCalledWith(new Date().getFullYear() + 1));
  });

  it("asks for the date and the name", async () => {
    asRole("ADMIN");
    const create = vi.spyOn(scheduleService, "createHoliday");
    render(<HolidaysPage />);
    await screen.findByText("Recesso UTFPR");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByText("Informe a data e o nome.")).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("is only for administrators", () => {
    asRole("TEACHER");
    render(<HolidaysPage />);
    expect(screen.getByText("Acesso restrito aos administradores.")).toBeDefined();
  });
});
