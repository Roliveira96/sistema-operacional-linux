import "@/test/domMatchers";
import type { Editor } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupCards } from "@/lib/cardModel";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { CardBuilder } from "./CardBuilder";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

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
const NEWLINE = String.fromCharCode(10);
const savedBlocks = () => (service.saveCard.mock.calls[0]![1] as { blocks: { type: string; payload: Record<string, unknown> }[] }).blocks;
const tree = (...folders: string[]) => ({
  raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: folders.map((nome) => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] })) },
  contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
});

async function addExercise(title: string) {
  openTab("Exercícios");
  fireEvent.click(screen.getByRole("button", { name: "+ Adicionar exercício" }));
  fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: title } });
}

// Covers SPEC-022: the exercises of the card, written and recorded in the terminal.
describe("CardBuilder, the exercises", () => {
  it("has an Exercícios tab with the exercises and the snapshot of the group", () => {
    renderBuilder();
    openTab("Exercícios");
    expect(screen.getByRole("heading", { name: "Exercícios" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Snapshot do grupo de exercícios (opcional)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "+ Adicionar exercício" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Gravar o snapshot do grupo no terminal" })).toBeDefined();
  });

  it("writes an exercise with its level and tips, and saves it as the block of the group, with no snapshot", async () => {
    service.saveCard.mockResolvedValue([]);
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Card" } });
    await addExercise("Criar a pasta");
    fireEvent.change(screen.getByLabelText("Nível (1)"), { target: { value: "HARD" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar dica" }));
    fireEvent.change(screen.getByLabelText("Texto da dica (1.1)"), { target: { value: "Use o mkdir" } });
    fireEvent.change(screen.getByLabelText("Comando de referência (1.1)"), { target: { value: "mkdir /x" } });
    const host = (await screen.findByRole("textbox", { name: "Descrição do exercício (1)" })) as HTMLElement & { editor: Editor };
    act(() => {
      host.editor.chain().focus().selectAll().insertContent("<p>Crie a pasta</p>").run();
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());

    const exercises = savedBlocks().find((b) => b.type === "EXERCISES")!;
    expect(exercises.payload.setup).toBeUndefined();
    expect(exercises.payload.items).toEqual([{ title: "Criar a pasta", difficulty: "HARD", description: "<p>Crie a pasta</p>", hints: [{ text: "Use o mkdir", command: "mkdir /x" }] }]);
  });

  it("moves and removes exercises", () => {
    renderBuilder();
    openTab("Exercícios");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar exercício" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar exercício" }));
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: "Primeiro" } });
    fireEvent.change(screen.getByLabelText("Título do exercício (2)"), { target: { value: "Segundo" } });
    fireEvent.click(screen.getByRole("button", { name: "Descer 1" }));
    expect((screen.getByLabelText("Título do exercício (1)") as HTMLInputElement).value).toBe("Segundo");
    fireEvent.click(screen.getByRole("button", { name: "Remover 1" }));
    expect(screen.queryByLabelText("Título do exercício (2)")).toBeNull();
    expect((screen.getByLabelText("Título do exercício (1)") as HTMLInputElement).value).toBe("Primeiro");
  });

  it("asks for the title and the text of the tip before saving, and marks the tab", async () => {
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Card" } });
    await addExercise("");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar dica" }));
    openTab("Descrição");
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    expect(await screen.findByRole("img", { name: "tem erro nesta aba" })).toBeDefined();
    expect(service.saveCard).not.toHaveBeenCalled();
    openTab("Exercícios");
    expect(screen.getByText("Toda dica precisa de um texto.")).toBeDefined();
  });

  it("opens an existing group, lists the conditions of finalization, lets the author remove one and change how a text is compared", async () => {
    service.saveCard.mockResolvedValue([]);
    const group = groupCards([
      block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>" }),
      block("e", "EXERCISES", 2, {
        items: [{ title: "Criar", difficulty: "EASY", conditions: [{ kind: "DIR_EXISTS", path: "/srv/x" }, { kind: "FILE_CONTENT", path: "/srv/x/a.txt", content: "oi" + NEWLINE, match: "equals" }, { kind: "USER_EXISTS", name: "ana" }] }],
      }),
    ])[0]!;
    renderBuilder({ group });
    openTab("Exercícios");
    const list = screen.getByRole("list", { name: "Como o exercício termina (1)" });
    expect(list).toHaveTextContent("A pasta /srv/x existe");
    expect(list).toHaveTextContent("O arquivo /srv/x/a.txt tem o texto esperado");
    fireEvent.change(screen.getByLabelText("Como conferir o texto: /srv/x/a.txt"), { target: { value: "contains" } });
    expect(list).toHaveTextContent("O arquivo /srv/x/a.txt contém o texto esperado");
    fireEvent.click(screen.getByRole("button", { name: "Remover a condição: O usuário ana existe" }));
    expect(list).not.toHaveTextContent("O usuário ana existe");

    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const items = savedBlocks().find((b) => b.type === "EXERCISES")!.payload.items as { conditions: { kind: string; match?: string }[] }[];
    expect(items[0]!.conditions.map((c) => c.kind)).toEqual(["DIR_EXISTS", "FILE_CONTENT"]);
    expect(items[0]!.conditions[1]!.match).toBe("contains");
  });

  it("records how to do the exercise in the terminal and works out how it ends from what changed on the machine", async () => {
    let history: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    // The machine of the teacher at the end, the one built again from the commands, and the one before the solution.
    const snapshots = [tree("srv"), tree("srv"), tree()];
    const win = { execute: vi.fn(async () => ({ status: 0, output: "" })), setSpeed: vi.fn(), history: () => history, snapshot: vi.fn(() => snapshots.shift()), destroy: vi.fn() };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    service.saveCard.mockResolvedValue([]);
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Card" } });
    await addExercise("Criar a pasta srv");
    expect(screen.getByText(/Nenhuma condição ainda/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar como fazer no terminal" }));
    await waitFor(() => expect(mount).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Usar estes comandos" });
    history = ["mkdir /srv"];
    onCommand?.({});
    await waitFor(() => expect((screen.getByRole("button", { name: "Usar estes comandos" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));

    expect(await screen.findByText("A pasta /srv existe", {}, { timeout: 5000 })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const item = (savedBlocks().find((b) => b.type === "EXERCISES")!.payload.items as Record<string, unknown>[])[0]!;
    expect(item.solution).toEqual({ steps: [{ command: "mkdir /srv" }] });
    expect(item.conditions).toEqual([{ kind: "DIR_EXISTS", path: "/srv" }]);
  }, 20000);

  it("records the snapshot of the group on the machine of the module and of the card", async () => {
    const win = { execute: vi.fn(async () => ({ status: 0, output: "" })), setSpeed: vi.fn(), history: () => [], snapshot: vi.fn(() => tree()), destroy: vi.fn() };
    mount.mockResolvedValue(win);
    const before = [{ id: "module", kind: "module" as const, label: "Módulo", setup: { summary: "", steps: [{ command: "mkdir /modulo" }] } }];
    const group = groupCards([block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { steps: [{ command: "mkdir /card" }] } })])[0]!;
    renderBuilder({ group, before });
    openTab("Exercícios");
    fireEvent.click(screen.getByRole("button", { name: "Gravar o snapshot do grupo no terminal" }));
    // The machine is built from the module and then from the content of the card, before the terminal is freed.
    await waitFor(() => expect(win.execute.mock.calls.map((c) => (c as unknown as [{ command: string }])[0].command)).toEqual(["mkdir /modulo", "mkdir /card"]));
  });

  it("tests the snapshot of the group and the solutions: the layers in order, then the commands, then each exercise and how it ends", async () => {
    const ran: string[] = [];
    const win = {
      execute: vi.fn(async ({ command }: { command: string }) => (ran.push(command), { status: 0, output: "" })),
      loadScenario: vi.fn(async () => {}),
      setSpeed: vi.fn(),
      snapshot: vi.fn(() => tree("srv")),
      history: () => [],
      destroy: vi.fn(),
    };
    mount.mockResolvedValue(win);
    const group = groupCards([
      block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { steps: [{ command: "own" }] } }),
      block("c", "COMMAND", 2, { steps: [{ command: "ls" }] }),
      block("e", "EXERCISES", 3, { items: [{ title: "Criar", difficulty: "EASY", solution: { steps: [{ command: "mkdir /srv" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/srv" }] }], setup: { steps: [{ command: "base" }] } }),
    ])[0]!;
    const before = [{ id: "module", kind: "module" as const, label: "Módulo", setup: { summary: "", steps: [{ command: "mod" }] } }];
    renderBuilder({ group, before });
    fireEvent.click(screen.getByRole("button", { name: "Testar comandos" }));
    expect(await screen.findByText(/3 de 3 comandos como esperado/, {}, { timeout: 8000 })).toBeDefined();
    expect(ran).toEqual(["mod", "own", "base", "ls", "mkdir /srv"]);
    expect(screen.getByText("Comandos do card")).toBeDefined();
    expect(screen.getByText("Exercício: Criar")).toBeDefined();
    expect(screen.getByText("O exercício terminou como esperado")).toBeDefined();
  });
});
