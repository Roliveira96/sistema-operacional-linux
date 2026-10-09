import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { ContentTab } from "./ContentTab";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const block = (id: string, type: string, position: number, payload: Record<string, unknown>, extra: Partial<AuthoredBlock> = {}): AuthoredBlock => ({
  id,
  type,
  position,
  payload,
  edited: false,
  active: true,
  updatedAt: "2026-10-09T12:00:00Z",
  ...extra,
});

// Intro (no title), then "Atualizar" (text, command, tip) and "Segundo" (text only).
const blocks = [
  block("i1", "LEGACY_HTML", 1, { html: "<p>Boas-vindas</p>" }),
  block("h1", "TEXT", 2, { title: "Atualizar", command: "apt update", html: "<p>Texto</p>" }, { edited: true }),
  block("c1", "COMMAND", 3, { steps: [{ command: "apt update" }, { command: "apt upgrade" }] }),
  block("t1", "TIP", 4, { variant: "DEFAULT", title: "LPIC", html: "<p>dica</p>" }),
  block("h2", "TEXT", 5, { title: "Segundo", html: "<p>outro</p>" }),
];

let service: { [K in keyof ContentAuthoringService]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  service = { list: vi.fn(), saveCard: vi.fn(), setCardActive: vi.fn(), reorder: vi.fn(), createEnvironment: vi.fn(), getEnvironment: vi.fn() };
  service.list.mockResolvedValue(blocks);
});

const renderTab = () => render(<ContentTab moduleId="mod-1" service={service as unknown as ContentAuthoringService} />);

/** Opens the action menu of a row and picks an action. */
function choose(n: number, name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Ações do card ${n}` }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

describe("ContentTab", () => {
  it("lists one card per row with its tag, title, summary and marks (CA-25)", async () => {
    renderTab();
    expect(await screen.findByText("Atualizar")).toBeDefined();
    expect(screen.getByText("Introdução")).toBeDefined();
    expect(screen.getByText("apt update")).toBeDefined();
    expect(screen.getByText("2 comandos · 1 dica")).toBeDefined();
    expect(screen.getByText("sem conteúdo")).toBeDefined();
    expect(screen.getByText("editado")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "+ Novo card" }).getAttribute("href")).toBe("/app/modules/mod-1/cards/new");
    expect(screen.getByRole("link", { name: "Criar card depois deste 2" }).getAttribute("href")).toBe("/app/modules/mod-1/cards/new?after=t1");
    expect(screen.getByRole("link", { name: /Ver como o aluno/ }).getAttribute("href")).toBe("/app/modules/mod-1");
  });

  it("shows the empty state and the error state with a retry", async () => {
    service.list.mockResolvedValueOnce([]);
    renderTab();
    expect(await screen.findByText("Este módulo ainda não tem cards. Crie o primeiro.")).toBeDefined();
    cleanup();

    service.list.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(blocks);
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Atualizar")).toBeDefined();
  });

  it("offers See, Edit, Inactivate and Remove in the action menu, with the keyboard too (CA-22)", async () => {
    renderTab();
    await screen.findByText("Atualizar");
    const menu = screen.getByRole("button", { name: "Ações do card 2" });
    fireEvent.click(menu);
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Ver", "Editar", "Inativar", "Remover"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(menu);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the card screen from Edit", async () => {
    renderTab();
    await screen.findByText("Atualizar");
    choose(2, "Editar");
    expect(push).toHaveBeenCalledWith("/app/modules/mod-1/cards/h1");
    choose(1, "Editar");
    expect(push).toHaveBeenLastCalledWith("/app/modules/mod-1/cards/i1");
  });

  it("shows a card as the student sees it, then closes it (CA-23)", async () => {
    renderTab();
    await screen.findByText("Atualizar");
    choose(2, "Ver");
    const viewer = screen.getByText("Como o aluno vê").closest("div")!.parentElement as HTMLElement;
    expect(within(viewer).getByText("apt upgrade")).toBeDefined();
    fireEvent.click(within(viewer).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("Como o aluno vê")).toBeNull();
  });

  it("inactivates every block of the card, then reactivates it (CA-21)", async () => {
    const off = blocks.map((b) => (["h1", "c1", "t1"].includes(b.id) ? { ...b, active: false } : b));
    service.setCardActive.mockResolvedValueOnce(off).mockResolvedValueOnce(blocks);
    renderTab();
    await screen.findByText("Atualizar");

    choose(2, "Inativar");
    await waitFor(() => expect(service.setCardActive).toHaveBeenCalledWith("mod-1", ["h1", "c1", "t1"], false));
    expect(await screen.findByText("inativo")).toBeDefined();
    expect(screen.getByText("Card inativado. Os estudantes não o veem mais.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Ações do card 2" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ativar" }));
    await waitFor(() => expect(service.setCardActive).toHaveBeenLastCalledWith("mod-1", ["h1", "c1", "t1"], true));
    await waitFor(() => expect(screen.queryByText("inativo")).toBeNull());
  });

  it("tells when an action failed", async () => {
    service.setCardActive.mockRejectedValueOnce(new Error("x"));
    renderTab();
    await screen.findByText("Atualizar");
    choose(2, "Inativar");
    expect(await screen.findByText("Não foi possível concluir a ação.")).toBeDefined();
  });

  it("moves a whole card up and down, sending every block in the new order (CA-05)", async () => {
    service.reorder.mockResolvedValue([blocks[4], blocks[0], blocks[1], blocks[2], blocks[3]]);
    renderTab();
    await screen.findByText("Atualizar");
    expect((screen.getByRole("button", { name: "Subir 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Descer 3" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Descer 2" }));
    await waitFor(() => expect(service.reorder).toHaveBeenCalledWith("mod-1", ["i1", "h2", "h1", "c1", "t1"]));
  });

  it("asks before removing a card and removes all its blocks after confirmation (CA-04)", async () => {
    service.saveCard.mockResolvedValue([]);
    renderTab();
    await screen.findByText("Atualizar");

    choose(2, "Remover");
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/progresso de leitura/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(service.saveCard).not.toHaveBeenCalled();

    choose(2, "Remover");
    fireEvent.click(screen.getByRole("button", { name: "Sim, remover" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalledWith("mod-1", { replaceIds: ["h1", "c1", "t1"], blocks: [] }));
    expect(await screen.findByText("Card removido")).toBeDefined();
    await waitFor(() => expect(service.list.mock.calls.length).toBeGreaterThan(1));
  });
});
