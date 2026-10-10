import "@/test/domMatchers";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentAuthoringService } from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import type {
  ModuleExercise,
  ModuleExerciseService,
} from "@/services/moduleExerciseService";
import { ModuleExerciseScreen } from "./ModuleExerciseScreen";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
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

const stored = (extra: Partial<ModuleExercise> = {}): ModuleExercise => ({
  exercise: {
    id: "q1",
    title: "Criar a pasta",
    difficulty: "EASY",
    description: "<p>enunciado</p>",
    hints: [],
    solution: { summary: "", steps: [{ command: "mkdir /a" }] },
    conditions: [{ kind: "DIR_EXISTS", path: "/a" }],
  },
  practice: true,
  assessment: false,
  exclusive: false,
  status: "DRAFT",
  position: 1,
  mandatory: true,
  updatedAt: "2026-10-10T12:00:00Z",
  createdAt: "2026-10-10T11:00:00Z",
  createdBy: "Ana",
  updatedBy: "Ana",
  dependsOn: null,
  legacy: false,
  ...extra,
});

let service: { [K in keyof ModuleExerciseService]: ReturnType<typeof vi.fn> };
const content = { content: vi.fn() } as unknown as Pick<
  ContentAuthoringService,
  "content"
>;

beforeEach(() => {
  service = {
    bank: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    links: vi.fn(),
    remove: vi.fn(),
    order: vi.fn(),
    setup: vi.fn(),
  };
  service.bank.mockResolvedValue({
    items: [
      stored(),
      stored({
        exercise: { ...stored().exercise, id: "r", title: "Da prova" },
        practice: false,
        assessment: true,
        legacy: true,
      }),
    ],
    bankSetup: { summary: "", steps: [{ command: "mkdir /treino" }] },
  });
  vi.mocked(content.content).mockResolvedValue({
    blocks: [],
    setup: { summary: "", steps: [{ command: "mkdir /modulo" }] },
  });
});

const renderScreen = (exerciseId: string) =>
  render(
    <ModuleExerciseScreen
      moduleId="mod-1"
      exerciseId={exerciseId}
      service={service as unknown as ModuleExerciseService}
      content={content}
      practice={{ topicScenario: vi.fn().mockResolvedValue(null) }}
    />,
  );

// Covers SPEC-023: the page of one exercise of the module.
describe("ModuleExerciseScreen", () => {
  it("opens an existing exercise with a way back to the bank (CA-02)", async () => {
    renderScreen("q1");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Editar exercício do módulo",
      }),
    ).toBeDefined();
    expect(
      (screen.getByLabelText("Título do exercício (1)") as HTMLInputElement)
        .value,
    ).toBe("Criar a pasta");
    expect(screen.getByText(/O exercício mora no banco/)).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "← Exercícios do módulo" })
        .getAttribute("href"),
    ).toBe("/app/modules/mod-1/edit?tab=exercises");
    expect(
      screen.getByRole("complementary", { name: "Como o aluno vê" }),
    ).toHaveTextContent("Criar a pasta");
  });

  it("warns about what came from the initial load", async () => {
    renderScreen("r");
    await screen.findByLabelText("Título do exercício (1)");
    expect(screen.getByRole("status")).toHaveTextContent(
      "veio da carga inicial e não tem a solução gravada",
    );
  });

  it("creates a new exercise in the bank, linked to the block it came from, and goes to its page (CA-17)", async () => {
    service.create.mockResolvedValue(
      stored({ exercise: { ...stored().exercise, id: "novo" } }),
    );
    renderScreen("new");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Novo exercício do módulo",
      }),
    ).toBeDefined();
    window.history.pushState({}, "", "/app/modules/mod-1/exercises/new?link=assessment");
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), {
      target: { value: "Terceiro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.create).toHaveBeenCalled());
    expect(service.create.mock.calls[0]![1]).toMatchObject({
      title: "Terceiro",
    });
    expect(service.create.mock.calls[0]!.slice(2)).toEqual([null, { assessment: true }]);
    window.history.pushState({}, "", "/");
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/app/modules/mod-1/exercises/novo"),
    );
  });

  it("saves changes with the instant it knew, and takes the new one so the next save does not conflict (CA-08)", async () => {
    service.update.mockResolvedValue(
      stored({ updatedAt: "2026-10-10T13:00:00Z" }),
    );
    renderScreen("q1");
    await screen.findByLabelText("Título do exercício (1)");
    expect(
      (
        screen.getByRole("button", {
          name: "Salvar exercício",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), {
      target: { value: "Novo título" },
    });
    expect(screen.getByText("Há alterações não salvas.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.update).toHaveBeenCalledTimes(1));
    expect(service.update.mock.calls[0]!.slice(0, 2)).toEqual(["mod-1", "q1"]);
    expect(service.update.mock.calls[0]![3]).toBe("2026-10-10T12:00:00Z");
    expect(await screen.findByText("Exercício salvo.")).toBeDefined();
    expect(screen.queryByText("Há alterações não salvas.")).toBeNull();

    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), {
      target: { value: "Outro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    await waitFor(() => expect(service.update).toHaveBeenCalledTimes(2));
    expect(service.update.mock.calls[1]![3]).toBe("2026-10-10T13:00:00Z");
  });

  it("offers to write over when someone else changed it, and puts the errors of the server on the exercise", async () => {
    service.update.mockRejectedValueOnce(
      new ApiProblemError(
        {
          type: "validation-error",
          title: "Invalid",
          invalidParams: [{ name: "hints[0].text", reason: "required" }],
        },
        400,
      ),
    );
    renderScreen("q1");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.change(screen.getByLabelText("Título do exercício (1)"), {
      target: { value: "Outro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    expect(await screen.findByText("hints[0].text: required")).toBeDefined();
    expect(
      screen.getByText("Corrija os campos marcados antes de salvar."),
    ).toBeDefined();

    service.update.mockRejectedValueOnce(
      new ApiProblemError({ type: "block-conflict", title: "Conflict" }, 409),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
    expect(
      await screen.findByText(/foi alterado por outra pessoa/),
    ).toBeDefined();
    service.update.mockResolvedValueOnce(stored());
    fireEvent.click(screen.getByRole("button", { name: "Salvar mesmo assim" }));
    await waitFor(() => expect(service.update).toHaveBeenCalledTimes(3));
    expect(service.update.mock.calls[2]![4]).toBe(true);
  });

  it("tests the exercise on the machine of the module and of its set: the layers, the solution, and how it ends", async () => {
    const ran: string[] = [];
    mount.mockResolvedValue({
      execute: vi.fn(
        async ({ command }: { command: string }) => (
          ran.push(command),
          { status: 0, output: "" }
        ),
      ),
      loadScenario: vi.fn(async () => {}),
      setSpeed: vi.fn(),
      snapshot: vi.fn(() => ({
        raiz: {
          nome: "",
          tipo: "diretorio",
          dono: 0,
          grupo: 0,
          permissoes: "755",
          filhos: [
            {
              nome: "a",
              tipo: "diretorio",
              dono: 0,
              grupo: 0,
              permissoes: "755",
              filhos: [],
            },
          ],
        },
        contas: {
          usuarios: [{ nome: "root", uid: 0 }],
          grupos: [{ nome: "root", gid: 0 }],
        },
      })),
      history: () => [],
      destroy: vi.fn(),
    });
    renderScreen("q1");
    await screen.findByLabelText("Título do exercício (1)");
    fireEvent.click(screen.getByRole("button", { name: "Testar exercício" }));
    expect(
      await screen.findByText(
        "O exercício terminou como esperado",
        {},
        { timeout: 8000 },
      ),
    ).toBeDefined();
    // The module, then the set of the available exercises (not the one of the assessment), then the solution.
    expect(ran).toEqual(["mkdir /modulo", "mkdir /treino", "mkdir /a"]);
  }, 20000);

  // Covers SPEC-023 12.3, CA-13: an exercise can depend on another one of the bank.
  describe("an exercise that depends on another", () => {
    const second = (extra: Partial<ModuleExercise> = {}) =>
      stored({
        exercise: {
          ...stored().exercise,
          id: "q2",
          title: "Segundo",
          solution: { summary: "", steps: [{ command: "touch /a/x.sh" }] },
        },
        position: 2,
        ...extra,
      });
    const third = () =>
      stored({
        exercise: { ...stored().exercise, id: "q3", title: "Terceiro" },
        position: 3,
        dependsOn: "q2",
      });
    const option = (select: HTMLElement) => Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);

    beforeEach(() => {
      service.bank.mockResolvedValue({
        items: [stored(), second(), third()],
        bankSetup: { summary: "", steps: [{ command: "mkdir /treino" }] },
      });
    });

    it("offers the others of the bank, but not itself nor the ones that depend on it (they would close a cycle)", async () => {
      service.bank.mockResolvedValue({ items: [stored(), second({ dependsOn: "q1" }), third()] });
      renderScreen("q2");
      const select = await screen.findByLabelText("Depende do exercício");
      expect(option(select)).toEqual(["Nenhum (parte do ambiente do banco)", "Criar a pasta"]);
      cleanup();
      // q2 depends on q1 and q3 on q2: neither can be chosen by q1.
      renderScreen("q1");
      expect(option(await screen.findByLabelText("Depende do exercício"))).toEqual(["Nenhum (parte do ambiente do banco)"]);
    });

    it("is saved with the dependency, and the test builds the machine from the recipe of the one it depends on", async () => {
      const ran: string[] = [];
      mount.mockResolvedValue({
        execute: vi.fn(async ({ command }: { command: string }) => (ran.push(command), { status: 0, output: "" })),
        loadScenario: vi.fn(async () => {}),
        setSpeed: vi.fn(),
        snapshot: vi.fn(() => ({
          raiz: {
            nome: "",
            tipo: "diretorio",
            dono: 0,
            grupo: 0,
            permissoes: "755",
            filhos: [{ nome: "a", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] }],
          },
          contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
        })),
        history: () => [],
        destroy: vi.fn(),
      });
      service.update.mockResolvedValue(second({ dependsOn: "q1" }));
      renderScreen("q2");
      const select = (await screen.findByLabelText("Depende do exercício")) as HTMLSelectElement;
      expect(select.value).toBe("");
      fireEvent.change(select, { target: { value: "q1" } });
      expect(screen.getByText("Há alterações não salvas.")).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: "Testar exercício" }));
      await waitFor(() => expect(ran).toEqual(["mkdir /modulo", "mkdir /treino", "mkdir /a", "touch /a/x.sh"]), { timeout: 8000 });

      fireEvent.click(screen.getByRole("button", { name: "Salvar exercício" }));
      await waitFor(() => expect(service.update).toHaveBeenCalled());
      expect(service.update.mock.calls[0]![5]).toBe("q1");
      await waitFor(() => expect(screen.queryByText("Há alterações não salvas.")).toBeNull());
      // Back to none.
      fireEvent.change(select, { target: { value: "" } });
      expect((select as HTMLSelectElement).value).toBe("");
    }, 20000);

    it("opens with the dependency it already has", async () => {
      renderScreen("q3");
      expect(((await screen.findByLabelText("Depende do exercício")) as HTMLSelectElement).value).toBe("q2");
    });
  });

  it("says when the exercise does not exist", async () => {
    renderScreen("nada");
    expect(
      await screen.findByText(
        "Exercício não encontrado. Ele pode ter sido removido.",
      ),
    ).toBeDefined();
    cleanup();
    service.bank.mockRejectedValue(new Error("x"));
    renderScreen("q1");
    expect(
      await screen.findByText(
        "Exercício não encontrado. Ele pode ter sido removido.",
      ),
    ).toBeDefined();
  });
});
