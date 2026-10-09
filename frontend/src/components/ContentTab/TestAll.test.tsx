import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTest } from "@/lib/testRecord";
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
const service = (content: unknown = { blocks, setup: { steps: [{ command: "m1" }] } }) => ({ content: vi.fn().mockResolvedValue(content) });

// Covers the "testar todas as atividades" button of the content tab (SPEC-021).
describe("TestAll", () => {
  it("tests each card with commands in turn, on the snapshots above it, and records every result", async () => {
    run.failing.add("b-cmd");
    const onResult = vi.fn();
    render(<TestAll moduleId="mod-1" service={service()} practice={practice} onResult={onResult} onClose={vi.fn()} />);

    expect(await screen.findByText(/de 2 cards passaram/, {}, { timeout: 15000 })).toBeDefined();
    // Card A: module, then its own snapshot, then its command. Card B: module and A's snapshot, then its command.
    expect(run.calls).toEqual(["m1", "a-setup", "a-cmd", "m1", "a-setup", "b-cmd"]);
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(readTest("mod-1", "a")?.passed).toBe(true);
    expect(readTest("mod-1", "b")?.passed).toBe(false);
    // A card with only text, and an inactive one, have nothing to test.
    expect(readTest("mod-1", "c")).toBeUndefined();
    expect(readTest("mod-1", "d")).toBeUndefined();
    expect(screen.getByText("Passou")).toBeDefined();
    expect(screen.getByText("Falhou")).toBeDefined();
    expect(screen.getByRole("status")).toHaveTextContent("1 de 2 cards passaram");
  }, 30000);

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
