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
  service = { list: vi.fn(), saveCard: vi.fn(), setCardActive: vi.fn(), reorder: vi.fn(), createEnvironment: vi.fn(), getEnvironment: vi.fn() };
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

const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe("CardBuilder, a new card", () => {
  it("saves a card with a header, a text, a command and a tip as one request (CA-26)", async () => {
    service.saveCard.mockResolvedValue([block("n1", "TEXT", 4, { title: "Novo", command: "ls", html: "<p>Oi <code>ls</code></p>" })]);
    renderBuilder({ afterId: "x9" });

    fireEvent.change(input("Tag / Pill (badge)"), { target: { value: "ls" } });
    fireEvent.change(input("Título principal do card"), { target: { value: "Novo" } });

    fireEvent.click(screen.getByRole("button", { name: "Texto / HTML" }));
    await typeInto("Texto 1", "<p>Oi <code>ls</code></p>");

    fireEvent.click(screen.getByRole("button", { name: "+ Novo comando" }));
    fireEvent.change(input("Linha de comando (1)"), { target: { value: "ls -la" } });
    fireEvent.change(input("Terminal (1)"), { target: { value: "2" } });
    fireEvent.change(input("Descrição explicativa (antes de rodar) (1)"), { target: { value: "lista" } });
    fireEvent.change(input("Descrição oculta pós-execução (mostrada depois que o aluno roda) (1)"), { target: { value: "viu os arquivos" } });

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
    expect(input("Linha de comando (1)").value).toBe("apt update");
    expect(input("Certificação (Dica 1)").value).toBe("LPIC-1 102.4");
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

describe("CardBuilder, expected error and environment (SPEC-020)", () => {
  it("marks a command that must fail on purpose (CA-07)", async () => {
    service.saveCard.mockResolvedValue([]);
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });
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

  it("keeps the recorded environment in the card header when the card is saved (CA-02)", async () => {
    service.saveCard.mockResolvedValue([]);
    const group = groupCards([block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", environment: { scenarioId: "11111111-1111-4111-8111-111111111111", summary: "pronto", commands: ["mkdir /x"] } })])[0]!;
    renderBuilder({ group });
    expect(screen.getByRole("status")).toHaveTextContent("Ambiente gravado (1 comando digitado)");

    // Taking it away is a change of the card, saved with it.
    fireEvent.click(screen.getByRole("button", { name: "Remover ambiente" }));
    expect(screen.getByText("Há alterações não salvas.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const request = service.saveCard.mock.calls[0]![1] as { blocks: { payload: Record<string, unknown> }[] };
    expect(request.blocks[0]!.payload).not.toHaveProperty("environment");
  });

  it("records an environment from the terminal and saves it with the card (CA-01, CA-02)", async () => {
    let typed: string[] = [];
    mount.mockResolvedValue({ snapshot: () => ({ formato: "exame-so/maquina" }), history: () => typed, destroy: vi.fn() });
    service.createEnvironment.mockResolvedValue("22222222-2222-4222-8222-222222222222");
    service.saveCard.mockResolvedValue([]);
    const practice = { topicScenario: vi.fn().mockResolvedValue({ formato: "do-topico" }) };
    renderBuilder({ practice: practice as never });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });

    fireEvent.click(screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Gravar ambiente" }) as HTMLButtonElement).disabled).toBe(false));
    // With no earlier environment, the author starts from the topic scenario.
    expect(practice.topicScenario).toHaveBeenCalledWith("mod-1");
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "do-topico" });
    typed = ["mkdir /financeiro"];
    fireEvent.click(screen.getByRole("button", { name: "Gravar ambiente" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Ambiente gravado");

    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(service.saveCard).toHaveBeenCalled());
    const request = service.saveCard.mock.calls[0]![1] as { blocks: { payload: Record<string, unknown> }[] };
    expect(request.blocks[0]!.payload.environment).toEqual({ scenarioId: "22222222-2222-4222-8222-222222222222", summary: "", commands: ["mkdir /financeiro"] });
  });

  it("starts from the environment of the earlier card when there is one (RN-03)", async () => {
    mount.mockResolvedValue({ snapshot: () => ({}), history: () => [], destroy: vi.fn() });
    service.getEnvironment.mockResolvedValue({ formato: "do-card-anterior" });
    const practice = { topicScenario: vi.fn() };
    renderBuilder({ environmentBaseId: "env-anterior", practice: practice as never });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" }));
    await waitFor(() => expect(mount).toHaveBeenCalled());
    expect(service.getEnvironment).toHaveBeenCalledWith("env-anterior");
    expect(practice.topicScenario).not.toHaveBeenCalled();
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "do-card-anterior" });
  });

  it("puts a server error about the environment on its section", async () => {
    service.saveCard.mockRejectedValue(
      new ApiProblemError({ type: "validation-error", title: "Invalid", invalidParams: [{ name: "blocks[0].environment.scenarioId", reason: "unknown environment" }] }, 400),
    );
    const group = groupCards([block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", environment: { scenarioId: "11111111-1111-4111-8111-111111111111", summary: "", commands: [] } })])[0]!;
    renderBuilder({ group });
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    expect(await screen.findByText("environment.scenarioId: unknown environment")).toBeDefined();
  });
});
