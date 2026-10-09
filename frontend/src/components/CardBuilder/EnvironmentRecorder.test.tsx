import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@/test/domMatchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardEnvironment } from "@/lib/cardModel";
import { EnvironmentRecorder } from "./EnvironmentRecorder";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

afterEach(() => {
  cleanup();
  mount.mockReset();
});

let typed: string[];
let onCommand: ((snapshot: unknown) => void) | undefined;
const terminal = () => ({
  snapshot: vi.fn(() => ({ formato: "exame-so/maquina", feito: typed.length })),
  history: vi.fn(() => [...typed]),
  destroy: vi.fn(),
});

beforeEach(() => {
  typed = ["ls"]; // what the machine already had in its history
  mount.mockImplementation(async (_container: HTMLElement, _snapshot: unknown, callbacks: { onCommand(s: unknown): void }) => {
    onCommand = callbacks.onCommand;
    return terminal();
  });
});

const service = () => ({ createEnvironment: vi.fn().mockResolvedValue("scenario-1") });

function setup(props: { environment?: CardEnvironment; hasTitle?: boolean; loadBase?: () => Promise<unknown> } = {}) {
  const onChange = vi.fn();
  const svc = service();
  const loadBase = props.loadBase ?? vi.fn().mockResolvedValue({ formato: "base" });
  render(<EnvironmentRecorder moduleId="m1" hasTitle={props.hasTitle ?? true} environment={props.environment} loadBase={loadBase} onChange={onChange} service={svc} />);
  return { onChange, svc, loadBase };
}

/** Opens the terminal and waits until it is ready to be recorded. */
async function openTerminal() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Gravar ambiente" }) as HTMLButtonElement).disabled).toBe(false));
}

const type = (command: string) => {
  typed.push(command);
  onCommand?.({});
};

describe("EnvironmentRecorder", () => {
  it("asks for a title first, because the environment is kept in the card header (CA-02)", () => {
    setup({ hasTitle: false });
    expect((screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Dê um título ao card antes/)).toBeDefined();
  });

  it("starts the terminal on the machine it was given and lists what is typed, not what was there (CA-01)", async () => {
    const { loadBase } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" }));
    expect(screen.getByText("Preparando máquina…")).toBeDefined();
    await waitFor(() => expect(mount).toHaveBeenCalled());
    expect(loadBase).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "base" });
    expect(await screen.findByText("Nenhum comando ainda.")).toBeDefined();

    type("mkdir /financeiro");
    type("useradd ana");
    await waitFor(() => expect(screen.getByText("useradd ana")).toBeDefined());
    expect(screen.getByText("mkdir /financeiro")).toBeDefined();
    expect(screen.queryByText("ls")).toBeNull();
  });

  it("records the final state of the machine and hands the environment to the card (CA-02)", async () => {
    const { onChange, svc } = setup();
    await openTerminal();
    type("mkdir /financeiro");
    fireEvent.change(screen.getByLabelText("Resumo do cenário preparado"), { target: { value: " pasta pronta " } });

    fireEvent.click(screen.getByRole("button", { name: "Gravar ambiente" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(svc.createEnvironment).toHaveBeenCalledWith("m1", { formato: "exame-so/maquina", feito: 2 });
    expect(onChange).toHaveBeenCalledWith({ scenarioId: "scenario-1", summary: "pasta pronta", commands: ["mkdir /financeiro"] });
    // The terminal closes after recording.
    expect(screen.queryByRole("button", { name: "Gravar ambiente" })).toBeNull();
  });

  it("says so when the machine cannot be recorded, and keeps the terminal open", async () => {
    const { onChange, svc } = setup();
    svc.createEnvironment.mockRejectedValue(new Error("x"));
    await openTerminal();
    fireEvent.click(screen.getByRole("button", { name: "Gravar ambiente" }));
    expect(await screen.findByText("Não foi possível gravar o ambiente.")).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Gravar ambiente" })).toBeDefined();
  });

  it("says so when the starting machine cannot be loaded, and cancels without recording", async () => {
    const { onChange } = setup({ loadBase: vi.fn().mockRejectedValue(new Error("x")) });
    fireEvent.click(screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" }));
    expect(await screen.findByText("Não foi possível carregar a máquina para preparar o ambiente.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Abrir terminal para preparar o ambiente" })).toBeDefined();
  });

  it("shows a recorded environment, lets it be prepared again or removed", async () => {
    const environment: CardEnvironment = { scenarioId: "s", summary: "pasta pronta", commands: ["mkdir /x", "useradd ana"] };
    const { onChange, loadBase } = setup({ environment });
    expect(screen.getByRole("status")).toHaveTextContent("Ambiente gravado (2 comandos digitados)");
    expect(screen.getByText("pasta pronta")).toBeDefined();
    fireEvent.click(screen.getByText("Comandos digitados no terminal 1"));
    const list = screen.getByRole("list");
    expect(within(list).getByText("useradd ana")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remover ambiente" }));
    expect(onChange).toHaveBeenCalledWith(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Preparar de novo" }));
    await waitFor(() => expect(loadBase).toHaveBeenCalled());
    expect((screen.getByLabelText("Resumo do cenário preparado") as HTMLInputElement).value).toBe("pasta pronta");
  });
});
