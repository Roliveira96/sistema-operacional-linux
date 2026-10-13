import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/test/scheduleFixtures";
import { SessionForm } from "./SessionForm";

afterEach(() => cleanup());

// SPEC-042, section 3.1.3 (CA-05, CA-06, CA-07).
describe("SessionForm", () => {
  it("changes a session to online with a reason, telling who gets the e-mail", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm mode="edit" session={session({ id: "s-21", date: "2026-10-21" })} studentCount={2} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Alterar a aula de 21/10/2026" })).toBeDefined();
    expect(screen.getByText("Os 2 estudantes ativos receberão um e-mail.")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Online"));
    fireEvent.change(screen.getByLabelText("Link da aula"), { target: { value: "https://meet.google.com/abc" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Aula online hoje" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alteração" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0]).toEqual({
      status: "SCHEDULED", startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "ONLINE",
      room: undefined, onlineUrl: "https://meet.google.com/abc", reason: "Aula online hoje",
    });
  });

  it("asks for the reason to cancel, a valid link and an end after the start", async () => {
    const onSubmit = vi.fn();
    render(<SessionForm mode="edit" session={session({ id: "s-19", date: "2026-10-19" })} studentCount={1} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByText("O estudante ativo receberá um e-mail.")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Cancelada"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alteração" }));
    expect(await screen.findByText("Informe o motivo do cancelamento.")).toBeDefined();
    expect(document.activeElement).toBe(screen.getByLabelText("Motivo"));

    fireEvent.click(screen.getByLabelText("Mantida"));
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByLabelText("Online"));
    fireEvent.change(screen.getByLabelText("Link da aula"), { target: { value: "meet" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alteração" }));
    expect(await screen.findByText("O fim deve ser depois do início.")).toBeDefined();
    expect(screen.getByText("Informe um link https.")).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("undoes a change and shows a server error", async () => {
    const onRevert = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockRejectedValue(new Error("offline"));
    render(<SessionForm mode="edit" session={session({ id: "s-19", date: "2026-10-19", overridden: true, changeReason: "Recesso" })}
      studentCount={2} onSubmit={onSubmit} onRevert={onRevert} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Motivo") as HTMLTextAreaElement).value).toBe("Recesso");
    fireEvent.click(screen.getByRole("button", { name: "Salvar alteração" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer alteração" }));
    await waitFor(() => expect(onRevert).toHaveBeenCalled());
  });

  it("adds an extra session on a date and deletes an extra session", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { unmount } = render(<SessionForm mode="extra" date="2026-10-24" studentCount={2} onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Incluir aula avulsa" })).toBeDefined();
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe("2026-10-24");
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "11:40" } });
    expect((screen.getByLabelText("Quantidade de aulas") as HTMLInputElement).value).toBe("4");
    fireEvent.change(screen.getByLabelText("Sala"), { target: { value: "Lab 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir aula" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0]).toMatchObject({ date: "2026-10-24", startTime: "08:20", endTime: "11:40", lessonCount: 4, room: "Lab 3", mode: "IN_PERSON" });
    expect(screen.queryByLabelText("Cancelada")).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    unmount();

    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm mode="edit" session={session({ id: "s-24", date: "2026-10-24", origin: "EXTRA", meetingId: undefined })}
      studentCount={2} onSubmit={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Excluir aula avulsa" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
  });
});
