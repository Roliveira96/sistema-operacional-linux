import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { CardScreen } from "./CardScreen";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn(async () => ({ snapshot: () => ({}), history: () => [], destroy: vi.fn() })) }));
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
  service = { list: vi.fn(), saveCard: vi.fn(), setCardActive: vi.fn(), reorder: vi.fn(), createEnvironment: vi.fn(), getEnvironment: vi.fn() };
  service.list.mockResolvedValue(blocks);
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

    service.list.mockRejectedValueOnce(new Error("x"));
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

describe("CardScreen, the environment a card starts from (SPEC-020 RN-03)", () => {
  const env = (id: string) => ({ scenarioId: id });
  const withEnvs = [
    block("a", "TEXT", 1, { title: "A", html: "", environment: env("env-a") }),
    block("b", "TEXT", 2, { title: "B", html: "" }),
    block("c", "TEXT", 3, { title: "C", html: "", environment: env("env-c") }),
  ];

  async function openTerminalOf(props: { cardKey?: string; afterId?: string }) {
    service.list.mockResolvedValue(withEnvs);
    service.getEnvironment = vi.fn().mockResolvedValue({ formato: "m" });
    render(<CardScreen moduleId="mod-1" service={api()} {...props} />);
    const title = await screen.findByLabelText("Título principal do card");
    // The environment is kept in the card header, so a new card needs its title first.
    if (!props.cardKey) fireEvent.change(title, { target: { value: "Novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" }));
  }

  it("uses the environment of the closest earlier card when editing", async () => {
    await openTerminalOf({ cardKey: "b" });
    await waitFor(() => expect(service.getEnvironment).toHaveBeenCalledWith("env-a"));
  });

  it("uses the last environment of the module for a card added at the end, and the one before the place for a card added after another", async () => {
    await openTerminalOf({});
    await waitFor(() => expect(service.getEnvironment).toHaveBeenCalledWith("env-c"));
    cleanup();
    await openTerminalOf({ afterId: "b" });
    await waitFor(() => expect(service.getEnvironment).toHaveBeenCalledWith("env-a"));
  });
});
