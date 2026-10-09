import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeCards, moduleFingerprint, moduleTestStatus, readTest } from "@/lib/testRecord";
import type { AuthoredBlock } from "@/services/contentAuthoringService";
import { TestAll } from "./TestAll";

const run = vi.hoisted(() => ({ calls: [] as string[], failing: new Set<string>(), needs: {} as Record<string, string> }));
vi.mock("@/engine/terminalWindow", () => ({
  mountTerminalWindow: vi.fn(async () => {
    // What this machine has run so far: a command that needs another one fails until that one ran.
    const ran = new Set<string>();
    return {
      snapshot: () => ({}),
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

// Covers the test of the module (SPEC-021): the unit test of each card, then the whole module in sequence.
describe("TestAll", () => {
  it("tests each card on its own, then the module in sequence, and records every result", async () => {
    run.failing.add("b-cmd");
    const onResult = vi.fn();
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={onResult} onClose={vi.fn()} />);

    expect(await screen.findByText(/O módulo não passou/, {}, { timeout: 25000 })).toBeDefined();
    // Unit tests: card A (module, own snapshot, command) and card B (module, A's snapshot, command).
    // Then the module: the whole environment once, and the commands of A and B on the same machine.
    // Then the inverse: the same machine setup with the exercises from the last to the first.
    expect(run.calls).toEqual(["m1", "a-setup", "a-cmd", "m1", "a-setup", "b-cmd", "m1", "a-setup", "a-cmd", "b-cmd", "m1", "a-setup", "b-cmd", "a-cmd"]);
    expect(onResult).toHaveBeenCalledTimes(3);
    expect(readTest("mod-1", "a")?.passed).toBe(true);
    expect(readTest("mod-1", "b")?.passed).toBe(false);
    // A card with only text, and an inactive one, have nothing to test.
    expect(readTest("mod-1", "c")).toBeUndefined();
    expect(readTest("mod-1", "d")).toBeUndefined();
    expect(screen.getByText("Passou")).toBeDefined();
    expect(screen.getAllByText("Falhou").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Card: A")).toHaveLength(2);
    expect(screen.getAllByText("Card: B")).toHaveLength(2);
    const fp = moduleFingerprint(activeCards(blocks), { summary: "", steps: [{ command: "m1" }] });
    expect(moduleTestStatus("mod-1", fp)).toBe("failed");
    expect(moduleTestStatus("mod-1", fp + " ")).toBe("stale");
    expect(moduleTestStatus("other", fp)).toBe("untested");
  }, 40000);

  it("passes the module when every card and the sequence pass", async () => {
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/O módulo passou/, {}, { timeout: 25000 })).toBeDefined();
    const fp = moduleFingerprint(activeCards(blocks), { summary: "", steps: [{ command: "m1" }] });
    expect(moduleTestStatus("mod-1", fp)).toBe("passed");
    expect(screen.getByText(/2 de 2 cards passaram/)).toBeDefined();
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

// The inverse test: the activities that depend on others (SPEC-021).
describe("TestAll, the inverse test", () => {
  it("shows the three results, and finds no dependency when the activities are independent", async () => {
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/O módulo passou/, {}, { timeout: 25000 })).toBeDefined();
    const board = screen.getByRole("list", { name: "Resultado do teste do módulo" });
    expect(board).toHaveTextContent("Teste unitário (cada atividade sozinha)OK");
    expect(board).toHaveTextContent("Teste funcional sequencialOK");
    expect(board).toHaveTextContent("Teste inverso (dependências entre atividades)Nenhuma atividade depende de outra");
    expect(screen.queryByRole("list", { name: "Atividades que dependem de outras" })).toBeNull();
  }, 40000);

  it("finds the activity that needs what another one did", async () => {
    // B only works after A ran: alone it fails, and in the reverse order it fails too.
    run.needs = { "b-cmd": "a-cmd" };
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/O módulo não passou/, {}, { timeout: 25000 })).toBeDefined();
    const board = screen.getByRole("list", { name: "Resultado do teste do módulo" });
    expect(board).toHaveTextContent("Teste funcional sequencialOK");
    expect(board).toHaveTextContent("1 atividade depende de outras");
    const dependents = screen.getByRole("list", { name: "Atividades que dependem de outras" });
    expect(dependents).toHaveTextContent("B");
    expect(dependents).toHaveTextContent("passa na sequência e falha sozinha");
  }, 40000);

  it("needs two activities with commands to compare the order", async () => {
    const one = { blocks: blocks.slice(0, 2), setup: undefined };
    render(<TestAll moduleId="mod-1" service={service(one)} practice={practice} onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("É preciso ao menos duas atividades com comandos para comparar a ordem.", {}, { timeout: 25000 })).toBeDefined();
  }, 40000);
});
