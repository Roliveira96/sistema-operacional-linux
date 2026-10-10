import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupCards } from "@/lib/cardModel";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { CardBuilder } from "./CardBuilder";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
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

const block = (id: string, type: string, position: number, payload: Record<string, unknown>): AuthoredBlock => ({ id, type, position, payload, edited: false, active: true, updatedAt: `2026-10-10T12:00:0${position}Z` });

let service: { [K in keyof ContentAuthoringService]: ReturnType<typeof vi.fn> };
beforeEach(() => {
  service = { list: vi.fn(), content: vi.fn(), setModuleSetup: vi.fn(), versions: vi.fn(), publish: vi.fn(), restore: vi.fn(), saveCard: vi.fn(), setCardActive: vi.fn(), reorder: vi.fn() };
});

const renderBuilder = (props: Partial<React.ComponentProps<typeof CardBuilder>> = {}) =>
  render(<CardBuilder moduleId="mod-1" service={service as unknown as ContentAuthoringService} onCancel={vi.fn()} onCreated={vi.fn()} practice={{ topicScenario: vi.fn().mockResolvedValue(null) } as never} {...props} />);

const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name: new RegExp(name) }));
const savedBlocks = () => (service.saveCard.mock.calls[0]![1] as { blocks: { type: string; payload: Record<string, unknown> }[] }).blocks;
const tree = (...folders: string[]) => ({
  raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: folders.map((nome) => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] })) },
  contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
});

const withExercises = (items: unknown[] = [{ title: "Criar a pasta", difficulty: "EASY", hints: [{ text: "a" }, { text: "b" }], solution: { steps: [{ command: "mkdir /srv" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/srv" }] }, { title: "Listar", difficulty: "HARD" }], extra: Record<string, unknown> = {}) =>
  groupCards([block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>" }), block("e", "EXERCISES", 2, { items, ...extra })])[0]!;

// Covers SPEC-022: the tab of the exercises of the card. Each exercise has a page of its own (ExerciseScreen).
describe("CardBuilder, the tab of the exercises", () => {
  it("has the snapshot of the group and the list of exercises", () => {
    renderBuilder();
    openTab("Exercícios");
    expect(screen.getByRole("heading", { name: "Snapshot do grupo de exercícios (opcional)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Gravar o snapshot do grupo no terminal" })).toBeDefined();
    expect(screen.getByText("Nenhum exercício ainda. Adicione o primeiro.")).toBeDefined();
  });

  it("asks to save a card that was never saved before its exercises can be created on their pages", () => {
    renderBuilder();
    openTab("Exercícios");
    expect(screen.getByText(/Salve o card uma vez para criar os exercícios/)).toBeDefined();
    expect(screen.queryByRole("link", { name: "+ Adicionar exercício" })).toBeNull();
  });

  it("lists the exercises with their level and what they have, and opens each on its page", () => {
    renderBuilder({ group: withExercises() });
    openTab("Exercícios");
    const list = screen.getByRole("list", { name: "Exercícios" });
    expect(list).toHaveTextContent("Criar a pasta");
    expect(list).toHaveTextContent("Fácil · 2 dicas · com solução · 1 condição");
    expect(list).toHaveTextContent("Difícil · 0 dicas · sem solução · 0 condições");
    expect(screen.getByRole("link", { name: "Abrir o exercício Criar a pasta" }).getAttribute("href")).toBe("/app/modules/mod-1/cards/h/exercises/0");
    expect(screen.getByRole("link", { name: "Abrir o exercício Listar" }).getAttribute("href")).toBe("/app/modules/mod-1/cards/h/exercises/1");
    expect(screen.getByRole("link", { name: "+ Adicionar exercício" }).getAttribute("href")).toBe("/app/modules/mod-1/cards/h/exercises/new");
  });

  it("does not open a page while the card has changes that are not saved, because the page would not see them", () => {
    renderBuilder({ group: withExercises() });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Outro" } });
    openTab("Exercícios");
    expect(screen.getByText(/Salve o card para abrir a página de um exercício/)).toBeDefined();
    expect(screen.queryByRole("link", { name: /Abrir o exercício/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "+ Adicionar exercício" })).toBeNull();
  });

  it("moves and removes exercises in the list, and saves the order with the card", async () => {
    service.saveCard.mockResolvedValue([]);
    renderBuilder({ group: withExercises() });
    openTab("Exercícios");
    fireEvent.click(screen.getAllByRole("button", { name: /^Descer/ })[0]!);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent).join("|")).toMatch(/Listar.*Criar a pasta/);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remover/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const items = savedBlocks().find((b) => b.type === "EXERCISES")!.payload.items as { title: string }[];
    expect(items.map((i) => i.title)).toEqual(["Criar a pasta"]);
  });

  it("opens the tab that has the error when saving fails, and says which tab it is", async () => {
    renderBuilder({ group: withExercises([{ title: "", difficulty: "EASY" }]) });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Outro" } });
    openTab("Descrição");
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    expect(await screen.findByText("Corrija os campos marcados na aba Exercícios antes de salvar.")).toBeDefined();
    expect(screen.getByRole("tab", { name: /Exercícios/ }).getAttribute("aria-selected")).toBe("true");
    expect(service.saveCard).not.toHaveBeenCalled();
  });

  it("starts on the tab it is given, as the page of an exercise goes back to the exercises", () => {
    renderBuilder({ group: withExercises(), initialTab: "exercises" });
    expect(screen.getByRole("tab", { name: /Exercícios/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("records the snapshot of the group on the machine of the module and of the card", async () => {
    const win = { execute: vi.fn(async () => ({ status: 0, output: "" })), setSpeed: vi.fn(), history: () => [], snapshot: vi.fn(() => tree()), destroy: vi.fn() };
    mount.mockResolvedValue(win);
    const before = [{ id: "module", kind: "module" as const, label: "Módulo", setup: { summary: "", steps: [{ command: "mkdir /modulo" }] } }];
    const group = groupCards([block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { steps: [{ command: "mkdir /card" }] } })])[0]!;
    renderBuilder({ group, before });
    openTab("Exercícios");
    fireEvent.click(screen.getByRole("button", { name: "Gravar o snapshot do grupo no terminal" }));
    await waitFor(() => expect(win.execute.mock.calls.map((c) => (c as unknown as [{ command: string }])[0].command)).toEqual(["mkdir /modulo", "mkdir /card"]));
  });

  it("tests the snapshot of the group and the solutions: the layers in order, then the commands, then each exercise", async () => {
    const ran: string[] = [];
    mount.mockResolvedValue({
      execute: vi.fn(async ({ command }: { command: string }) => (ran.push(command), { status: 0, output: "" })),
      loadScenario: vi.fn(async () => {}),
      setSpeed: vi.fn(),
      snapshot: vi.fn(() => tree("srv")),
      history: () => [],
      destroy: vi.fn(),
    });
    const group = groupCards([
      block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { steps: [{ command: "own" }] } }),
      block("c", "COMMAND", 2, { steps: [{ command: "ls" }] }),
      block("e", "EXERCISES", 3, { items: [{ title: "Criar", difficulty: "EASY", solution: { steps: [{ command: "mkdir /srv" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/srv" }] }], setup: { steps: [{ command: "base" }] } }),
    ])[0]!;
    const before = [{ id: "module", kind: "module" as const, label: "Módulo", setup: { summary: "", steps: [{ command: "mod" }] } }];
    renderBuilder({ group, before });
    fireEvent.click(screen.getByRole("button", { name: "Testar comandos" }));
    expect(await screen.findByText("Exercício: Criar", {}, { timeout: 8000 })).toBeDefined();
    await waitFor(() => expect(ran).toEqual(["mod", "own", "base", "ls", "mkdir /srv"]), { timeout: 8000 });
  }, 20000);
});
