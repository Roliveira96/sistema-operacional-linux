import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import { AccessTokensSection, mcpConfigSnippet } from "./AccessTokensSection";

afterEach(cleanup);

const future = new Date(Date.now() + 90 * 86400_000).toISOString();
const active = { id: "t1", name: "Notebook", createdAt: "2026-10-01T12:00:00Z", lastUsedAt: "2026-10-05T12:00:00Z", expiresAt: future };
const idle = { id: "t2", name: "Desktop", createdAt: "2026-10-02T12:00:00Z", lastUsedAt: null, expiresAt: future };
const revoked = { id: "t3", name: "Velho", createdAt: "2026-01-01T12:00:00Z", expiresAt: future, revokedAt: "2026-02-01T00:00:00Z" };
const expired = { id: "t4", name: "Vencido", createdAt: "2025-01-01T12:00:00Z", expiresAt: "2025-04-01T00:00:00Z" };

const make = (tokens: unknown[] = [active, idle, revoked, expired]) => ({
  list: vi.fn().mockResolvedValue(tokens),
  create: vi.fn().mockResolvedValue({ id: "t9", name: "Novo", expiresAt: future, token: "llm_secret_value" }),
  revoke: vi.fn().mockResolvedValue(undefined),
});
const view = (service = make(), extra: Partial<Parameters<typeof AccessTokensSection>[0]> = {}) =>
  render(<AccessTokensSection service={service} apiOrigin="https://api.example.com/" copyText={vi.fn().mockResolvedValue(undefined)} confirm={() => true} {...extra} />);

const openForm = async (name = "x") => {
  fireEvent.click(await screen.findByRole("button", { name: "Criar token" }));
  fireEvent.change(screen.getByLabelText("Nome do token"), { target: { value: name } });
};

// Covers SPEC-024 CA-16: the profile lists, creates and revokes tokens, and shows the value only at creation.
describe("AccessTokensSection", () => {
  it("builds the Claude Code configuration with the HTTP transport, the /mcp URL and the Bearer header", () => {
    expect(JSON.parse(mcpConfigSnippet("https://api.example.com/", "tok"))).toEqual({
      mcpServers: { "linux-lab": { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer tok" } } },
    });
  });

  it("lists the tokens with the dates and the status, and never the value", async () => {
    view();
    expect(screen.getByText("Carregando os tokens…")).toBeDefined();
    const table = await screen.findByRole("table", { name: "Tokens de acesso" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent("Notebook");
    expect(rows[1]).toHaveTextContent("Ativo");
    expect(rows[2]).toHaveTextContent("Nunca usado");
    expect(rows[3]).toHaveTextContent("Revogado");
    expect(rows[4]).toHaveTextContent("Expirado");
    // Only the active ones can be revoked.
    expect(screen.getAllByRole("button", { name: /^Revogar o token/ })).toHaveLength(2);
  });

  it("says when there are no tokens", async () => {
    view(make([]));
    expect(await screen.findByText("Você ainda não criou nenhum token.")).toBeDefined();
  });

  it("says when the list cannot be loaded and tries again", async () => {
    const service = make();
    service.list.mockRejectedValueOnce(new Error("x"));
    view(service);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar os tokens.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("table")).toBeDefined();
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it("creates a token and shows the value once, with the copy buttons and the configuration (CA-16)", async () => {
    const service = make([active]);
    const copyText = vi.fn().mockResolvedValue(undefined);
    view(service, { copyText });
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Criar token" }));
    fireEvent.change(screen.getByLabelText("Nome do token"), { target: { value: "  Novo  " } });
    fireEvent.change(screen.getByLabelText("Validade"), { target: { value: "365" } });
    service.list.mockResolvedValue([active, { ...idle, id: "t9", name: "Novo" }]);
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    const region = await screen.findByRole("region", { name: "Token criado" });
    expect(service.create).toHaveBeenCalledWith("Novo", 365);
    expect(within(region).getByLabelText("Valor do token")).toHaveValue("llm_secret_value");
    expect(within(region).getByRole("alert")).toHaveTextContent("não será mostrado de novo");
    expect(region).toHaveTextContent('"url": "https://api.example.com/mcp"');
    expect(region).toHaveTextContent('"Authorization": "Bearer llm_secret_value"');
    expect(region).toHaveTextContent('"type": "http"');

    fireEvent.click(within(region).getByRole("button", { name: "Copiar token" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("llm_secret_value"));
    expect(await screen.findByText("Token copiado.")).toBeDefined();
    fireEvent.click(within(region).getByRole("button", { name: "Copiar configuração" }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith(expect.stringContaining("Bearer llm_secret_value")));
    expect(await screen.findByText("Configuração copiada.")).toBeDefined();

    // The list reloaded, and the value is gone for good once the box is closed.
    expect(screen.getByRole("table")).toHaveTextContent("Novo");
    fireEvent.click(screen.getByRole("button", { name: "Já copiei, fechar" }));
    expect(screen.queryByText(/llm_secret_value/)).toBeNull();
    expect(screen.queryByDisplayValue("llm_secret_value")).toBeNull();
  });

  it("warns when the clipboard is not available", async () => {
    view(make(), { copyText: vi.fn().mockRejectedValue(new Error("denied")) });
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copiar token" }));
    expect(await screen.findByText(/Não foi possível copiar/)).toBeDefined();
  });

  it("asks for a name before creating, and can be cancelled", async () => {
    const service = make();
    view(service);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Criar token" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe um nome");
    expect(service.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Nome do token")).toBeNull();
  });

  it("tells when creating fails and when the server rate limits it", async () => {
    const service = make();
    service.create.mockRejectedValueOnce(new ApiProblemError({ type: "rate-limited", title: "x" }, 429)).mockRejectedValueOnce(new Error("x"));
    view(service);
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    expect(await screen.findByText(/Muitos tokens criados/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    expect(await screen.findByText("Não foi possível criar o token.")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Token criado" })).toBeNull();
  });

  it("keeps the new token on screen even if the list cannot be reloaded", async () => {
    const service = make();
    view(service);
    await openForm();
    service.list.mockRejectedValue(new Error("x"));
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    expect(await screen.findByRole("region", { name: "Token criado" })).toBeDefined();
  });

  it("revokes only after confirming, then reloads the list", async () => {
    const service = make();
    const confirm = vi.fn().mockReturnValue(false);
    view(service, { confirm });
    fireEvent.click(await screen.findByRole("button", { name: "Revogar o token Notebook" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Notebook"));
    expect(service.revoke).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    service.list.mockResolvedValue([idle]);
    fireEvent.click(screen.getByRole("button", { name: "Revogar o token Notebook" }));
    expect(await screen.findByText('Token "Notebook" revogado.')).toBeDefined();
    expect(service.revoke).toHaveBeenCalledWith("t1");
    await waitFor(() => expect(screen.queryByText("Notebook", { selector: "th" })).toBeNull());
  });

  it("tells when revoking fails", async () => {
    const service = make();
    service.revoke.mockRejectedValue(new Error("x"));
    view(service);
    fireEvent.click(await screen.findByRole("button", { name: "Revogar o token Notebook" }));
    expect(await screen.findByText("Não foi possível revogar o token.")).toBeDefined();
  });

  it("uses this page's origin and the system clipboard by default", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<AccessTokensSection service={make([])} />);
    await screen.findByText("Você ainda não criou nenhum token.");
    fireEvent.click(screen.getByRole("button", { name: "Criar token" }));
    fireEvent.change(screen.getByLabelText("Nome do token"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    const region = await screen.findByRole("region", { name: "Token criado" });
    expect(region).toHaveTextContent(`"url": "${window.location.origin}/mcp"`);
    fireEvent.click(within(region).getByRole("button", { name: "Copiar token" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("llm_secret_value"));
  });

  it("uses the default confirmation dialog of the browser", async () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AccessTokensSection service={make()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revogar o token Notebook" }));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
