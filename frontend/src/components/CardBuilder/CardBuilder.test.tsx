import "@/test/domMatchers";
import type { Editor } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupCards } from "@/lib/cardModel";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import { CardBuilder } from "./CardBuilder";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const block = (id: string, type: string, position: number, payload: Record<string, unknown>): AuthoredBlock => ({
  id,
  type,
  position,
  payload,
  edited: false,
  active: true,
  updatedAt: `2026-10-09T12:00:0${position}Z`,
});

const stored = [
  block("h1", "TEXT", 1, { title: "Atualizar", command: "apt update", html: "<p>Texto inicial</p>" }),
  block("c1", "COMMAND", 2, { steps: [{ command: "apt update", explanation: "sincroniza", outputExplanation: "baixou", terminal: 1 }] }),
  block("t1", "TIP", 3, { variant: "DEFAULT", title: "LPIC-1 102.4", html: "<p>dica</p>" }),
];

let service: { [K in keyof ContentAuthoringService]: ReturnType<typeof vi.fn> };
const onCancel = vi.fn();
const onCreated = vi.fn();

beforeEach(() => {
  service = { list: vi.fn(), content: vi.fn(), setModuleSetup: vi.fn(), versions: vi.fn(), publish: vi.fn(), restore: vi.fn(), saveCard: vi.fn(), setCardActive: vi.fn(), reorder: vi.fn() };
});

const renderBuilder = (props: Partial<React.ComponentProps<typeof CardBuilder>> = {}) =>
  render(<CardBuilder moduleId="mod-1" service={service as unknown as ContentAuthoringService} onCancel={onCancel} onCreated={onCreated} {...props} />);

type Host = HTMLElement & { editor: Editor };

/** Types into the rich text editor whose accessible name is `name`. */
async function typeInto(name: string, html: string) {
  const host = (await screen.findByRole("textbox", { name })) as Host;
  act(() => {
    host.editor.chain().focus().selectAll().insertContent(html).run();
  });
}

const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe("CardBuilder, a new card", () => {
  it("saves a card with a header, a text, a command and a tip as one request (CA-26)", async () => {
    service.saveCard.mockResolvedValue([block("n1", "TEXT", 4, { title: "Novo", command: "ls", html: "<p>Oi <code>ls</code></p>" })]);
    renderBuilder({ afterId: "x9" });

    fireEvent.change(input("Tag / Pill (badge)"), { target: { value: "ls" } });
    fireEvent.change(input("Título principal do card"), { target: { value: "Novo" } });

    fireEvent.click(screen.getByRole("button", { name: "Texto / HTML" }));
    await typeInto("Texto 1", "<p>Oi <code>ls</code></p>");

    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "ls -la" } });
    fireEvent.change(input("Terminal (1)"), { target: { value: "2" } });
    fireEvent.change(input("Descrição explicativa (antes de rodar) (1)"), { target: { value: "lista" } });
    fireEvent.change(input("Descrição oculta pós-execução (mostrada depois que o aluno roda) (1)"), { target: { value: "viu os arquivos" } });

    openTab("Dicas");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar dica" }));
    fireEvent.change(input("Certificação (Dica 1)"), { target: { value: "LPIC-1" } });
    await typeInto("Texto (Dica 1)", "<p>dica</p>");

    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));

    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const [moduleId, request] = service.saveCard.mock.calls[0] as [string, { replaceIds: string[]; afterBlockId?: string; blocks: { id?: string; type: string; payload: Record<string, unknown> }[] }];
    expect(moduleId).toBe("mod-1");
    expect(request.replaceIds).toEqual([]);
    expect(request.afterBlockId).toBe("x9");
    expect(request.blocks.map((b) => b.type)).toEqual(["TEXT", "COMMAND", "TIP"]);
    expect(request.blocks.every((b) => b.id === undefined)).toBe(true);
    expect(request.blocks[0]!.payload).toEqual({ title: "Novo", command: "ls", html: "<p>Oi <code>ls</code></p>" });
    expect(request.blocks[1]!.payload).toEqual({ steps: [{ command: "ls -la", terminal: 2, explanation: "lista", outputExplanation: "viu os arquivos" }] });
    expect(request.blocks[2]!.payload).toEqual({ variant: "DEFAULT", title: "LPIC-1", html: "<p>dica</p>" });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("asks for the title and for the text before saving, without calling the server", async () => {
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Texto / HTML" }));
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));

    expect(await screen.findByText("Corrija os campos marcados antes de salvar.")).toBeDefined();
    expect(screen.getAllByText("Obrigatório.").length).toBeGreaterThanOrEqual(3);
    expect(service.saveCard).not.toHaveBeenCalled();
  });

  it("checks the addresses of an image, a video and a link", async () => {
    renderBuilder();
    fireEvent.change(input("Título principal do card"), { target: { value: "T" } });
    for (const name of ["Imagem", "Vídeo (embed)", "Link / Referência"]) fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.change(input("Endereço da imagem 1"), { target: { value: "http://x.com/a.png" } });
    fireEvent.change(input("Endereço do vídeo (YouTube, embed) 2"), { target: { value: "https://vimeo.com/1" } });
    fireEvent.change(input("Endereço de destino 3"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));

    expect(await screen.findByText("Use um endereço que comece com https://.")).toBeDefined();
    expect(screen.getByText(/incorporação do YouTube/)).toBeDefined();
    expect(screen.getByText("Use um endereço que comece com http:// ou https://.")).toBeDefined();
    expect(service.saveCard).not.toHaveBeenCalled();
  });

  it("shows the card as the student sees it while it is edited (CA-28)", async () => {
    renderBuilder();
    const preview = screen.getByRole("complementary", { name: "Preview ao vivo do card" });
    expect(within(preview).getByText("Preencha o card para ver como o aluno o verá.")).toBeDefined();

    fireEvent.change(input("Tag / Pill (badge)"), { target: { value: "apt update" } });
    fireEvent.change(input("Título principal do card"), { target: { value: "Atualizar a lista" } });
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "sudo apt update" } });

    expect(within(preview).getByText("apt update")).toBeDefined();
    expect(within(preview).getByText("Atualizar a lista")).toBeDefined();
    expect(within(preview).getByText("sudo apt update")).toBeDefined();
  });

  it("adds, writes, moves and removes description elements of every kind", async () => {
    renderBuilder();
    for (const name of ["Snippet de código", "Tabela"]) fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.change(input("Linguagem 1"), { target: { value: "sh" } });
    fireEvent.change(input("Código 1"), { target: { value: "echo oi" } });
    fireEvent.change(input("Cabeçalhos (separados por |) 2"), { target: { value: "A | B" } });
    fireEvent.change(input("Linhas (uma por linha, colunas separadas por |) 2"), { target: { value: "1 | 2" } });

    fireEvent.click(screen.getByRole("button", { name: "Descer elemento 1" }));
    expect(screen.getAllByText(/^(Snippet de código|Tabela) \d$/).map((el) => el.textContent)).toEqual(["Tabela 1", "Snippet de código 2"]);
    expect((screen.getByRole("button", { name: "Subir elemento 1" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remover elemento 1" }));
    expect(screen.queryByText("Tabela 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remover elemento 1" }));
    expect(screen.getByText("Nenhum elemento ainda. Use os botões acima para adicionar.")).toBeDefined();
  });

  it("writes a real-world note and an exam alert (CA-26)", async () => {
    renderBuilder();
    openTab("Dicas");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar caso real" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar alerta" }));
    fireEvent.change(input("Título (Caso 1)"), { target: { value: "Na vida real" } });
    fireEvent.change(input("Certificação (Alerta 1)"), { target: { value: "RHCSA" } });
    expect((input("Título (Caso 1)") as HTMLInputElement).value).toBe("Na vida real");
    expect(input("Certificação (Alerta 1)").value).toBe("RHCSA");
    fireEvent.click(screen.getByRole("button", { name: /Remover Caso 1/ }));
    expect(screen.getByText("Nenhum caso adicionado.")).toBeDefined();
  });

  it("warns before leaving while there are unsaved changes, and cancels (CA-13)", () => {
    renderBuilder();
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    fireEvent.change(input("Título principal do card"), { target: { value: "x" } });
    expect(leave()).toBe(true);
    expect(screen.getByText("Há alterações não salvas.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("CardBuilder, an existing card", () => {
  const group = () => groupCards(stored)[0]!;

  it("opens with what is stored and has nothing to save until it changes", async () => {
    renderBuilder({ group: group() });
    expect(input("Tag / Pill (badge)").value).toBe("apt update");
    expect(input("Título principal do card").value).toBe("Atualizar");
    openTab("Comandos");
    expect(input("Linha de comando (1)").value).toBe("apt update");
    openTab("Dicas");
    expect(input("Certificação (Dica 1)").value).toBe("LPIC-1 102.4");
    openTab("Descrição");
    expect(within(await screen.findByRole("textbox", { name: "Texto 1" })).getByText("Texto inicial")).toBeDefined();
    expect((screen.getByRole("button", { name: "Salvar card" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("replaces the blocks of the card keeping their identity, then shows it saved (CA-26)", async () => {
    service.saveCard.mockImplementation(async (_id: string, req: { blocks: { id?: string; type: string; payload: Record<string, unknown> }[] }) =>
      req.blocks.map((b, i) => ({ ...block(b.id ?? `new${i}`, b.type, i + 1, b.payload), updatedAt: "2026-10-09T13:00:00Z" })),
    );
    renderBuilder({ group: group() });

    fireEvent.change(input("Título principal do card"), { target: { value: "Atualizar de novo" } });
    expect(screen.getByText("Há alterações não salvas.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));

    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const request = service.saveCard.mock.calls[0]![1] as { replaceIds: string[]; afterBlockId?: string; force: boolean; blocks: { id?: string; updatedAt?: string; type: string }[] };
    expect(request.replaceIds).toEqual(["h1", "c1", "t1"]);
    expect(request.afterBlockId).toBeUndefined();
    expect(request.force).toBe(false);
    expect(request.blocks.map((b) => [b.id, b.updatedAt, b.type])).toEqual([
      ["h1", "2026-10-09T12:00:01Z", "TEXT"],
      ["c1", "2026-10-09T12:00:02Z", "COMMAND"],
      ["t1", "2026-10-09T12:00:03Z", "TIP"],
    ]);
    expect(await screen.findByText("Card salvo.")).toBeDefined();
    expect(onCreated).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Salvar card" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("puts the server's errors on the item behind each block", async () => {
    service.saveCard.mockRejectedValue(
      new ApiProblemError({ type: "validation-error", title: "Invalid", invalidParams: [{ name: "blocks[1].steps[0].command", reason: "too long" }, { name: "replaceIds", reason: "bad" }] }, 400),
    );
    renderBuilder({ group: group() });
    openTab("Comandos");
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    expect(await screen.findByText("command: too long")).toBeDefined();
    expect(screen.getByText("replaceIds: bad")).toBeDefined();
  });

  it("offers to write over a card someone else changed (CA-09)", async () => {
    service.saveCard.mockRejectedValueOnce(new ApiProblemError({ type: "block-conflict", title: "Conflict" }, 409));
    service.saveCard.mockResolvedValueOnce(stored);
    renderBuilder({ group: group() });
    fireEvent.change(input("Título principal do card"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));

    expect(await screen.findByText("Outra pessoa alterou este card depois que você o abriu.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Gravar por cima/ }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalledTimes(2));
    expect((service.saveCard.mock.calls[1]![1] as { force: boolean }).force).toBe(true);
  });

  it("tells when the save failed for another reason", async () => {
    service.saveCard.mockRejectedValue(new Error("rede"));
    renderBuilder({ group: group() });
    fireEvent.change(input("Título principal do card"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    expect(await screen.findByText("Não foi possível salvar o card.")).toBeDefined();
  });

  it("keeps a block of another type as it is, and lets the author move or remove it", async () => {
    const withWidget = [stored[0]!, block("w1", "WIDGET", 2, { component: "LS_ANATOMY", params: {} })];
    service.saveCard.mockResolvedValue(withWidget);
    renderBuilder({ group: groupCards(withWidget)[0]! });
    expect(screen.getByText("Bloco do tipo WIDGET, mantido como está. Você pode mudar a ordem ou removê-lo.")).toBeDefined();

    fireEvent.change(input("Título principal do card"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const request = service.saveCard.mock.calls[0]![1] as { blocks: { id?: string; type: string; payload: Record<string, unknown> }[] };
    expect(request.blocks[1]).toMatchObject({ id: "w1", type: "WIDGET", payload: { component: "LS_ANATOMY", params: {} } });
  });
});

describe("CardBuilder, the introduction", () => {
  it("does not require a title for the introduction", async () => {
    const intro = [block("i1", "LEGACY_HTML", 1, { html: "<p>Boas-vindas</p>" })];
    service.saveCard.mockResolvedValue(intro);
    renderBuilder({ group: groupCards(intro)[0]! });
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "ls" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const request = service.saveCard.mock.calls[0]![1] as { blocks: { type: string }[] };
    expect(request.blocks.map((b) => b.type)).toEqual(["LEGACY_HTML", "COMMAND"]);
  });
});

describe("CardBuilder, raw html", () => {
  it("writes raw html in its own element and does not preview what is unsafe", async () => {
    service.saveCard.mockResolvedValue([]);
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "HTML avançado" }));
    const preview = screen.getByRole("complementary", { name: "Preview ao vivo do card" });

    fireEvent.change(screen.getByLabelText("Código HTML 1"), { target: { value: '<div class="caixa"><p>Olá caixa</p></div>' } });
    expect(within(preview).getByText("Olá caixa")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Código HTML 1"), { target: { value: '<p>perigo</p><img src="x" onerror="x()">' } });
    expect(within(preview).queryByText("perigo")).toBeNull();

    fireEvent.change(screen.getByLabelText("Código HTML 1"), { target: { value: '<div class="caixa"><p>Olá caixa</p></div>' } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const request = service.saveCard.mock.calls[0]![1] as { blocks: { payload: { html?: string } }[] };
    expect(request.blocks[1]!.payload.html).toBe('<div class="caixa"><p>Olá caixa</p></div>');
  });
});

describe("CardBuilder, expected error and snapshot (SPEC-020, SPEC-021)", () => {
  it("marks a command that must fail on purpose (CA-07)", async () => {
    service.saveCard.mockResolvedValue([]);
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "curl http://localhost" } });
    const box = screen.getByLabelText("Erro esperado (este comando deve falhar de propósito)") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));

    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const request = service.saveCard.mock.calls[0]![1] as { blocks: { payload: Record<string, unknown> }[] };
    expect(request.blocks[1]!.payload.steps).toEqual([{ command: "curl http://localhost", terminal: 1, expectError: true }]);
  });

  const withSetup = () => groupCards([block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { summary: "pronto", steps: [{ command: "mkdir /x" }] } })])[0]!;
  const savedPayload = () => (service.saveCard.mock.calls[0]![1] as { blocks: { payload: Record<string, unknown> }[] }).blocks[0]!.payload;

  it("shows the snapshot kept in the card header, lets the author change it and saves it with the card (SPEC-021 CA-02)", async () => {
    service.saveCard.mockResolvedValue([]);
    renderBuilder({ group: withSetup() });
    openTab("Comandos");
    expect(input("Comando (1)").value).toBe("mkdir /x");
    expect(input("Resumo do cenário preparado").value).toBe("pronto");

    fireEvent.change(input("Comando (1)"), { target: { value: "mkdir /y" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar comando de ambiente" }));
    fireEvent.change(input("Comando (2)"), { target: { value: "touch /y/a" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    expect(savedPayload().setup).toEqual({ summary: "pronto", steps: [{ command: "mkdir /y" }, { command: "touch /y/a" }] });
  });

  it("takes the snapshot away with the card, without keeping a trace", async () => {
    service.saveCard.mockResolvedValue([]);
    renderBuilder({ group: withSetup() });
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "Remover o ambiente" }));
    expect(screen.getByText("Há alterações não salvas.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    expect(savedPayload()).not.toHaveProperty("setup");
  });

  it("refuses an empty snapshot command before sending anything", async () => {
    renderBuilder({ group: withSetup() });
    openTab("Comandos");
    fireEvent.change(input("Comando (1)"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    expect(await screen.findByText("Informe o comando.")).toBeDefined();
    expect(service.saveCard).not.toHaveBeenCalled();
  });

  it("records the commands typed in the terminal as steps, on the machine prepared by the earlier snapshots (SPEC-021 CA-03, CA-04)", async () => {
    let typed: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    const win = { execute: vi.fn(async () => ({ status: 0, output: "" })), setSpeed: vi.fn(), history: () => ["m1", ...typed], snapshot: () => ({}), destroy: vi.fn() };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    service.saveCard.mockResolvedValue([]);
    const practice = { topicScenario: vi.fn().mockResolvedValue({ formato: "do-topico" }) };
    const before = [{ id: "module", kind: "module" as const, label: "Módulo", setup: { summary: "", steps: [{ command: "m1" }] } }];
    renderBuilder({ practice: practice as never, before });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });

    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    await waitFor(() => expect(win.execute).toHaveBeenCalledWith(expect.objectContaining({ command: "m1" })));
    expect(practice.topicScenario).toHaveBeenCalledWith("mod-1");
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "do-topico" });
    await waitFor(() => expect(screen.queryByText("Preparando a máquina com o módulo, os cards anteriores e os comandos que já estão na lista…")).toBeNull());

    typed = ["mkdir /financeiro"];
    act(() => onCommand?.({}));
    expect(await screen.findByText("mkdir /financeiro")).toBeDefined();
    expect(screen.queryByText("m1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));
    expect(((await screen.findByLabelText("Comando (1)")) as HTMLInputElement).value).toBe("mkdir /financeiro");

    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    expect(savedPayload().setup).toEqual({ steps: [{ command: "mkdir /financeiro" }] });
  });

  it("warns, while recording, when an earlier snapshot has a conflict (SPEC-021 CA-06)", async () => {
    const win = { execute: vi.fn(async () => ({ status: 1, output: "erro" })), setSpeed: vi.fn(), history: () => [], snapshot: () => ({}), destroy: vi.fn() };
    mount.mockResolvedValue(win);
    const before = [{ id: "module", kind: "module" as const, label: "Módulo", setup: { summary: "", steps: [{ command: "mkdir /a" }] } }];
    renderBuilder({ practice: { topicScenario: vi.fn().mockResolvedValue(null) } as never, before });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    expect(await screen.findByText(/Conflito em "Módulo": o comando "mkdir \/a" deu erro/)).toBeDefined();
  });

  it("asks for a title to keep the snapshot, and puts a server error on the step", async () => {
    renderBuilder();
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar comando de ambiente" }));
    fireEvent.change(input("Comando (1)"), { target: { value: "ls" } });
    expect(screen.getByText("Dê um título ao card para guardar o ambiente.")).toBeDefined();
    cleanup();

    service.saveCard.mockRejectedValue(new ApiProblemError({ type: "validation-error", title: "Invalid", invalidParams: [{ name: "blocks[0].setup.steps[0].terminal", reason: "out of range" }] }, 400));
    renderBuilder({ group: withSetup() });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    expect(await screen.findByText("setup.steps[0].terminal: out of range")).toBeDefined();
  });
});

describe("CardBuilder, testing the commands (SPEC-020 CA-10)", () => {
  const runner = () => ({
    execute: vi.fn(async () => ({ status: 0, output: "" })),
    loadScenario: vi.fn(async () => {}),
    setSpeed: vi.fn(),
    snapshot: () => ({}),
    history: () => [],
    destroy: vi.fn(),
  });

  it("puts the test button next to Save, only offers it when there are commands, and tests what is on the screen even if not saved", async () => {
    const win = runner();
    mount.mockResolvedValue(win);
    const practice = { topicScenario: vi.fn().mockResolvedValue({ formato: "do-topico" }) };
    renderBuilder({ practice: practice as never });

    const bar = screen.getByRole("button", { name: "Salvar card" }).parentElement as HTMLElement;
    const test = within(bar).getByRole("button", { name: "Testar comandos" }) as HTMLButtonElement;
    expect(test.disabled).toBe(true);
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "mkdir /x" } });
    expect(test.disabled).toBe(false);

    fireEvent.click(test);
    expect(await screen.findByText(/1 de 1 comando como esperado/)).toBeDefined();
    expect(win.execute).toHaveBeenCalledWith(expect.objectContaining({ command: "mkdir /x" }));
    // The test starts from the topic scenario.
    expect(practice.topicScenario).toHaveBeenCalledWith("mod-1");
    expect(service.saveCard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Fechar teste" }));
    expect(screen.queryByRole("region", { name: "Teste dos comandos" })).toBeNull();
  });

  it("starts every test from a clean machine: the snapshots of the module and of the earlier cards, then the card's own, then the commands (SPEC-021 CA-05)", async () => {
    const win = runner();
    mount.mockResolvedValue(win);
    const group = groupCards([
      block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { steps: [{ command: "own" }] } }),
      block("c", "COMMAND", 2, { steps: [{ command: "ls", terminal: 1 }] }),
    ])[0]!;
    const before = [{ id: "module", kind: "module" as const, label: "Módulo", setup: { summary: "", steps: [{ command: "mod" }] } }];
    renderBuilder({ group, before, practice: { topicScenario: vi.fn().mockResolvedValue({ formato: "do-topico" }) } as never });

    fireEvent.click(screen.getByRole("button", { name: "Testar comandos" }));
    await screen.findByText(/1 de 1 comando como esperado/);
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "do-topico" });
    expect((win.execute.mock.calls as unknown as [{ command: string }][]).map(([step]) => step.command)).toEqual(["mod", "own", "ls"]);

    // Each click starts over, on a new terminal.
    fireEvent.click(screen.getByRole("button", { name: "Testar comandos" }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(win.execute).toHaveBeenCalledTimes(6));
  });

  it("shows the error of a command that fails", async () => {
    const win = runner();
    win.execute.mockResolvedValue({ status: 1, output: "cat: /nao-existe: No such file or directory" } as never);
    mount.mockResolvedValue(win);
    renderBuilder({ practice: { topicScenario: vi.fn().mockResolvedValue(null) } as never });
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "cat /nao-existe" } });
    fireEvent.click(screen.getByRole("button", { name: "Testar comandos" }));
    expect(await screen.findByText("cat: /nao-existe: No such file or directory")).toBeDefined();
    expect(screen.getByText("Deu erro (código 1) e não era esperado")).toBeDefined();
  });
});

describe("CardBuilder, the sections in tabs", () => {
  const selected = () => screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent);

  it("has the tabs Descrição, Comandos, Dicas and Exercícios, and starts on the description", () => {
    renderBuilder();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Descrição", "Comandos", "Dicas", "Exercícios"]);
    expect(selected()).toEqual(["Descrição"]);
    expect(screen.getByRole("button", { name: "Texto / HTML" })).toBeDefined();
    // The others are not on screen yet, but the title of the card is always there.
    expect(screen.queryByRole("button", { name: "+ Novo comando" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Adicionar dica" })).toBeNull();
    expect(screen.getByLabelText("Título principal do card")).toBeDefined();
  });

  it("keeps the environment and the commands together in the Comandos tab", () => {
    renderBuilder();
    openTab("Comandos");
    expect(selected()).toEqual(["Comandos"]);
    expect(screen.getByRole("heading", { name: "Ambiente do card (snapshot)" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Comandos práticos" })).toBeDefined();
    expect(screen.getByRole("button", { name: "+ Adicionar comando de ambiente" })).toBeDefined();
    expect(screen.getByRole("button", { name: "+ Novo comando" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Texto / HTML" })).toBeNull();
  });

  it("keeps the tips, the real-world cases and the exam alerts in the Dicas tab", () => {
    renderBuilder();
    openTab("Dicas");
    for (const name of ["+ Adicionar dica", "+ Adicionar caso real", "+ Adicionar alerta"]) expect(screen.getByRole("button", { name })).toBeDefined();
  });

  it("has an Exercícios tab that says it is coming", () => {
    renderBuilder();
    openTab("Exercícios");
    expect(screen.getByRole("heading", { name: "Exercícios do card" })).toBeDefined();
    expect(screen.getByRole("status")).toHaveTextContent("Em breve");
  });

  it("does not lose what was written when the author changes tab", () => {
    renderBuilder();
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "ls -la" } });
    openTab("Dicas");
    openTab("Comandos");
    expect(input("Linha de comando (1)").value).toBe("ls -la");
  });

  it("marks the tab that has an error after trying to save", async () => {
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });
    openTab("Comandos");
    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    openTab("Descrição");
    expect(screen.queryByRole("img", { name: "tem erro nesta aba" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    const mark = await screen.findByRole("img", { name: "tem erro nesta aba" });
    expect(within(screen.getByRole("tab", { name: /Comandos/ })).getByRole("img", { name: "tem erro nesta aba" })).toBe(mark);
    expect(service.saveCard).not.toHaveBeenCalled();
  });
});
