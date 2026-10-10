import "@/test/domMatchers";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentAuthoringService } from "@/services/contentAuthoringService";
import type {
  ExerciseBank,
  ModuleExercise,
  ModuleExerciseService,
} from "@/services/moduleExerciseService";
import { ModuleExercisesTab } from "./ModuleExercisesTab";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
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

const item = (
  id: string,
  title: string,
  extra: Partial<ModuleExercise> = {},
): ModuleExercise => ({
  exercise: {
    id,
    title,
    difficulty: "EASY",
    description: "<p>x</p>",
    hints: [{ id: "h", text: "d", command: "" }],
    solution: { summary: "", steps: [{ command: "mkdir /a" }] },
    conditions: [{ kind: "DIR_EXISTS", path: "/a" }],
  },
  usage: "EXERCISE",
  status: "PUBLISHED",
  position: 1,
  mandatory: true,
  updatedAt: "2026-10-10T12:00:00Z",
  createdAt: "2026-10-09T12:00:00Z",
  createdBy: "Ana Prof",
  updatedBy: "Bia",
  continuesPrevious: false,
  legacy: false,
  ...extra,
});

const bank = (): ExerciseBank => ({
  items: [
    item("a", "Primeiro", { position: 1 }),
    item("b", "Segundo", { position: 2, mandatory: false, status: "DRAFT" }),
    item("r", "Da prova", {
      usage: "ASSESSMENT",
      position: 0,
      mandatory: false,
      legacy: true,
      updatedAt: "2026-10-09T12:00:00Z",
    }),
  ],
  exercisesSetup: { summary: "", steps: [{ command: "mkdir /treino" }] },
});

let service: { [K in keyof ModuleExerciseService]: ReturnType<typeof vi.fn> };
const content = { content: vi.fn() } as unknown as Pick<
  ContentAuthoringService,
  "content"
>;

beforeEach(() => {
  service = {
    bank: vi.fn().mockResolvedValue(bank()),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    availability: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    order: vi.fn().mockResolvedValue(undefined),
    setups: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(content.content).mockResolvedValue({
    blocks: [],
    setup: { summary: "", steps: [{ command: "mkdir /modulo" }] },
  });
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
const available = () =>
  screen.getByRole("region", { name: "Disponíveis no módulo" });
const reserved = () =>
  screen.getByRole("region", { name: "Reservados para avaliação" });
const choose = (title: string, action: string) => {
  fireEvent.click(
    screen.getByRole("button", { name: `Ações do exercício ${title}` }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
};

// Covers SPEC-023: the tab Exercícios of the module is the bank, in two sets.
describe("ModuleExercisesTab", () => {
  it("lists the available exercises in the order of the trail and the reserved ones apart, with their marks and who wrote them (CA-01, CA-09)", async () => {
    renderTab();
    expect(
      await screen.findByRole("heading", {
        name: "Banco de exercícios do módulo",
      }),
    ).toBeDefined();
    const list = within(available()).getAllByRole("listitem");
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveTextContent("Primeiro");
    expect(list[0]).toHaveTextContent(
      "Fácil · 1 dica · com solução · 1 condição",
    );
    expect(list[0]).toHaveTextContent("publicado");
    expect(list[0]).toHaveTextContent("obrigatório");
    expect(list[0]).toHaveTextContent(/Criado em .+ por Ana Prof/);
    expect(list[0]).toHaveTextContent(/Atualizado em .+ por Bia/);
    expect(list[1]).toHaveTextContent("rascunho");
    expect(list[1]).toHaveTextContent("opcional");
    const own = within(reserved()).getAllByRole("listitem");
    expect(own).toHaveLength(1);
    expect(own[0]).toHaveTextContent("Da prova");
    expect(own[0]).toHaveTextContent(
      "da carga inicial: grave a solução para poder testá-lo",
    );
    expect(
      screen
        .getByRole("link", { name: "Abrir o exercício Primeiro" })
        .getAttribute("href"),
    ).toBe("/app/modules/mod-1/exercises/a");
    expect(
      screen
        .getByRole("link", { name: "+ Novo exercício" })
        .getAttribute("href"),
    ).toBe("/app/modules/mod-1/exercises/new");
  });

  it("says when a set is empty", async () => {
    service.bank.mockResolvedValue({ items: [] });
    renderTab();
    expect(
      await screen.findByText(/Nenhum exercício disponível/),
    ).toBeDefined();
    expect(screen.getByText(/Nenhum exercício reservado/)).toBeDefined();
  });

  it("moves an exercise in the trail and sends the whole order, then reads the bank again (CA-03)", async () => {
    renderTab();
    await screen.findByText("Primeiro");
    expect(
      (
        screen.getByRole("button", {
          name: "Subir Primeiro",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Descer Segundo",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
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
    await screen.findByText("Primeiro");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Obrigatório: Segundo" }),
    );
    await waitFor(() =>
      expect(service.order).toHaveBeenCalledWith("mod-1", [
        { exerciseId: "a", mandatory: true },
        { exerciseId: "b", mandatory: true },
      ]),
    );
  });

  it("reserves, makes available, publishes and takes back to draft from the menu of each exercise (CA-03)", async () => {
    renderTab();
    await screen.findByText("Primeiro");
    choose("Primeiro", "Reservar para avaliação");
    await waitFor(() =>
      expect(service.availability).toHaveBeenCalledWith(
        "mod-1",
        "a",
        "ASSESSMENT",
        "PUBLISHED",
      ),
    );
    choose("Segundo", "Publicar");
    await waitFor(() =>
      expect(service.availability).toHaveBeenCalledWith(
        "mod-1",
        "b",
        "EXERCISE",
        "PUBLISHED",
      ),
    );
    choose("Da prova", "Disponibilizar no módulo");
    await waitFor(() =>
      expect(service.availability).toHaveBeenCalledWith(
        "mod-1",
        "r",
        "EXERCISE",
        "PUBLISHED",
      ),
    );
    choose("Primeiro", "Voltar a rascunho");
    await waitFor(() =>
      expect(service.availability).toHaveBeenCalledWith(
        "mod-1",
        "a",
        "EXERCISE",
        "DRAFT",
      ),
    );
    choose("Primeiro", "Abrir");
    expect(push).toHaveBeenCalledWith("/app/modules/mod-1/exercises/a");
  });

  it("shows the reason when the server refuses (an exercise without conditions cannot be published)", async () => {
    service.availability.mockRejectedValueOnce(
      Object.assign(new Error("x"), { name: "ApiProblemError" }),
    );
    renderTab();
    await screen.findByText("Primeiro");
    choose("Segundo", "Publicar");
    expect(
      await screen.findByText("Não foi possível concluir a ação."),
    ).toBeDefined();
  });

  it("asks before removing an exercise, and warns that the progress of the students goes too (CA-10)", async () => {
    renderTab();
    await screen.findByText("Primeiro");
    choose("Primeiro", "Remover");
    const dialog = screen.getByRole("alertdialog", { name: "Remover" });
    expect(dialog).toHaveTextContent(
      "O progresso dos alunos nele também é apagado",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(service.remove).not.toHaveBeenCalled();
    choose("Primeiro", "Remover");
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remover",
      }),
    );
    await waitFor(() =>
      expect(service.remove).toHaveBeenCalledWith("mod-1", "a"),
    );
    expect(await screen.findByText("Exercício removido.")).toBeDefined();
  });

  it("keeps an environment for each set and saves both together (CA-04)", async () => {
    renderTab();
    await screen.findByText("Primeiro");
    const save = screen.getByRole("button", {
      name: "Salvar ambientes",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // The available set came with its environment; the reserved one has none and gets a command.
    expect(
      within(available()).getByDisplayValue("mkdir /treino"),
    ).toBeDefined();
    fireEvent.click(
      within(reserved()).getByRole("button", {
        name: "+ Adicionar comando de ambiente",
      }),
    );
    fireEvent.change(within(reserved()).getByLabelText("Comando (1)"), {
      target: { value: "mkdir /prova" },
    });
    expect(
      screen.getByText("Há alterações nos ambientes que não foram salvas."),
    ).toBeDefined();
    fireEvent.click(save);
    await waitFor(() => expect(service.setups).toHaveBeenCalled());
    const sent = service.setups.mock.calls[0]![1] as {
      exercisesSetup: { steps: unknown[] };
      assessmentSetup: { steps: unknown[] };
    };
    expect(sent.exercisesSetup.steps).toEqual([{ command: "mkdir /treino" }]);
    expect(sent.assessmentSetup.steps).toEqual([{ command: "mkdir /prova" }]);
    expect(await screen.findByText("Ambientes salvos.")).toBeDefined();
  });

  it("says so when the bank cannot be loaded, and tries again", async () => {
    service.bank.mockRejectedValueOnce(new Error("x"));
    renderTab();
    expect(
      await screen.findByText(
        "Não foi possível carregar os exercícios do módulo.",
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Primeiro")).toBeDefined();
  });
});
