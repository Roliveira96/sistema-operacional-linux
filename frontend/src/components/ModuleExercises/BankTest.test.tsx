import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sandbox } from "@/lib/bankTest";
import type { ExerciseBank, ModuleExercise } from "@/services/moduleExerciseService";
import { BankTest, bankItems } from "./BankTest";

const engine = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/bankTestEngine", () => ({ createEngineSandbox: engine.create }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A tiny machine: "mk /a/b" makes a folder and fails when the parent does not exist.
function fakeSandbox(): Sandbox {
  let dirs = new Set<string>(["/"]);
  return {
    reset: async () => void (dirs = new Set(["/"])),
    solve: async (setup) => {
      for (const step of setup.steps) {
        const path = step.command.replace("mk ", "");
        if (!dirs.has(path.slice(0, path.lastIndexOf("/")) || "/")) return false;
        dirs.add(path);
      }
      return true;
    },
    holds: (conditions) => conditions.every((c) => dirs.has((c as { path: string }).path)),
  };
}

const item = (id: string, path: string | null, extra: Partial<ModuleExercise> = {}): ModuleExercise => ({
  exercise: {
    id,
    title: `Ex ${id}`,
    difficulty: "EASY",
    description: "",
    hints: [],
    solution: path ? { summary: "", steps: [{ command: `mk ${path}` }] } : undefined,
    conditions: path ? [{ kind: "DIR_EXISTS", path }] : [],
  },
  practice: true,
  assessment: false,
  exclusive: false,
  status: "PUBLISHED",
  position: 1,
  mandatory: true,
  updatedAt: "2026-10-10T12:00:00Z",
  createdAt: "",
  createdBy: "",
  updatedBy: "",
  dependsOn: null,
  legacy: false,
  ...extra,
});

const soundBank = (): ExerciseBank => ({ items: [item("a", "/a", { position: 1 }), item("b", "/b", { position: 2 })] });
// b builds inside the folder of a and does not say so.
const dependentBank = (): ExerciseBank => ({ items: [item("a", "/a", { position: 1 }), item("b", "/a/b", { position: 2 }), item("z", "/z", { practice: false })] });

const update = vi.fn();
const onClose = vi.fn();
const onChanged = vi.fn();
const renderTest = (bank: ExerciseBank) =>
  render(<BankTest moduleId="mod-1" bank={bank} moduleSetup={{ summary: "", steps: [{ command: "mk /m" }] }} loadBase={vi.fn().mockResolvedValue(null)} service={{ update }} onClose={onClose} onChanged={onChanged} />);

beforeEach(() => {
  engine.create.mockResolvedValue({ sandbox: fakeSandbox(), conflicts: [], destroy: vi.fn() });
  update.mockResolvedValue(undefined);
});

// Covers SPEC-023 12 (CA-12, CA-14, CA-16): the button runs the batteries and the report offers the dependencies it found.
describe("BankTest", () => {
  it("takes the published exercises in the order of the trail, then the others", () => {
    const bank: ExerciseBank = {
      items: [item("x", "/x", { practice: false, position: 0 }), item("b", "/b", { position: 2 }), item("a", "/a", { position: 1 }), item("d", "/d", { status: "DRAFT" })],
    };
    expect(bankItems(bank).map((i) => i.id)).toEqual(["a", "b", "x"]);
  });

  it("prepares the machine from the snapshot of the module and the one of the bank, then reports success with the seed", async () => {
    renderTest({ ...soundBank(), bankSetup: { summary: "", steps: [{ command: "mk /treino" }] } });
    expect(screen.getByText(/Preparando o ambiente/)).toBeDefined();
    expect(await screen.findByText("Banco aprovado: todos os exercícios passaram nas três baterias.")).toBeDefined();
    const layers = engine.create.mock.calls[0]![1] as { id: string }[];
    expect(layers.map((l) => l.id)).toEqual(["module", "bank"]);
    expect(screen.getByText(/Semente do sorteio: \d+/)).toBeDefined();
    fireEvent.click(screen.getByText("Rodadas"));
    expect(screen.getByText("Rodada 1: 1. Ordem linear")).toBeDefined();
    expect(screen.getAllByText(/Ex a/).length).toBeGreaterThan(0);
  });

  it("does not start the batteries when a snapshot fails, and says which command", async () => {
    engine.create.mockResolvedValue({ sandbox: null, conflicts: [{ layer: { label: "Módulo" }, step: { command: "mkdir /x" } }], destroy: vi.fn() });
    renderTest(soundBank());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/as baterias não rodaram/);
    expect(alert).toHaveTextContent("Módulo: mkdir /x");
  });

  it("says when the terminal of the test cannot be mounted", async () => {
    engine.create.mockRejectedValue(new Error("x"));
    renderTest(soundBank());
    expect(await screen.findByText("Não foi possível montar o terminal do teste.")).toBeDefined();
  });

  it("says when there is nothing published to test", async () => {
    renderTest({ items: [item("d", "/d", { status: "DRAFT" })] });
    expect(await screen.findByText("Não há exercícios publicados no banco para testar.")).toBeDefined();
  });

  it("shows the dependency it found and lets the teacher confirm it, which saves the exercise depending on the other (CA-14)", async () => {
    renderTest(dependentBank());
    expect(await screen.findByText("Banco com falhas: veja abaixo o que precisa de atenção.")).toBeDefined();
    const dependencies = screen.getByRole("region", { name: "Dependências" });
    expect(within(dependencies).getByText("O exercício [Ex b] possui dependência do exercício [Ex a]")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Exercícios que falharam em alguma bateria" })).getByText("Ex b")).toBeDefined();
    fireEvent.click(within(dependencies).getByRole("button", { name: "Confirmar vínculo" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toBe("mod-1");
    expect(update.mock.calls[0]![1]).toBe("b");
    expect(update.mock.calls[0]![3]).toBe("2026-10-10T12:00:00Z");
    expect(update.mock.calls[0]![4]).toBe(false);
    expect(update.mock.calls[0]![5]).toBe("a");
    expect(await screen.findByText("Vínculo confirmado. Teste de novo para conferir.")).toBeDefined();
    expect(onChanged).toHaveBeenCalled();
    expect(within(dependencies).queryByRole("button", { name: "Confirmar vínculo" })).toBeNull();
  });

  it("dismisses a suggestion without saving anything, and says when the confirmation could not be saved", async () => {
    renderTest(dependentBank());
    const dependencies = await screen.findByRole("region", { name: "Dependências" });
    fireEvent.click(within(dependencies).getByRole("button", { name: "Descartar" }));
    expect(update).not.toHaveBeenCalled();
    expect(within(dependencies).queryByText(/possui dependência/)).toBeNull();
    cleanup();

    update.mockRejectedValueOnce(new Error("x"));
    renderTest(dependentBank());
    fireEvent.click(within(await screen.findByRole("region", { name: "Dependências" })).getByRole("button", { name: "Confirmar vínculo" }));
    expect(await screen.findByText("Não foi possível confirmar o vínculo.")).toBeDefined();
  });

  it("lists the declared dependencies, and the draw takes the antecessor along", async () => {
    const bank: ExerciseBank = { items: [item("a", "/a", { position: 1 }), item("b", "/a/b", { position: 2, dependsOn: "a" })] };
    renderTest(bank);
    expect(await screen.findByText("Banco aprovado: todos os exercícios passaram nas três baterias.")).toBeDefined();
    expect(screen.getByText("[Ex b] depende de [Ex a]")).toBeDefined();
  });

  it("lists what has no solution as failing the test, and runs again on request", async () => {
    renderTest({ items: [item("a", "/a"), item("s", null)] });
    const region = await screen.findByRole("region", { name: /Sem solução ou sem condições gravadas/ });
    expect(within(region).getByText("Ex s")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Testar de novo" }));
    await waitFor(() => expect(engine.create).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("region", { name: /Sem solução ou sem condições gravadas/ })).toBeDefined();
  });

  it("closes with the button and with Escape", async () => {
    renderTest(soundBank());
    await screen.findByText(/Banco aprovado/);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
