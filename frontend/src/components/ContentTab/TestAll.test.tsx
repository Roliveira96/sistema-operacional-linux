import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeCards, moduleFingerprint, moduleTestStatus, readTest } from "@/lib/testRecord";
import type { AuthoredBlock } from "@/services/contentAuthoringService";
import { TestAll } from "./TestAll";

const run = vi.hoisted(() => ({ calls: [] as string[], failing: new Set<string>() }));
vi.mock("@/engine/terminalWindow", () => ({
  mountTerminalWindow: vi.fn(async () => ({
    snapshot: () => ({}),
    history: () => [],
    destroy: vi.fn(),
    setSpeed: vi.fn(),
    execute: vi.fn(async ({ command }: { command: string }) => {
      run.calls.push(command);
      return { status: run.failing.has(command) ? 1 : 0, output: "" };
    }),
  })),
}));

beforeEach(() => {
  localStorage.clear();
  run.calls.length = 0;
  run.failing.clear();
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
    expect(run.calls).toEqual(["m1", "a-setup", "a-cmd", "m1", "a-setup", "b-cmd", "m1", "a-setup", "a-cmd", "b-cmd"]);
    expect(onResult).toHaveBeenCalledTimes(3);
    expect(readTest("mod-1", "a")?.passed).toBe(true);
    expect(readTest("mod-1", "b")?.passed).toBe(false);
    // A card with only text, and an inactive one, have nothing to test.
    expect(readTest("mod-1", "c")).toBeUndefined();
    expect(readTest("mod-1", "d")).toBeUndefined();
    expect(screen.getByText("Passou")).toBeDefined();
    expect(screen.getByText("Falhou")).toBeDefined();
    expect(screen.getByText("Card: A")).toBeDefined();
    expect(screen.getByText("Card: B")).toBeDefined();
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
