import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import { ContentTab } from "./ContentTab";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const block = (id: string, type: string, position: number, payload: Record<string, unknown>, edited = false): AuthoredBlock => ({
  id,
  type,
  position,
  payload,
  edited,
  updatedAt: "2026-10-09T12:00:00Z",
});

const text = block("b-1", "TEXT", 1, { title: "Introdução", html: "<p>Olá</p>" }, true);
const command = block("b-2", "COMMAND", 2, { steps: [{ command: "ls -la", terminal: 1 }, { command: "pwd" }] });

let service: { [K in keyof ContentAuthoringService]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  service = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn() };
  service.list.mockResolvedValue([text, command]);
});

const renderTab = () => render(<ContentTab moduleId="mod-1" service={service as unknown as ContentAuthoringService} />);

describe("ContentTab", () => {
  it("lists every block in order with its type, summary and edited mark (CA-01, CA-20)", async () => {
    renderTab();
    expect(await screen.findByText("Introdução")).toBeDefined();
    expect(screen.getByText("ls -la (+1)")).toBeDefined();
    expect(screen.getByText("editado")).toBeDefined();
    expect(screen.getByRole("link", { name: /Ver como o aluno/ }).getAttribute("href")).toBe("/app/modules/mod-1");
    expect(service.list).toHaveBeenCalledWith("mod-1");
  });

  it("shows the empty state and the error state with a retry", async () => {
    service.list.mockResolvedValueOnce([]);
    renderTab();
    expect(await screen.findByText("Este módulo ainda não tem blocos. Adicione o primeiro.")).toBeDefined();
    cleanup();

    service.list.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce([text]);
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Introdução")).toBeDefined();
  });

  it("edits a block, sends the instant it knew and shows the saved state (CA-03)", async () => {
    service.update.mockImplementation(async (_id: string, payload: Record<string, unknown>) => ({
      ...command,
      payload,
      updatedAt: "2026-10-09T12:05:00Z",
    }));
    renderTab();
    await screen.findByText("Introdução");

    fireEvent.click(screen.getByRole("button", { name: "Editar 2" }));
    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "ls -lah" } });
    expect(screen.getByText("Há alterações não salvas neste bloco.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Salvar bloco" }));

    await waitFor(() => expect(service.update).toHaveBeenCalled());
    const [id, payload, expected, force] = service.update.mock.calls[0] as [string, { steps: { command: string }[] }, string, boolean];
    expect(id).toBe("b-2");
    expect(payload.steps[0]?.command).toBe("ls -lah");
    expect(expected).toBe("2026-10-09T12:00:00Z");
    expect(force).toBe(false);
    expect(await screen.findByText("Bloco salvo")).toBeDefined();
  });

  it("marks the field the server refused (CA-06)", async () => {
    service.update.mockRejectedValue(
      new ApiProblemError({ type: "validation-error", title: "Invalid", invalidParams: [{ name: "steps[0].command", reason: "required" }] }, 400),
    );
    renderTab();
    await screen.findByText("Introdução");
    fireEvent.click(screen.getByRole("button", { name: "Editar 2" }));
    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar bloco" }));
    expect(await screen.findByText("Obrigatório.")).toBeDefined();
  });

  it("offers to reload or to write over after a conflict (CA-09)", async () => {
    service.update.mockRejectedValueOnce(new ApiProblemError({ type: "block-conflict", title: "Conflict" }, 409));
    service.update.mockResolvedValueOnce({ ...command, updatedAt: "2026-10-09T12:09:00Z" });
    renderTab();
    await screen.findByText("Introdução");
    fireEvent.click(screen.getByRole("button", { name: "Editar 2" }));
    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar bloco" }));

    expect(await screen.findByText("Outra pessoa alterou este bloco depois que você o abriu.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Gravar por cima/ }));
    await waitFor(() => expect(service.update).toHaveBeenLastCalledWith("b-2", expect.anything(), "2026-10-09T12:00:00Z", true));

    // Reload starts the editor again from what is stored.
    service.update.mockRejectedValueOnce(new ApiProblemError({ type: "block-conflict", title: "Conflict" }, 409));
    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar bloco" }));
    fireEvent.click(await screen.findByRole("button", { name: "Recarregar o bloco" }));
    await waitFor(() => expect(service.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("creates a block after another one (CA-02)", async () => {
    service.create.mockResolvedValue(block("b-3", "TIP", 2, { variant: "DEFAULT", html: "<p>dica</p>" }));
    renderTab();
    await screen.findByText("Introdução");

    fireEvent.change(screen.getByLabelText("Tipo do novo bloco"), { target: { value: "CURIOSITY" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar bloco depois deste 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Título" }), { target: { value: "Na vida real" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar bloco" }));

    await waitFor(() => expect(service.create).toHaveBeenCalledWith("mod-1", "CURIOSITY", expect.objectContaining({ title: "Na vida real" }), "b-1"));
    expect(await screen.findByText("Bloco criado")).toBeDefined();
    await waitFor(() => expect(service.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("moves a block up and down with the buttons (CA-05, CA-14)", async () => {
    service.reorder.mockResolvedValue([command, text]);
    renderTab();
    await screen.findByText("Introdução");
    expect((screen.getByRole("button", { name: "Subir 1" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Descer 1" }));
    await waitFor(() => expect(service.reorder).toHaveBeenCalledWith("mod-1", ["b-2", "b-1"]));
    await waitFor(() => expect(screen.getAllByRole("listitem")[0]?.textContent).toContain("ls -la"));
  });

  it("asks before removing and removes after confirmation (CA-04)", async () => {
    service.remove.mockResolvedValue(undefined);
    renderTab();
    await screen.findByText("Introdução");

    fireEvent.click(screen.getByRole("button", { name: "Remover 1" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/progresso de leitura/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(service.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remover 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, remover" }));
    await waitFor(() => expect(service.remove).toHaveBeenCalledWith("b-1"));
    expect(await screen.findByText("Bloco removido")).toBeDefined();
  });

  it("warns before leaving the page while a block has unsaved changes (CA-13)", async () => {
    renderTab();
    await screen.findByText("Introdução");
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Editar 2" }));
    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "novo" } });
    expect(leave()).toBe(true);
  });

  it("previews the block the way the student sees it (CA-11)", async () => {
    renderTab();
    await screen.findByText("Introdução");
    fireEvent.click(screen.getByRole("button", { name: "Editar 2" }));
    const preview = screen.getByRole("complementary", { name: "Como o aluno vê" });
    expect(within(preview).getByText("pwd")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Comando (2)"), { target: { value: "whoami" } });
    expect(within(preview).getByText("whoami")).toBeDefined();
  });
});
