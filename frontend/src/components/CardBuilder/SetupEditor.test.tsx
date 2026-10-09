import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/test/domMatchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Setup, SetupLayer } from "@/lib/setup";
import { SetupEditor } from "./SetupEditor";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

afterEach(() => {
  cleanup();
  mount.mockReset();
});

function setup(props: { setup?: Setup; before?: SetupLayer[]; loadBase?: () => Promise<unknown> } = {}) {
  const onChange = vi.fn();
  const loadBase = props.loadBase ?? vi.fn().mockResolvedValue({ formato: "base" });
  render(<SetupEditor setup={props.setup} before={props.before ?? []} loadBase={loadBase} onChange={onChange} />);
  return { onChange, loadBase };
}

const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0] as Setup | undefined;

// Covers SPEC-021 RN-01 and CA-02 to CA-04: the steps of a snapshot.
describe("SetupEditor, the list of steps", () => {
  it("adds, changes, moves and removes steps and sets the terminal, login and answers", () => {
    const { onChange } = setup({ setup: { summary: "s", steps: [{ command: "a" }, { command: "b" }] } });

    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "mkdir /x" } });
    expect(last(onChange)).toEqual({ summary: "s", steps: [{ command: "mkdir /x" }, { command: "b" }] });

    fireEvent.change(screen.getByLabelText("Terminal (2)"), { target: { value: "3" } });
    expect(last(onChange)!.steps[1]).toEqual({ command: "b", terminal: 3 });

    fireEvent.change(screen.getByLabelText("Usuário (terminais 2 e 3) (2)"), { target: { value: "ana" } });
    expect(last(onChange)!.steps[1]!.login).toEqual({ user: "ana", password: "" });
    fireEvent.change(screen.getByLabelText("Respostas às perguntas do comando (uma por linha) (1)"), { target: { value: "sim" + String.fromCharCode(10) + "não" } });
    expect(last(onChange)!.steps[0]!.answers).toEqual(["sim", "não"]);

    fireEvent.click(screen.getByRole("button", { name: "Descer comando de ambiente (1)" }));
    expect(last(onChange)!.steps.map((s) => s.command)).toEqual(["b", "a"]);
    fireEvent.click(screen.getByRole("button", { name: "Remover comando de ambiente (2)" }));
    expect(last(onChange)!.steps.map((s) => s.command)).toEqual(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar comando de ambiente" }));
    expect(last(onChange)!.steps).toHaveLength(3);
  });

  it("starts empty, and the whole snapshot can be removed", () => {
    const { onChange } = setup();
    expect(screen.getByText("Nenhum comando de ambiente.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remover o ambiente" })).toBeNull();
    cleanup();
    const again = setup({ setup: { summary: "", steps: [{ command: "a" }] } });
    fireEvent.click(screen.getByRole("button", { name: "Remover o ambiente" }));
    expect(again.onChange).toHaveBeenCalledWith(undefined);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SetupEditor, recording in the terminal", () => {
  it("replays the earlier snapshots, then lists only what the author types and adds it as steps (CA-03, CA-04)", async () => {
    let typed: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    const win = { execute: vi.fn(async () => ({ status: 0, output: "" })), setSpeed: vi.fn(), history: () => ["m1", ...typed], destroy: vi.fn() };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    const before: SetupLayer[] = [{ id: "module", kind: "module", label: "Módulo", setup: { summary: "", steps: [{ command: "m1" }] } }];
    const { onChange, loadBase } = setup({ setup: { summary: "", steps: [{ command: "a" }] }, before });

    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    await waitFor(() => expect(win.execute).toHaveBeenCalledWith(expect.objectContaining({ command: "m1" })));
    expect(loadBase).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "base" });
    expect(await screen.findByText("Nenhum comando ainda.")).toBeDefined();
    expect((screen.getByRole("button", { name: "Usar estes comandos" }) as HTMLButtonElement).disabled).toBe(true);

    typed = ["mkdir /financeiro", "useradd ana"];
    onCommand?.({});
    await waitFor(() => expect(screen.getByText("useradd ana")).toBeDefined());
    expect(screen.queryByText("m1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));
    expect(last(onChange)!.steps.map((s) => s.command)).toEqual(["a", "mkdir /financeiro", "useradd ana"]);
    expect(screen.queryByRole("button", { name: "Usar estes comandos" })).toBeNull();
  });

  it("names the earlier snapshot command that fails (CA-06)", async () => {
    mount.mockResolvedValue({ execute: vi.fn(async () => ({ status: 1, output: "x" })), setSpeed: vi.fn(), history: () => [], destroy: vi.fn() });
    const before: SetupLayer[] = [{ id: "c1", kind: "card", label: "Usuários", setup: { summary: "", steps: [{ command: "useradd ana" }] } }];
    setup({ before });
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    expect(await screen.findByText(/Conflito em "Usuários": o comando "useradd ana" deu erro/)).toBeDefined();
  });

  it("says so when the machine cannot be loaded, and can be cancelled", async () => {
    setup({ loadBase: vi.fn().mockRejectedValue(new Error("x")) });
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    expect(await screen.findByText("Não foi possível carregar a máquina.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Gravar no terminal" })).toBeDefined();
  });
});

// The commands already on the list run in the terminal before the author types anything.
describe("SetupEditor, the commands above the recording", () => {
  it("runs the earlier snapshots and then the commands already on the list, and records only what is typed after them", async () => {
    let history: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    const ran: string[] = [];
    const win = {
      execute: vi.fn(async ({ command }: { command: string }) => {
        ran.push(command);
        history = [...history, command];
        return { status: 0, output: "" };
      }),
      setSpeed: vi.fn(),
      history: () => history,
      destroy: vi.fn(),
    };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    const before: SetupLayer[] = [{ id: "module", kind: "module", label: "Módulo", setup: { summary: "", steps: [{ command: "mkdir /home/ricardo" }] } }];
    const { onChange } = setup({ before, setup: { summary: "", steps: [{ command: "mkdir /home/ricardo/financeiro" }, { command: "touch /home/ricardo/financeiro/a.txt", terminal: 2 }] } });

    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    await waitFor(() => expect(ran).toEqual(["mkdir /home/ricardo", "mkdir /home/ricardo/financeiro", "touch /home/ricardo/financeiro/a.txt"]));
    expect(win.execute.mock.calls.at(-1)![0]).toMatchObject({ terminal: 2 });
    await waitFor(() => expect(screen.queryByText(/Preparando a máquina com o módulo/)).toBeNull());
    expect(screen.getByText("Nenhum comando ainda.")).toBeDefined();

    history = [...history, "ls /home/ricardo/financeiro"];
    onCommand?.({});
    expect(await screen.findByText("ls /home/ricardo/financeiro")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect((onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual(["mkdir /home/ricardo/financeiro", "touch /home/ricardo/financeiro/a.txt", "ls /home/ricardo/financeiro"]);
  });

  it("names the command above that fails, as a conflict", async () => {
    mount.mockResolvedValue({ execute: vi.fn(async () => ({ status: 1, output: "x" })), setSpeed: vi.fn(), history: () => [], destroy: vi.fn() });
    setup({ setup: { summary: "", steps: [{ command: "mkdir /ja/existe" }] } });
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    expect(await screen.findByText(/Conflito em "Comandos acima, neste ambiente": o comando "mkdir \/ja\/existe" deu erro/)).toBeDefined();
  });
});

// The text an author types inside an editor while recording is read from the file and kept as printf.
describe("SetupEditor, files written with an editor", () => {
  async function record(typedCommands: string[], files: Record<string, { status: number; output: string }>) {
    let onCommand: ((snapshot: unknown) => void) | undefined;
    const execute = vi.fn(async ({ command }: { command: string }) => files[command] ?? { status: 0, output: "" });
    let history: string[] = [];
    const win = { execute, setSpeed: vi.fn(), history: () => history, destroy: vi.fn() };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    await waitFor(() => expect(mount).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Nenhum comando ainda.")).toBeDefined());
    history = typedCommands;
    onCommand?.({});
    await waitFor(() => expect((screen.getByRole("button", { name: "Usar estes comandos" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));
    await waitFor(() => expect(view.onChange).toHaveBeenCalled());
    return { ...view, execute };
  }

  it("turns a nano session into the printf that writes what was typed, and says so", async () => {
    const { onChange, execute } = await record(["mkdir -p /home/ricardo/utfpr/teste", "nano /home/ricardo/utfpr/teste/ricardo.txt"], {
      "cat '/home/ricardo/utfpr/teste/ricardo.txt'": { status: 0, output: "maçã" + String.fromCharCode(10) + "banana" },
    });
    const steps = (onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command);
    expect(steps).toEqual(["mkdir -p /home/ricardo/utfpr/teste", "printf '%s" + String.fromCharCode(92) + "n' 'maçã' 'banana' > '/home/ricardo/utfpr/teste/ricardo.txt'"]);
    expect(execute).toHaveBeenCalledWith({ command: "cat '/home/ricardo/utfpr/teste/ricardo.txt'" });
    expect(screen.getByRole("status", { name: "O que foi feito com os editores" })).toHaveTextContent("virou printf: grava em /home/ricardo/utfpr/teste/ricardo.txt o texto que você digitou");
  });

  it("keeps the command and warns when the path is relative or the file cannot be read", async () => {
    const { onChange } = await record(["vim notas.txt", "nano /nao/existe.txt"], { "cat '/nao/existe.txt'": { status: 1, output: "No such file" } });
    expect((onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual(["vim notas.txt", "nano /nao/existe.txt"]);
    const notes = screen.getByRole("status", { name: "O que foi feito com os editores" });
    expect(notes).toHaveTextContent('"vim notas.txt" usa caminho relativo');
    expect(notes).toHaveTextContent('Não foi possível ler o arquivo de "nano /nao/existe.txt"');
  });

  it("writes an empty file with touch", async () => {
    const { onChange } = await record(["nano /srv/vazio.txt"], { "cat '/srv/vazio.txt'": { status: 0, output: "" } });
    expect((onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual(["touch '/srv/vazio.txt'"]);
  });
});
