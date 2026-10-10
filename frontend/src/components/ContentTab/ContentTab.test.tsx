import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthoredBlock,
  ContentAuthoringService,
} from "@/services/contentAuthoringService";
import { groupCards, parseCard } from "@/lib/cardModel";
import { saveTest } from "@/lib/testRecord";
import { ContentTab } from "./ContentTab";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const block = (
  id: string,
  type: string,
  position: number,
  payload: Record<string, unknown>,
  extra: Partial<AuthoredBlock> = {},
): AuthoredBlock => ({
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
  block(
    "h1",
    "TEXT",
    2,
    { title: "Atualizar", command: "apt update", html: "<p>Texto</p>" },
    { edited: true },
  ),
  block("c1", "COMMAND", 3, {
    steps: [{ command: "apt update" }, { command: "apt upgrade" }],
  }),
  block("t1", "TIP", 4, {
    variant: "DEFAULT",
    title: "LPIC",
    html: "<p>dica</p>",
  }),
  block("h2", "TEXT", 5, { title: "Segundo", html: "<p>outro</p>" }),
];

let service: { [K in keyof ContentAuthoringService]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  localStorage.clear();
  service = {
    list: vi.fn(),
    saveCard: vi.fn(),
    setCardActive: vi.fn(),
    reorder: vi.fn(),
    content: vi.fn(),
    setModuleSetup: vi.fn(),
    versions: vi.fn(),
    publish: vi.fn(),
    restore: vi.fn(),
  };
  service.list.mockResolvedValue(blocks);
});

const renderTab = () =>
  render(
    <ContentTab
      moduleId="mod-1"
      service={service as unknown as ContentAuthoringService}
    />,
  );

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
    expect(screen.getByText("2 comandos")).toBeDefined();
    expect(screen.getByText("1 dica")).toBeDefined();
    expect(screen.getByText("sem conteúdo")).toBeDefined();
    expect(screen.getByText("editado")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.getByRole("link", { name: "+ Novo card" }).getAttribute("href"),
    ).toBe("/app/modules/mod-1/cards/new");
    // Creating a card after this one is an action of its menu.
    expect(
      screen.queryByRole("link", { name: "Criar card depois deste 2" }),
    ).toBeNull();
    choose(2, "Criar card depois deste");
    expect(push).toHaveBeenCalledWith("/app/modules/mod-1/cards/new?after=t1");
    expect(
      screen
        .getByRole("link", { name: /Ver como o aluno/ })
        .getAttribute("href"),
    ).toBe("/app/modules/mod-1");
  });

  it("tells, for each card with commands, whether it was tested and passed", async () => {
    renderTab();
    await screen.findByText("Atualizar");
    // "Atualizar" has commands, "Segundo" and the introduction have nothing to test.
    expect(screen.getByText("não testado")).toBeDefined();
    expect(screen.getAllByTitle(/Resultado do último teste/)).toHaveLength(1);
    cleanup();

    const card = parseCard(groupCards(blocks)[1]!);
    saveTest("mod-1", "h1", true, card);
    renderTab();
    expect(await screen.findByText("Teste OK")).toBeDefined();
    cleanup();

    saveTest("mod-1", "h1", false, card);
    renderTab();
    expect(await screen.findByText("testado: falhou")).toBeDefined();
    cleanup();

    saveTest("mod-1", "h1", true, {
      ...card,
      commands: card.commands.slice(1),
    });
    renderTab();
    expect(await screen.findByText("alterado desde o teste")).toBeDefined();
  });

  it("opens the test of the module from its button and shows whether the module was tested", async () => {
    service.content.mockResolvedValue({ blocks: [], setup: undefined });
    renderTab();
    expect(await screen.findByText("módulo não testado")).toBeDefined();
    // The button that tested only the cards is gone: the test of the module does it first.
    expect(
      screen.queryByRole("button", { name: "Testar todas as atividades" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Testar o módulo" }));
    expect(
      await screen.findByText(
        "Nenhum card tem comandos ou snapshot para testar.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Teste do módulo" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(
      screen.queryByRole("region", { name: "Teste do módulo" }),
    ).toBeNull();
  });

  it("builds the environment of the module inside the content tab, where the tests are", async () => {
    service.content.mockResolvedValue({
      blocks: [],
      setup: { summary: "", steps: [{ command: "mkdir /x" }] },
    });
    service.setModuleSetup.mockResolvedValue({
      summary: "",
      steps: [{ command: "mkdir /y" }],
    });
    renderTab();
    expect(
      await screen.findByText(/Ambiente do módulo \(snapshot\)/),
    ).toBeDefined();
    const input = (await screen.findByLabelText(
      "Comando (1)",
    )) as HTMLInputElement;
    expect(input.value).toBe("mkdir /x");
    fireEvent.change(input, { target: { value: "mkdir /y" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ambiente" }));
    expect(await screen.findByText("Ambiente do módulo salvo.")).toBeDefined();
    expect(service.setModuleSetup).toHaveBeenCalledWith("mod-1", {
      summary: "",
      steps: [{ command: "mkdir /y" }],
    });
  });

  it("shows the empty state and the error state with a retry", async () => {
    service.list.mockResolvedValueOnce([]);
    renderTab();
    expect(
      await screen.findByText(
        "Este módulo ainda não tem cards. Crie o primeiro.",
      ),
    ).toBeDefined();
    cleanup();

    service.list
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce(blocks);
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "Tentar de novo" }),
    );
    expect(await screen.findByText("Atualizar")).toBeDefined();
  });

  it("offers See, Edit, Create after, Inactivate and Remove in the action menu, with the keyboard too (CA-22)", async () => {
    renderTab();
    await screen.findByText("Atualizar");
    const menu = screen.getByRole("button", { name: "Ações do card 2" });
    fireEvent.click(menu);
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(
      ["Ver", "Editar", "Criar card depois deste", "Inativar", "Remover"],
    );
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(menu);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(document.activeElement).toBe(items[4]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[4]);
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

  it("shows a card as the student sees it in a window, from the menu or from a click on the card, then closes it (CA-23)", async () => {
    renderTab();
    await screen.findByText("Atualizar");
    choose(2, "Ver");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Como o aluno vê")).toBeDefined();
    expect(within(dialog).getByText("apt upgrade")).toBeDefined();
    expect(
      within(dialog)
        .getByRole("link", { name: /Editar/ })
        .getAttribute("href"),
    ).toBe("/app/modules/mod-1/cards/h1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // A click on the title opens it too, and Escape closes it.
    fireEvent.click(screen.getByRole("button", { name: "Segundo" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("inactivates every block of the card, then reactivates it (CA-21)", async () => {
    const off = blocks.map((b) =>
      ["h1", "c1", "t1"].includes(b.id) ? { ...b, active: false } : b,
    );
    service.setCardActive
      .mockResolvedValueOnce(off)
      .mockResolvedValueOnce(blocks);
    renderTab();
    await screen.findByText("Atualizar");

    choose(2, "Inativar");
    await waitFor(() =>
      expect(service.setCardActive).toHaveBeenCalledWith(
        "mod-1",
        ["h1", "c1", "t1"],
        false,
      ),
    );
    expect(await screen.findByText("inativo")).toBeDefined();
    expect(
      screen.getByText("Card inativado. Os estudantes não o veem mais."),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Ações do card 2" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ativar" }));
    await waitFor(() =>
      expect(service.setCardActive).toHaveBeenLastCalledWith(
        "mod-1",
        ["h1", "c1", "t1"],
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByText("inativo")).toBeNull());
  });

  it("tells when an action failed", async () => {
    service.setCardActive.mockRejectedValueOnce(new Error("x"));
    renderTab();
    await screen.findByText("Atualizar");
    choose(2, "Inativar");
    expect(
      await screen.findByText("Não foi possível concluir a ação."),
    ).toBeDefined();
  });

  it("moves a whole card up and down, sending every block in the new order (CA-05)", async () => {
    service.reorder.mockResolvedValue([
      blocks[4],
      blocks[0],
      blocks[1],
      blocks[2],
      blocks[3],
    ]);
    renderTab();
    await screen.findByText("Atualizar");
    // The arrows only show in sort mode.
    expect(screen.queryByRole("button", { name: "Subir 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ordenar" }));
    expect(
      (screen.getByRole("button", { name: "Subir 1" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Descer 3" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Descer 2" }));
    await waitFor(() =>
      expect(service.reorder).toHaveBeenCalledWith("mod-1", [
        "i1",
        "h2",
        "h1",
        "c1",
        "t1",
      ]),
    );
  });

  it("drags a card to a new place in sort mode, and leaves sort mode with Concluir ordem", async () => {
    service.reorder.mockResolvedValue(blocks);
    renderTab();
    await screen.findByText("Atualizar");
    expect(screen.queryByRole("img", { name: "Arrastar o card 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ordenar" }));
    expect(
      screen.getByRole("img", { name: "Arrastar o card 1" }),
    ).toBeDefined();
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("draggable") === "true");
    expect(items).toHaveLength(3);
    fireEvent.dragStart(items[0]!);
    fireEvent.dragOver(items[2]!);
    fireEvent.drop(items[2]!);
    await waitFor(() =>
      expect(service.reorder).toHaveBeenCalledWith("mod-1", [
        "h1",
        "c1",
        "t1",
        "h2",
        "i1",
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Concluir ordem" }));
    expect(screen.queryByRole("img", { name: "Arrastar o card 1" })).toBeNull();
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
    await waitFor(() =>
      expect(service.saveCard).toHaveBeenCalledWith("mod-1", {
        replaceIds: ["h1", "c1", "t1"],
        blocks: [],
      }),
    );
    expect(await screen.findByText("Card removido")).toBeDefined();
    await waitFor(() =>
      expect(service.list.mock.calls.length).toBeGreaterThan(1),
    );
  });
});
