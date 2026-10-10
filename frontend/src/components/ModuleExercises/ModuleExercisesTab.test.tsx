import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentAuthoringService } from "@/services/contentAuthoringService";
import type { ExerciseBank, ModuleExercise, ModuleExerciseService } from "@/services/moduleExerciseService";
import { ModuleExercisesTab } from "./ModuleExercisesTab";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
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

const item = (id: string, title: string, extra: Partial<ModuleExercise> = {}): ModuleExercise => ({
  exercise: {
    id,
    title,
    difficulty: "EASY",
    description: "<p>x</p>",
    hints: [{ id: "h", text: "d", command: "" }],
    solution: { summary: "", steps: [{ command: "mkdir /a" }] },
    conditions: [{ kind: "DIR_EXISTS", path: "/a" }],
  },
  practice: false,
  assessment: false,
  exclusive: false,
  status: "PUBLISHED",
  position: 0,
  mandatory: true,
  updatedAt: "2026-10-10T12:00:00Z",
  createdAt: "2026-10-09T12:00:00Z",
  createdBy: "Ana Prof",
  updatedBy: "Bia",
  dependsOn: null,
  legacy: false,
  ...extra,
});

const bank = (): ExerciseBank => ({
  items: [
    item("a", "Primeiro", { practice: true, position: 1 }),
    item("b", "Segundo", { practice: true, assessment: true, position: 2, mandatory: false, status: "DRAFT", dependsOn: "a" }),
    item("r", "Da prova", { assessment: true, exclusive: true, legacy: true, updatedAt: "2026-10-09T12:00:00Z" }),
    item("u", "Solto"),
  ],
  bankSetup: { summary: "", steps: [{ command: "mkdir /treino" }] },
});

let service: { [K in keyof ModuleExerciseService]: ReturnType<typeof vi.fn> };
const content = { content: vi.fn() } as unknown as Pick<ContentAuthoringService, "content">;

beforeEach(() => {
  service = {
    bank: vi.fn().mockResolvedValue(bank()),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    links: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    order: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(content.content).mockResolvedValue({ blocks: [], setup: { summary: "", steps: [{ command: "mkdir /modulo" }] } });
});

const renderTab = () =>
  render(
    <ModuleExercisesTab
      moduleId="mod-1"
      service={service as unknown as ModuleExerciseService}
      content={content}
      practice={{ topicScenario: vi.fn().mockResolvedValue(null) }}
    />,
  );
const bankBlock = () => screen.getByRole("region", { name: "Banco de exercícios" });
const available = () => screen.getByRole("region", { name: "Disponíveis no módulo" });
const reserved = () => screen.getByRole("region", { name: "Reservados para avaliação" });
const choose = (block: HTMLElement, title: string, action: string) => {
  fireEvent.click(within(block).getByRole("button", { name: `Ações do exercício ${title}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
};

// Covers SPEC-023 rev. 2: the tab Exercícios is the central bank and two blocks of links to it.
describe("ModuleExercisesTab", () => {
  it("lists the exercises of the practice in the order of the trail and the reserved ones apart, with marks and who wrote them (CA-01, CA-09)", async () => {
    renderTab();
    expect(await screen.findByRole("heading", { name: "Banco de exercícios do módulo" })).toBeDefined();
    const list = within(available()).getAllByRole("listitem");
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveTextContent("Primeiro");
    expect(list[0]).toHaveTextContent("Fácil · 1 dica · com solução · 1 condição");
    expect(list[0]).toHaveTextContent("publicado");
    expect(list[0]).toHaveTextContent("obrigatório");
    expect(list[0]).toHaveTextContent(/Criado em .+ por Ana Prof/);
    expect(list[0]).toHaveTextContent(/Atualizado em .+ por Bia/);
    expect(list[1]).toHaveTextContent("rascunho");
    expect(list[1]).toHaveTextContent("opcional");
    // An exercise that depends on another says which (SPEC-023 12.3).
    expect(list[1]).toHaveTextContent("depende de Primeiro");
    const own = within(reserved()).getAllByRole("listitem");
    expect(own.map((li) => li.textContent)).toEqual([expect.stringContaining("Segundo"), expect.stringContaining("Da prova")]);
    expect(own[1]).toHaveTextContent("da carga inicial: grave a solução para poder testá-lo");
    expect(within(available()).getByRole("link", { name: "Abrir o exercício Primeiro" }).getAttribute("href")).toBe("/app/modules/mod-1/exercises/a");
  });

  it("creates a question in the bank from each block, already linked to it (CA-17)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    expect(within(available()).getByRole("link", { name: "Criar nova questão" }).getAttribute("href")).toBe("/app/modules/mod-1/exercises/new?link=practice");
    expect(within(reserved()).getByRole("link", { name: "Criar nova questão" }).getAttribute("href")).toBe("/app/modules/mod-1/exercises/new?link=assessment");
  });

  it("shows every exercise of the bank with where it is linked, and filters them (CA-18)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    const titles = () => within(bankBlock()).getAllByRole("listitem").map((li) => li.querySelector("a")?.textContent);
    expect(titles()).toEqual(["Primeiro", "Segundo", "Da prova", "Solto"]);
    const rows = within(bankBlock()).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Disponível no módulo");
    expect(rows[1]).toHaveTextContent("Disponível no módulo");
    expect(rows[1]).toHaveTextContent("Reservado para avaliação");
    expect(rows[2]).toHaveTextContent("Exclusivo da avaliação");
    expect(rows[3]).toHaveTextContent("Não vinculado");

    const filter = (name: string) => fireEvent.click(within(bankBlock()).getByRole("button", { name }));
    filter("Não vinculados");
    expect(titles()).toEqual(["Solto"]);
    filter("Exclusivos da avaliação");
    expect(titles()).toEqual(["Da prova"]);
    filter("Reservados para avaliação");
    expect(titles()).toEqual(["Segundo", "Da prova"]);
    filter("Disponíveis no módulo");
    expect(titles()).toEqual(["Primeiro", "Segundo"]);
    filter("Todos");
    expect(titles()).toHaveLength(4);
  });

  it("says when the bank and the blocks are empty", async () => {
    service.bank.mockResolvedValue({ items: [] });
    renderTab();
    expect(await screen.findByText(/Nenhum exercício disponível/)).toBeDefined();
    expect(screen.getByText(/Nenhum exercício reservado/)).toBeDefined();
    expect(screen.getByText("O banco está vazio. Crie a primeira questão.")).toBeDefined();
  });

  it("moves an exercise in the trail and sends the whole order, then reads the bank again (CA-03)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    expect((screen.getByRole("button", { name: "Subir Primeiro" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Descer Segundo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Descer Primeiro" }));
    await waitFor(() =>
      expect(service.order).toHaveBeenCalledWith("mod-1", [
        { exerciseId: "b", mandatory: false },
        { exerciseId: "a", mandatory: true },
      ]),
    );
    await waitFor(() => expect(service.bank).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Exercício atualizado.")).toBeDefined();
  });

  it("makes an exercise mandatory or optional", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Obrigatório: Segundo" }));
    await waitFor(() =>
      expect(service.order).toHaveBeenCalledWith("mod-1", [
        { exerciseId: "a", mandatory: true },
        { exerciseId: "b", mandatory: true },
      ]),
    );
  });

  it("adds an exercise of the bank to a block, without it already being there (CA-17)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    fireEvent.click(within(available()).getByRole("button", { name: "Adicionar do Banco" }));
    const dialog = screen.getByRole("dialog", { name: "Adicionar ao bloco: Disponíveis no módulo" });
    // Already in the practice, or exclusive of the assessment: neither is offered.
    expect(within(dialog).queryByText("Primeiro")).toBeNull();
    expect(within(dialog).queryByText("Da prova")).toBeNull();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "zzz" } });
    expect(within(dialog).getByText("Todos os exercícios do banco já estão neste bloco.")).toBeDefined();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "sol" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar Solto" }));
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "u", { practice: true, assessment: false, exclusive: false }, "PUBLISHED"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(within(reserved()).getByRole("button", { name: "Adicionar do Banco" }));
    const second = screen.getByRole("dialog", { name: "Adicionar ao bloco: Reservados para avaliação" });
    expect(within(second).queryByText("Segundo")).toBeNull();
    fireEvent.click(within(second).getByRole("button", { name: "Adicionar Primeiro" }));
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "a", { practice: true, assessment: true, exclusive: false }, "PUBLISHED"));
  });

  it("closes the window of the bank with the button and with Escape", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    fireEvent.click(within(available()).getByRole("button", { name: "Adicionar do Banco" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(reserved()).getByRole("button", { name: "Adicionar do Banco" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes an exercise from a block without deleting it from the bank (CA-17)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    choose(available(), "Primeiro", "Remover do bloco");
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "a", { practice: false, assessment: false, exclusive: false }, "PUBLISHED"));
    expect(service.remove).not.toHaveBeenCalled();
    // Leaving the assessment also drops the exclusive mark, which only makes sense there.
    choose(reserved(), "Da prova", "Remover do bloco");
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "r", { practice: false, assessment: false, exclusive: false }, "PUBLISHED"));
  });

  it("makes an exercise of the assessment exclusive, and takes it out of the practice, or undoes it (CA-18)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    expect((screen.getByRole("checkbox", { name: "Exclusivo da avaliação: Da prova" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Exclusivo da avaliação: Segundo" }));
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "b", { practice: false, assessment: true, exclusive: true }, "DRAFT"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Exclusivo da avaliação: Da prova" }));
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "r", { practice: false, assessment: true, exclusive: false }, "PUBLISHED"));
  });

  it("publishes, takes back to draft and opens from the menu of each exercise (CA-03)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    choose(bankBlock(), "Segundo", "Publicar");
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "b", { practice: true, assessment: true, exclusive: false }, "PUBLISHED"));
    choose(bankBlock(), "Primeiro", "Voltar a rascunho");
    await waitFor(() => expect(service.links).toHaveBeenCalledWith("mod-1", "a", { practice: true, assessment: false, exclusive: false }, "DRAFT"));
    choose(available(), "Primeiro", "Abrir");
    expect(push).toHaveBeenCalledWith("/app/modules/mod-1/exercises/a");
  });

  it("shows the reason when the server refuses (an exercise without conditions cannot be published)", async () => {
    service.links.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "ApiProblemError" }));
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    choose(bankBlock(), "Segundo", "Publicar");
    expect(await screen.findByText("Não foi possível concluir a ação.")).toBeDefined();
  });

  it("asks before deleting an exercise from the bank, and warns that the progress of the students goes too (CA-10)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    choose(bankBlock(), "Solto", "Remover");
    const dialog = screen.getByRole("alertdialog", { name: "Remover" });
    expect(dialog).toHaveTextContent("O progresso dos alunos nele também é apagado");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(service.remove).not.toHaveBeenCalled();
    choose(bankBlock(), "Solto", "Remover");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(service.remove).toHaveBeenCalledWith("mod-1", "u"));
    expect(await screen.findByText("Exercício removido.")).toBeDefined();
  });

  it("keeps a single environment for the whole bank and saves it (CA-04)", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Banco de exercícios do módulo" });
    const save = screen.getByRole("button", { name: "Salvar ambiente" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByDisplayValue("mkdir /treino")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar comando de ambiente" }));
    fireEvent.change(screen.getByLabelText("Comando (2)"), { target: { value: "mkdir /prova" } });
    expect(screen.getByText("Há alterações no ambiente que não foram salvas.")).toBeDefined();
    fireEvent.click(save);
    await waitFor(() => expect(service.setup).toHaveBeenCalled());
    const sent = service.setup.mock.calls[0]![1] as { steps: unknown[] };
    expect(sent.steps).toEqual([{ command: "mkdir /treino" }, { command: "mkdir /prova" }]);
    expect(await screen.findByText("Ambiente do banco salvo.")).toBeDefined();
  });

  it("says so when the bank cannot be loaded, and tries again", async () => {
    service.bank.mockRejectedValueOnce(new Error("x"));
    renderTab();
    expect(await screen.findByText("Não foi possível carregar os exercícios do módulo.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { name: "Banco de exercícios do módulo" })).toBeDefined();
  });
});
