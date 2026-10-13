import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";

afterEach(() => cleanup());

// SPEC-042 RN-06 and CA-07.
describe("EventForm", () => {
  it("creates a timed event", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventForm date="2026-10-22" studentCount={3} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Incluir evento" })).toBeDefined();
    expect(screen.getByText("Os 3 estudantes ativos receberão um e-mail.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Palestra: o kernel" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Com uma convidada" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "21:00" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "Auditório" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar evento" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0]).toEqual({
      title: "Palestra: o kernel", description: "Com uma convidada", date: "2026-10-22", allDay: false,
      startTime: "19:00", endTime: "21:00", location: "Auditório", onlineUrl: undefined,
    });
  });

  it("asks for a title, the times and an https link, and allows all-day events", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventForm date="2026-10-22" studentCount={0} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.queryByText(/receberá/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "ftp://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar evento" }));
    expect(await screen.findByText("Informe o título.")).toBeDefined();
    expect(screen.getByText("Informe o início e o fim, ou marque o dia todo.")).toBeDefined();
    expect(screen.getByText("Informe um link https.")).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Visita técnica" } });
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Dia todo"));
    expect(screen.queryByLabelText("Início")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar evento" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0]).toMatchObject({ allDay: true, startTime: undefined, endTime: undefined });
  });

  it("edits and deletes an event", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockRejectedValue(new Error("offline"));
    render(<EventForm event={{ id: "e-1", classId: "c-1", title: "Palestra", description: "", date: "2026-10-22", allDay: true }}
      studentCount={2} onSubmit={onSubmit} onDelete={onDelete} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Editar evento" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar evento" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Excluir evento" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
  });
});
