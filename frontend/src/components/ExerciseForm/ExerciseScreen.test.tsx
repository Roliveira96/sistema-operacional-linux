import "@/test/domMatchers";
import type { Editor } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import { ExerciseScreen } from "./ExerciseScreen";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
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
const NEWLINE = String.fromCharCode(10);
const tree = (...folders: string[]) => ({
  raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: folders.map((nome) => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] })) },
  contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
});

const blocks = [
  block("m1", "TEXT", 1, { title: "Antes", html: "<p>a</p>", setup: { steps: [{ command: "above" }] } }),
  block("h", "TEXT", 2, { title: "Card", html: "<p>t</p>", setup: { steps: [{ command: "own" }] } }),
  block("c", "COMMAND", 3, { steps: [{ command: "ls" }] }),
  block(
    "e",
    "EXERCISES",
    4,
    {
      items: [
        { title: "Primeiro", difficulty: "EASY", description: "<p>enunciado</p>", hints: [{ text: "dica 1", command: "mkdir /a" }], solution: { steps: [{ command: "mkdir /a" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/a" }, { kind: "FILE_CONTENT", path: "/a/x.txt", content: "oi" + NEWLINE, match: "equals" }] },
        { title: "Segundo", difficulty: "HARD", solution: { steps: [{ command: "mkdir /b" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/b" }] },
      ],
      setup: { steps: [{ command: "base" }] },
    },
  ),
];

let service: { [K in keyof ContentAuthoringService]: ReturnType<typeof vi.fn> };
beforeEach(() => {
  service = { list: vi.fn(), content: vi.fn(), setModuleSetup: vi.fn(), versions: vi.fn(), publish: vi.fn(), restore: vi.fn(), saveCard: vi.fn(), setCardActive: vi.fn(), reorder: vi.fn() };
  service.content.mockResolvedValue({ blocks, setup: { summary: "", steps: [{ command: "mod" }] } });
  service.saveCard.mockResolvedValue([]);
});

const renderScreen = (index: string, cardKey = "h") =>
  render(<ExerciseScreen moduleId="mod-1" cardKey={cardKey} index={index} service={service as unknown as ContentAuthoringService} practice={{ topicScenario: vi.fn().mockResolvedValue(null) }} />);
const savedBlocks = () => (service.saveCard.mock.calls[0]![1] as { replaceIds: string[]; blocks: { id?: string; type: string; payload: Record<string, unknown> }[] }).blocks;
const items = () => savedBlocks().find((b) => b.type === "EXERCISES")!.payload.items as Record<string, unknown>[];

// Covers SPEC-022: the page of one exercise of a card.
describe("ExerciseScreen", () => {
  it("opens an existing exercise by its position, with a way back to the exercises of the card", async () => {
    renderScreen("1");
    expect(await screen.findByRole("heading", { level: 1, name: "Editar exercício" })).toBeDefined();
    expect((screen.getByLabelText("Título do exercício (1)") as HTMLInputElement).value).toBe("Segundo");
    expect((screen.getByLabelText("Nível (1)") as HTMLSelectElement).value).toBe("HARD");
    expect(screen.getByRole("link", { name: "← Exercícios do card" }).getAttribute("href")).toBe("/app/modules/mod-1/cards/h/exercises".replace("/exercises", "?tab=exercises"));
    expect(screen.getByText(/Exercício do card "Card"/)).toBeDefined();
    // The preview shows it as the student sees it.
    expect(screen.getByRole("complementary", { name: "Como o aluno vê" })).toHaveTextContent("Segundo");
  });

  it("says so when the card or the exercise does not exist", async () => {
    renderScreen("9");
    expect(await screen.findByText("Exercício não encontrado. Ele pode ter sido removido.")).toBeDefined();
    cleanup();
    renderScreen("0", "gone");
    expect(await screen.findByText("Exercício não encontrado. Ele pode ter sido removido.")).toBeDefined();
    cleanup();
    service.content.mockRejectedValue(new Error("x"));
    renderScreen("0");
    expect(await screen.findByText("Exercício não encontrado. Ele pode ter sido removido.")).toBeDefined();
  });

  it("changes the exercise, saves only it inside the group of the card, and keeps the other blocks and exercises", async () => {
    renderScreen("0");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: "Primeiro (novo)" } });
    fireEvent.change(screen.getByLabelText("Nível (1)"), { target: { value: "MEDIUM" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar dica" }));
    fireEvent.change(screen.getByLabelText("Texto da dica (1.2)"), { target: { value: "dica 2" } });
    const host = (await screen.findByRole("textbox", { name: "Descrição do exercício (1)" })) as HTMLElement & { editor: Editor };
    act(() => {
      host.editor.chain().focus().selectAll().insertContent("<p>novo enunciado</p>").run();
    });
    expect(screen.getByText("Há alterações não salvas.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());

    const request = service.saveCard.mock.calls[0]![1] as { replaceIds: string[] };
    // The whole card goes, since a card is saved at once: its header, its command and its group keep their identity.
    expect(request.replaceIds).toEqual(["h", "c", "e"]);
    expect(savedBlocks().map((b) => [b.id, b.type])).toEqual([["h", "TEXT"], ["c", "COMMAND"], ["e", "EXERCISES"]]);
    expect(items().map((i) => i.title)).toEqual(["Primeiro (novo)", "Segundo"]);
    expect(items()[0]).toMatchObject({ difficulty: "MEDIUM", description: "<p>novo enunciado</p>", hints: [{ text: "dica 1", command: "mkdir /a" }, { text: "dica 2" }] });
    expect(items()[1]).toMatchObject({ title: "Segundo", difficulty: "HARD" });
    expect(await screen.findByText("Exercício salvo.")).toBeDefined();
    expect(screen.queryByText("Há alterações não salvas.")).toBeNull();
  });

  it("creates a new exercise at the end of the group, and goes to its page", async () => {
    renderScreen("new");
    expect(await screen.findByRole("heading", { level: 1, name: "Novo exercício" })).toBeDefined();
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: "Terceiro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    expect(items().map((i) => i.title)).toEqual(["Primeiro", "Segundo", "Terceiro"]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/modules/mod-1/cards/h/exercises/2"));
  });

  it("creates the group of a card that had none, and keeps its snapshot", async () => {
    service.content.mockResolvedValue({ blocks: blocks.slice(0, 3), setup: undefined });
    renderScreen("new");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: "Único" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    expect(savedBlocks().map((b) => b.type)).toEqual(["TEXT", "COMMAND", "EXERCISES"]);
    expect(items()).toEqual([{ title: "Único", difficulty: "MEDIUM" }]);
  });

  it("asks for the title and for the text of each tip, without calling the server", async () => {
    renderScreen("0");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar dica" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    expect(await screen.findByText("Corrija os campos marcados antes de salvar.")).toBeDefined();
    expect(screen.getByText("Obrigatório.")).toBeDefined();
    expect(screen.getByText("Toda dica precisa de um texto.")).toBeDefined();
    expect(service.saveCard).not.toHaveBeenCalled();
  });

  it("puts a server error on the exercise, and offers to write over a card someone else changed", async () => {
    service.saveCard.mockRejectedValueOnce(new ApiProblemError({ type: "validation-error", title: "Invalid", invalidParams: [{ name: "blocks[2].items[0].hints[0].text", reason: "must have at most 1000 characters" }] }, 400));
    renderScreen("0");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    expect(await screen.findByText("items[0].hints[0].text: must have at most 1000 characters")).toBeDefined();

    service.saveCard.mockRejectedValueOnce(new ApiProblemError({ type: "block-conflict", title: "Conflict" }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    expect(await screen.findByText(/O card foi alterado por outra pessoa/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar mesmo assim" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalledTimes(3));
    expect((service.saveCard.mock.calls[2]![1] as { force: boolean }).force).toBe(true);
  });

  it("does not save when something else in the card is wrong, and says to open the card", async () => {
    service.content.mockResolvedValue({ blocks: [block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { steps: [], files: [{ path: "/a", content: "x", mode: "64" }] } }), blocks[3]!], setup: undefined });
    renderScreen("0");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    expect(await screen.findByText(/Há campos a corrigir em outra parte do card/)).toBeDefined();
    expect(service.saveCard).not.toHaveBeenCalled();
  });

  it("goes back to the exercises of the card", async () => {
    renderScreen("0");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(push).toHaveBeenCalledWith("/app/modules/mod-1/cards/h?tab=exercises");
  });

  it("records how to do the exercise in a machine with the layers, the base of the group and the exercises before, and works out how it ends", async () => {
    const ran: string[] = [];
    let history: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    // The author's machine at the end, the one built again from the commands, and the one before the solution.
    const snapshots = [tree("b", "c"), tree("b", "c"), tree("b")];
    const win = {
      execute: vi.fn(async ({ command }: { command: string }) => (ran.push(command), { status: 0, output: "" })),
      setSpeed: vi.fn(),
      history: () => history,
      snapshot: vi.fn(() => snapshots.shift()),
      destroy: vi.fn(),
    };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    renderScreen("1");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar como fazer no terminal" }));
    await screen.findByRole("button", { name: "Usar estes comandos" });
    // The module, the card above, this card, the base of the group and the solution of the exercise before, then the solution already written.
    await waitFor(() => expect(ran).toEqual(["mod", "above", "own", "base", "mkdir /a", "mkdir /b"]));
    history = ["mkdir /c"];
    onCommand?.({});
    await waitFor(() => expect((screen.getByRole("button", { name: "Usar estes comandos" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));
    expect(await screen.findByText("A pasta /c existe", {}, { timeout: 5000 })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    expect(items()[1]).toMatchObject({ solution: { steps: [{ command: "mkdir /b" }, { command: "mkdir /c" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/c" }] });
  }, 20000);

  it("tests this exercise: the layers, then its solution, then how it ends", async () => {
    const ran: string[] = [];
    mount.mockResolvedValue({
      execute: vi.fn(async ({ command }: { command: string }) => (ran.push(command), { status: 0, output: "" })),
      loadScenario: vi.fn(async () => {}),
      setSpeed: vi.fn(),
      snapshot: vi.fn(() => tree("b")),
      history: () => [],
      destroy: vi.fn(),
    });
    renderScreen("1");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.click(screen.getByRole("button", { name: "Testar exercício" }));
    expect(await screen.findByText("Exercício: Segundo", {}, { timeout: 8000 })).toBeDefined();
    await waitFor(() => expect(ran).toEqual(["mod", "above", "own", "base", "mkdir /a", "mkdir /b"]), { timeout: 8000 });
    expect(screen.getByText("Exercício: Segundo")).toBeDefined();
    expect(await screen.findByText("O exercício terminou como esperado", {}, { timeout: 8000 })).toBeDefined();
  }, 20000);

  it("edits the conditions of finalization of the exercise", async () => {
    renderScreen("0");
    await screen.findByLabelText("Título do exercício (1)");
    const list = screen.getByRole("list", { name: "Como o exercício termina (1)" });
    expect(list).toHaveTextContent("A pasta /a existe");
    fireEvent.change(screen.getByLabelText("Como conferir o texto: /a/x.txt"), { target: { value: "contains" } });
    fireEvent.click(screen.getByRole("button", { name: "Remover a condição: A pasta /a existe" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    expect((items()[0]!.conditions as { kind: string; match?: string }[])).toEqual([{ kind: "FILE_CONTENT", path: "/a/x.txt", content: "oi" + NEWLINE, match: "contains" }]);
  });
});
