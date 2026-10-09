import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleSetupTab } from "./ModuleSetupTab";

vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
afterEach(cleanup);

const practice = { topicScenario: vi.fn().mockResolvedValue(null) };
const make = (content: unknown) => ({ content: vi.fn().mockResolvedValue(content), setModuleSetup: vi.fn() });

// Covers SPEC-021 RN-01 and CA-01: the snapshot of the module.
describe("ModuleSetupTab", () => {
  it("shows the snapshot of the module, saves a change and tells it was saved", async () => {
    const service = make({ blocks: [], setup: { summary: "s", steps: [{ command: "mkdir /x" }] } });
    service.setModuleSetup.mockResolvedValue({ summary: "s", steps: [{ command: "mkdir /y" }] });
    render(<ModuleSetupTab moduleId="m1" service={service as never} practice={practice} />);

    const input = (await screen.findByLabelText("Comando (1)")) as HTMLInputElement;
    expect(input.value).toBe("mkdir /x");
    const save = screen.getByRole("button", { name: "Salvar ambiente" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "mkdir /y" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent("Ambiente do módulo salvo.");
    expect(service.setModuleSetup).toHaveBeenCalledWith("m1", { summary: "s", steps: [{ command: "mkdir /y" }] });
    await waitFor(() => expect(save.disabled).toBe(true));
  });

  it("starts empty when the module has none, and says so when it cannot save or load", async () => {
    const service = make({ blocks: [], setup: undefined });
    service.setModuleSetup.mockRejectedValue(new Error("x"));
    render(<ModuleSetupTab moduleId="m1" service={service as never} practice={practice} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Adicionar comando de ambiente" }));
    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "ls" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ambiente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar o ambiente do módulo.");
    cleanup();

    const broken = { content: vi.fn().mockRejectedValue(new Error("x")), setModuleSetup: vi.fn() };
    render(<ModuleSetupTab moduleId="m1" service={broken as never} practice={practice} />);
    expect(await screen.findByText("Não foi possível carregar o ambiente do módulo.")).toBeDefined();
  });

  it("saves on the server at once what the author records in the terminal, so the students get it", async () => {
    const mount = (await import("@/engine/terminalWindow")).mountTerminalWindow as unknown as ReturnType<typeof vi.fn>;
    let history: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    const tree = { raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [] }, contas: { usuarios: [], grupos: [] } };
    const win = {
      execute: vi.fn(async () => ({ status: 0, output: "" })),
      setSpeed: vi.fn(),
      history: () => history,
      snapshot: vi.fn(() => tree),
      destroy: vi.fn(),
    };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    const service = make({ blocks: [], setup: undefined });
    service.setModuleSetup.mockImplementation(async (_id: string, setup: unknown) => setup);
    render(<ModuleSetupTab moduleId="m1" service={service as never} practice={practice} />);

    fireEvent.click(await screen.findByRole("button", { name: "Gravar no terminal" }));
    await waitFor(() => expect(mount).toHaveBeenCalled());
    history = ["mkdir -p /home/ricardo/financeiro"];
    onCommand?.({});
    await waitFor(() => expect((screen.getByRole("button", { name: "Usar estes comandos" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));

    await waitFor(() => expect(service.setModuleSetup).toHaveBeenCalledWith("m1", { summary: "", steps: [{ command: "mkdir -p /home/ricardo/financeiro" }] }), { timeout: 5000 });
    expect(await screen.findByText(/salvo no servidor/)).toBeDefined();
  });
});
