import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeCards, moduleFingerprint, moduleTestStatus, readTest } from "@/lib/testRecord";
import type { AuthoredBlock } from "@/services/contentAuthoringService";
import { TestAll } from "./TestAll";

const run = vi.hoisted(() => ({ calls: [] as string[], failing: new Set<string>(), needs: {} as Record<string, string>, machine: {} as unknown }));
vi.mock("@/engine/terminalWindow", () => ({
  mountTerminalWindow: vi.fn(async () => {
    // What this machine has run so far: a command that needs another one fails until that one ran.
    const ran = new Set<string>();
    return {
      snapshot: () => run.machine,
      loadScenario: vi.fn(async () => {}),
      history: () => [],
      destroy: vi.fn(),
      setSpeed: vi.fn(),
      execute: vi.fn(async ({ command }: { command: string }) => {
        run.calls.push(command);
        const needed = run.needs[command];
        ran.add(command);
        return { status: run.failing.has(command) || (needed && !ran.has(needed)) ? 1 : 0, output: "" };
      }),
    };
  }),
}));

beforeEach(() => {
  localStorage.clear();
  run.calls.length = 0;
  run.failing.clear();
  run.needs = {};
  run.machine = {};
});
afterEach(cleanup);

const block = (id: string, type: string, position: number, payload: Record<string, unknown>, active = true): AuthoredBlock => ({ id, type, position, payload, edited: false, active, updatedAt: "2026-10-09T12:00:00Z" });
const blocks = [
  block("a", "TEXT", 1, { title: "A", html: "", setup: { steps: [{ command: "a-setup" }] } }),
  block("a2", "COMMAND", 2, { steps: [{ command: "a-cmd" }] }),
  block("b", "TEXT", 3, { title: "B", html: "" }),
  block("b2", "COMMAND", 4, { steps: [{ command: "b-cmd" }] }),
  block("c", "TEXT", 5, { title: "C", html: "<p>só texto</p>" }),
  block("d", "TEXT", 6, { title: "D", html: "", setup: { steps: [{ command: "d-setup" }] } }, false),
  block("d2", "COMMAND", 7, { steps: [{ command: "d-cmd" }] }, false),
];
const practice = { topicScenario: vi.fn().mockResolvedValue({}) };
const service = (content: unknown = { blocks, setup: { summary: "", steps: [{ command: "m1" }] } }) => ({ content: vi.fn().mockResolvedValue(content) });

const DONE = /Módulo (aprovado|reprovado)/;
const steps = () => screen.getByRole("tablist", { name: "Etapas do teste do módulo" });
const totals = () => screen.getByLabelText("Total de testes");

// Covers the test of the module (SPEC-021): each activity alone, the whole module in sequence, and the reverse order.
describe("TestAll", () => {
  it("runs the three steps, records every result, and says what went wrong and where", async () => {
    run.failing.add("b-cmd");
    const onResult = vi.fn();
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={onResult} onClose={vi.fn()} />);

    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo reprovado");
    // Unit: card A (module, own snapshot, command) and card B (module, A's snapshot, command).
    // Sequence: the whole environment once, then the commands of A and B on the same machine.
    // Inverse: the same environment, then B and A.
    expect(run.calls).toEqual(["m1", "a-setup", "a-cmd", "m1", "a-setup", "b-cmd", "m1", "a-setup", "a-cmd", "b-cmd", "m1", "a-setup", "b-cmd", "a-cmd"]);
    expect(onResult).toHaveBeenCalledTimes(3);
    expect(readTest("mod-1", "a")?.passed).toBe(true);
    expect(readTest("mod-1", "b")?.passed).toBe(false);
    // A card with only text, and an inactive one, have nothing to test.
    expect(readTest("mod-1", "c")).toBeUndefined();
    expect(readTest("mod-1", "d")).toBeUndefined();

    expect(steps()).toHaveTextContent("1. Cada atividade sozinha1 de 2 atividades passaram");
    expect(steps()).toHaveTextContent("2. Módulo em sequência1 de 2 comandos como esperado");
    const problems = screen.getByRole("alert", { name: "O que precisa de atenção" });
    expect(problems).toHaveTextContent('BSozinha, falhou no comando "b-cmd".');
    expect(problems).toHaveTextContent('BNa sequência, falhou no comando "b-cmd".');

    const fp = moduleFingerprint(activeCards(blocks), { summary: "", steps: [{ command: "m1" }] });
    expect(moduleTestStatus("mod-1", fp)).toBe("failed");
    expect(moduleTestStatus("mod-1", fp + " ")).toBe("stale");
    expect(moduleTestStatus("other", fp)).toBe("untested");
  }, 40000);

  it("says what the test covers, so no card is left out without notice: the inactive ones and the ones with nothing to run", async () => {
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByLabelText("Cobertura do teste")).toHaveTextContent(
      "2 de 4 cards têm o que testar e foram testados · 1 inativo (o aluno não vê, não é testado) · 1 sem comandos, snapshot nem exercícios (nada a testar)",
    );
  });

  it("shows how many tests were done: the activities alone, the commands in sequence and the commands in reverse order", async () => {
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo aprovado");
    // 2 activities + 2 commands + 2 commands.
    expect(totals()).toHaveTextContent("Testes feitos: 6 · passaram: 6 · falharam: 0");
    expect(totals()).toHaveTextContent("2 atividades sozinhas + 2 comandos em sequência + 2 comandos na ordem inversa");
  }, 40000);

  it("counts the tests that failed", async () => {
    run.failing.add("a-cmd");
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo reprovado");
    // A fails alone, in the sequence and in reverse: 3 failed tests of 6.
    expect(totals()).toHaveTextContent("Testes feitos: 6 · passaram: 3 · falharam: 3");
  }, 40000);

  it("approves the module when every card and the sequence pass, and no activity depends on another", async () => {
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo aprovado");
    expect(steps()).toHaveTextContent("1. Cada atividade sozinha2 de 2 atividades passaram");
    expect(steps()).toHaveTextContent("3. Dependências (ordem inversa)Nenhuma atividade depende de outra");
    expect(screen.queryByRole("alert", { name: "O que precisa de atenção" })).toBeNull();
    const fp = moduleFingerprint(activeCards(blocks), { summary: "", steps: [{ command: "m1" }] });
    expect(moduleTestStatus("mod-1", fp)).toBe("passed");
  }, 40000);

  it("lets the author open the detail of another step", async () => {
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(DONE, {}, { timeout: 30000 });
    const [units, sequence] = screen.getAllByRole("tab");
    // Everything passed, so the first step is the one on screen.
    expect(units).toHaveAttribute("aria-selected", "true");
    fireEvent.click(sequence!);
    expect(sequence).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Uma máquina nova: o ambiente e, em seguida/)).toBeDefined();
  }, 40000);

  it("says when nothing can be tested, when the cards cannot be loaded, and can be closed", async () => {
    const onClose = vi.fn();
    render(<TestAll moduleId="m" service={service({ blocks: [block("c", "TEXT", 1, { title: "C", html: "x" })], setup: undefined })} practice={practice} onResult={vi.fn()} onClose={onClose} />);
    expect(await screen.findByText("Nenhum card tem comandos ou snapshot para testar.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
    cleanup();

    const broken = { content: vi.fn().mockRejectedValue(new Error("x")) };
    render(<TestAll moduleId="m" service={broken} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os cards para testar."));
  });
});

// The inverse test: the activities that depend on others.
describe("TestAll, the activities that depend on others", () => {
  it("finds the activity that needs what another one did", async () => {
    // B only works after A ran: alone it fails, and in the reverse order it fails too.
    run.needs = { "b-cmd": "a-cmd" };
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo reprovado");
    expect(steps()).toHaveTextContent("2. Módulo em sequência2 de 2 comandos como esperado");
    expect(steps()).toHaveTextContent("1 atividade depende de outras");
    expect(screen.getByRole("alert", { name: "O que precisa de atenção" })).toHaveTextContent("Passa na sequência e falha sozinha: depende do que outra atividade fez.");
  }, 40000);

  it("needs two activities with commands to compare the order", async () => {
    const one = { blocks: blocks.slice(0, 2), setup: undefined };
    render(<TestAll moduleId="mod-1" service={service(one)} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toBeDefined();
    expect(steps()).toHaveTextContent("São necessárias ao menos duas atividades com comandos.");
  }, 40000);
});

// Covers SPEC-022 RN-09: the test of the module also runs the exercises and the snapshot of their group.
describe("TestAll, the exercises", () => {
  const machineWith = (...folders: string[]) => ({
    raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: folders.map((nome) => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] })) },
    contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
  });
  const withExercises = [
    block("a", "TEXT", 1, { title: "A", html: "" }),
    block("a2", "COMMAND", 2, { steps: [{ command: "a-cmd" }] }),
    block("a3", "EXERCISES", 3, { items: [{ title: "Criar a pasta", difficulty: "EASY", solution: { steps: [{ command: "mkdir /srv" }] }, conditions: [{ kind: "DIR_EXISTS", path: "/srv" }] }], setup: { steps: [{ command: "base" }] } }),
  ];
  const content = { blocks: withExercises, setup: undefined };

  it("runs the base of the group, then the commands of the card, then the solution, and checks how it ended", async () => {
    run.machine = machineWith("srv");
    render(<TestAll moduleId="mod-1" service={service(content)} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo aprovado");
    // Unit: base, a-cmd, the solution. Sequence: the same. One card only, so no inverse run.
    expect(run.calls).toEqual(["base", "a-cmd", "mkdir /srv", "base", "a-cmd", "mkdir /srv"]);
    expect(totals()).toHaveTextContent("Testes feitos: 4 · passaram: 4 · falharam: 0");
    expect(readTest("mod-1", "a")?.passed).toBe(true);
  }, 40000);

  it("fails the card, and says which exercise, when the exercise does not end as expected", async () => {
    run.machine = machineWith();
    render(<TestAll moduleId="mod-1" service={service(content)} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo reprovado");
    expect(readTest("mod-1", "a")?.passed).toBe(false);
    expect(screen.getByRole("alert", { name: "O que precisa de atenção" })).toHaveTextContent("A");
  }, 40000);

  it("fails the module when an exercise has no recorded solution, instead of skipping it", async () => {
    run.machine = machineWith("srv");
    const untested = [
      block("a", "TEXT", 1, { title: "A", html: "" }),
      block("a2", "COMMAND", 2, { steps: [{ command: "a-cmd" }] }),
      block("a3", "EXERCISES", 3, { items: [{ title: "Sem gravar", difficulty: "EASY" }] }),
    ];
    render(<TestAll moduleId="mod-1" service={service({ blocks: untested, setup: undefined })} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(DONE, {}, { timeout: 30000 })).toHaveTextContent("Módulo reprovado");
    expect(readTest("mod-1", "a")?.passed).toBe(false);
    // The commands ran; the exercise was not run, and it did not go unnoticed.
    expect(run.calls).toEqual(["a-cmd", "a-cmd"]);
  }, 40000);

  it("marks the card as stale when only an exercise changes", async () => {
    const { testStatus } = await import("@/lib/testRecord");
    const { parseCard, groupCards } = await import("@/lib/cardModel");
    const card = parseCard(groupCards(withExercises)[0]!);
    expect(testStatus("mod-1", "a", card)).toBe("untested");
    const { saveTest } = await import("@/lib/testRecord");
    saveTest("mod-1", "a", true, card);
    expect(testStatus("mod-1", "a", card)).toBe("passed");
    card.exercises!.items[0]!.conditions = [];
    expect(testStatus("mod-1", "a", card)).toBe("stale");
  });
});
