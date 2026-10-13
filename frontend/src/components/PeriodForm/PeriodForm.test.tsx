import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeriodForm } from "./PeriodForm";

afterEach(() => cleanup());

// SPEC-042 RN-07, D-07 and CA-08.
describe("PeriodForm", () => {
  it("suspends the sessions of the selected days, showing how many change", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const countAffected = vi.fn((first: string, last: string) => (first === "2026-10-19" && last === "2026-10-23" ? 2 : 3));
    render(<PeriodForm firstDay="2026-10-19" lastDay="2026-10-23" countAffected={countAffected} studentCount={2} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Editar período" })).toBeDefined();
    expect(screen.getByText("2 aulas serão alteradas.")).toBeDefined();
    expect(screen.getByText("Os 2 estudantes ativos receberão um e-mail.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Último dia"), { target: { value: "2026-10-30" } });
    expect(screen.getByText("3 aulas serão alteradas.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Rótulo"), { target: { value: "Semana de preparação" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ao período" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0]).toEqual({
      firstDay: "2026-10-19", lastDay: "2026-10-30", action: "NO_CLASSES", label: "Semana de preparação", onlineUrl: undefined,
    });
  });

  it("turns the sessions online with a link, and validates the range and the label", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PeriodForm firstDay="2026-10-19" lastDay="2026-10-19" countAffected={() => 1} studentCount={1} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByText("1 aula será alterada.")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Passar para online"));
    fireEvent.change(screen.getByLabelText("Último dia"), { target: { value: "2026-10-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ao período" }));
    expect(await screen.findByText("O último dia deve ser igual ou depois do primeiro.")).toBeDefined();
    expect(screen.getByText("Informe o rótulo do período.")).toBeDefined();
    expect(screen.getByText("Informe um link https.")).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Último dia"), { target: { value: "2026-10-21" } });
    fireEvent.change(screen.getByLabelText("Rótulo"), { target: { value: "Semana online" } });
    fireEvent.change(screen.getByLabelText("Link da aula"), { target: { value: "https://meet.google.com/xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ao período" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0]).toMatchObject({ action: "ONLINE", onlineUrl: "https://meet.google.com/xyz" });
  });

  it("shows a server error", async () => {
    render(<PeriodForm firstDay="2026-10-19" lastDay="2026-10-23" countAffected={() => 0} studentCount={0}
      onSubmit={vi.fn().mockRejectedValue(new Error("x"))} onClose={vi.fn()} />);
    expect(screen.getByText("Nenhuma aula será alterada.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Rótulo"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ao período" }));
    expect(await screen.findByRole("alert")).toBeDefined();
  });
});
