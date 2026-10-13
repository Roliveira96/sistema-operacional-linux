import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferences } from "./NotificationPreferences";

afterEach(() => cleanup());

// SPEC-042 RN-10 and D-12.
describe("NotificationPreferences", () => {
  it("turns the reminder off and keeps the digest", async () => {
    const load = vi.fn().mockResolvedValue({ sessionReminders: true, weeklyDigest: true });
    const save = vi.fn().mockResolvedValue({ sessionReminders: false, weeklyDigest: true });
    render(<NotificationPreferences load={load} save={save} />);
    const reminder = (await screen.findByLabelText("Lembrete antes de cada aula")) as HTMLInputElement;
    expect(reminder.checked).toBe(true);
    expect(screen.getByText(/Avisos de aula alterada ou cancelada sempre chegam/)).toBeDefined();
    fireEvent.click(reminder);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ sessionReminders: false }));
    expect(await screen.findByText("Preferência salva.")).toBeDefined();
    expect(reminder.checked).toBe(false);
    expect((screen.getByLabelText("Resumo semanal das aulas") as HTMLInputElement).checked).toBe(true);
  });

  it("shows an error and goes back when saving fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    render(<NotificationPreferences load={vi.fn().mockResolvedValue({ sessionReminders: true, weeklyDigest: false })} save={save} />);
    const digest = (await screen.findByLabelText("Resumo semanal das aulas")) as HTMLInputElement;
    fireEvent.click(digest);
    expect(await screen.findByText("Não foi possível salvar. Tente de novo.")).toBeDefined();
    expect(digest.checked).toBe(false);
  });
});
