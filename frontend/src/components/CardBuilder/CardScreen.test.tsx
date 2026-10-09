import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { CardScreen } from "./CardScreen";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const executed = vi.hoisted(() => [] as string[]);
vi.mock("@/engine/terminalWindow", () => ({
  mountTerminalWindow: vi.fn(async () => ({
    snapshot: () => ({}),
    history: () => [],
    destroy: vi.fn(),
    setSpeed: vi.fn(),
    execute: vi.fn(async ({ command }: { command: string }) => {
      executed.push(command);
      return { status: 0, output: "" };
    }),
  })),
}));
vi.mock("@/services/practiceService", () => ({ practiceService: { topicScenario: async () => ({}) } }));
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  executed.length = 0;
  vi.clearAllMocks();
});

const block = (id: string, type: string, position: number, payload: Record<string, unknown>): AuthoredBlock => ({
  id,
  type,
  position,
  payload,
  edited: false,
  active: true,
  updatedAt: "2026-10-09T12:00:00Z",
});

const blocks = [
  block("i1", "LEGACY_HTML", 1, { html: "<p>Boas-vindas</p>" }),
  block("h1", "TEXT", 2, { title: "Atualizar", command: "apt update", html: "<p>Texto</p>" }),
];

let service: { [K in keyof ContentAuthoringService]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  service = { list: vi.fn(), content: vi.fn(), setModuleSetup: vi.fn(), versions: vi.fn(), publish: vi.fn(), restore: vi.fn(), saveCard: vi.fn(), setCardActive: vi.fn(), reorder: vi.fn() };
  service.content.mockResolvedValue({ blocks, setup: undefined });
});

const api = () => service as unknown as ContentAuthoringService;

describe("CardScreen", () => {
  it("opens an empty form to create a card, with a way back to the list", async () => {
    render(<CardScreen moduleId="mod-1" afterId="h1" service={api()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Novo card" })).toBeDefined();
    expect(screen.getByRole("link", { name: "← Conteúdo do módulo" }).getAttribute("href")).toBe("/app/modules/mod-1/edit?tab=content");
    expect((screen.getByLabelText("Título principal do card") as HTMLInputElement).value).toBe("");
  });

  it("opens the card the address names, with its stored values (CA-26)", async () => {
    render(<CardScreen moduleId="mod-1" cardKey="h1" service={api()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Editar card" })).toBeDefined();
    await waitFor(() => expect((screen.getByLabelText("Título principal do card") as HTMLInputElement).value).toBe("Atualizar"));
    expect((screen.getByLabelText("Tag / Pill (badge)") as HTMLInputElement).value).toBe("apt update");
  });

  it("calls the introduction by its name", async () => {
    render(<CardScreen moduleId="mod-1" cardKey="i1" service={api()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Editar introdução" })).toBeDefined();
  });

  it("says so when the card does not exist or the blocks cannot be read", async () => {
    render(<CardScreen moduleId="mod-1" cardKey="gone" service={api()} />);
    expect(await screen.findByText("Card não encontrado. Ele pode ter sido removido.")).toBeDefined();
    cleanup();

    service.content.mockRejectedValueOnce(new Error("x"));
    render(<CardScreen moduleId="mod-1" cardKey="h1" service={api()} />);
    expect(await screen.findByText("Card não encontrado. Ele pode ter sido removido.")).toBeDefined();
  });

  it("goes back to the content tab on Cancel and opens the new card after creating it", async () => {
    service.saveCard.mockResolvedValue([block("n1", "TEXT", 3, { title: "Novo", html: "" })]);
    render(<CardScreen moduleId="mod-1" service={api()} />);
    await screen.findByRole("heading", { level: 1, name: "Novo card" });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(push).toHaveBeenCalledWith("/app/modules/mod-1/edit?tab=content");

    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/modules/mod-1/cards/n1"));
  });
});

describe("CardScreen, the snapshots that run before a card (SPEC-021 RN-03)", () => {
  const step = (command: string) => ({ steps: [{ command }] });
  const withSetups = [
    block("a", "TEXT", 1, { title: "A", html: "", setup: step("a1") }),
    block("b", "TEXT", 2, { title: "B", html: "" }),
    block("c", "TEXT", 3, { title: "C", html: "", setup: step("c1") }),
  ];

  async function testOf(props: { cardKey?: string; afterId?: string }) {
    service.content.mockResolvedValue({ blocks: withSetups, setup: step("m1") });
    render(<CardScreen moduleId="mod-1" service={api()} {...props} />);
    await screen.findByLabelText("Título principal do card");
    fireEvent.click(screen.getByRole("button", { name: "Testar comandos" }));
    await waitFor(() => expect(screen.getByText(/Ambiente preparado|Conflito/)).toBeDefined());
    return [...executed];
  }

  it("runs the snapshot of the module and then those of the cards above, when editing", async () => {
    expect(await testOf({ cardKey: "b" })).toEqual(["m1", "a1"]);
  });

  it("runs all the earlier snapshots for a card added at the end, and only the ones above for a card added in the middle", async () => {
    expect(await testOf({})).toEqual(["m1", "a1", "c1"]);
    cleanup();
    executed.length = 0;
    expect(await testOf({ afterId: "b" })).toEqual(["m1", "a1"]);
  });

  it("puts the own snapshot of the card last", async () => {
    expect(await testOf({ cardKey: "c" })).toEqual(["m1", "a1", "c1"]);
  });
});
