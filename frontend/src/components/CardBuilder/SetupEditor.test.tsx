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
    // The last one asks where the terminal is, to resolve the relative paths typed in an editor.
    await waitFor(() => expect(ran).toEqual(["mkdir /home/ricardo", "mkdir /home/ricardo/financeiro", "touch /home/ricardo/financeiro/a.txt", "pwd"]));
    expect(win.execute.mock.calls.at(-2)![0]).toMatchObject({ terminal: 2 });
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
    const execute = vi.fn(async ({ command }: { command: string }) => files[command] ?? (command === "pwd" ? { status: 0, output: "/root" } : { status: 0, output: "" }));
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

  it("resolves a relative path from the folder the author went to with cd, as in the professor's case", async () => {
    const { onChange } = await record(["mkdir /home/ricardo/financeiro", "cd /home/ricardo/financeiro/", "vim teste.txt"], {
      "cat '/home/ricardo/financeiro/teste.txt'": { status: 0, output: "123123" },
    });
    expect((onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual([
      "mkdir /home/ricardo/financeiro",
      "cd /home/ricardo/financeiro/",
      "printf '%s" + String.fromCharCode(92) + "n' '123123' > '/home/ricardo/financeiro/teste.txt'",
    ]);
  });

  it("starts from the folder the terminal is in when there is no cd", async () => {
    const { onChange } = await record(["vim notas.txt"], { pwd: { status: 0, output: "/srv/app" }, "cat '/srv/app/notas.txt'": { status: 0, output: "oi" } });
    expect((onChange.mock.calls.at(-1)![0] as Setup).steps[0]!.command).toContain("> '/srv/app/notas.txt'");
  });

  it("keeps the command and warns when the folder cannot be known or the file cannot be read", async () => {
    const { onChange } = await record(["cd $HOME", "vim notas.txt", "nano /nao/existe.txt"], { "cat '/nao/existe.txt'": { status: 1, output: "No such file" } });
    expect((onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual(["cd $HOME", "vim notas.txt", "nano /nao/existe.txt"]);
    const notes = screen.getByRole("status", { name: "O que foi feito com os editores" });
    expect(notes).toHaveTextContent('"vim notas.txt" usa um caminho relativo');
    expect(notes).toHaveTextContent('Não foi possível ler o arquivo de "nano /nao/existe.txt"');
  });

  it("writes an empty file with touch", async () => {
    const { onChange } = await record(["nano /srv/vazio.txt"], { "cat '/srv/vazio.txt'": { status: 0, output: "" } });
    expect((onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual(["touch '/srv/vazio.txt'"]);
  });
});

// The snapshot must leave the student's machine as the author left theirs: both machines are compared.
const treeOf = (...files: { nome: string; conteudo: string }[]) => ({
  raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [{ nome: "srv", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: files.map((f) => ({ ...f, tipo: "arquivo", dono: 0, grupo: 0, permissoes: "644" })) }] },
  contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
});

describe("SetupEditor, the snapshot is exactly the terminal", () => {
  async function adopt(typedCommands: string[], recordedTree: unknown, replayedTree: unknown) {
    let history: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    // The first snapshot is the author's machine, when the commands are adopted; the next one is the replay.
    const snapshots = [recordedTree, replayedTree];
    const win = {
      execute: vi.fn(async ({ command }: { command: string }) => (command === "pwd" ? { status: 0, output: "/srv" } : { status: 0, output: "" })),
      setSpeed: vi.fn(),
      history: () => history,
      snapshot: vi.fn(() => snapshots.shift()),
      destroy: vi.fn(),
    };
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
    await waitFor(() => expect(view.onChange).toHaveBeenCalled(), { timeout: 5000 });
    return view;
  }

  it("adds the commands the typed ones do not reproduce, and says so", async () => {
    const onAdopted = vi.fn();
    const recorded = treeOf({ nome: "app.ini", conteudo: "porta=8080" + String.fromCharCode(10) });
    const replayed = treeOf();
    let history: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    const snapshots = [recorded, replayed];
    const win = {
      execute: vi.fn(async ({ command }: { command: string }) => (command === "pwd" ? { status: 0, output: "/srv" } : { status: 0, output: "" })),
      setSpeed: vi.fn(),
      history: () => history,
      snapshot: vi.fn(() => snapshots.shift()),
      destroy: vi.fn(),
    };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    const onChange = vi.fn();
    render(<SetupEditor before={[]} loadBase={vi.fn().mockResolvedValue(null)} onChange={onChange} onAdopted={onAdopted} />);
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    await waitFor(() => expect(mount).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Nenhum comando ainda.")).toBeDefined());
    history = ["mkdir -p /srv"];
    onCommand?.({});
    fireEvent.click(await screen.findByRole("button", { name: "Usar estes comandos" }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalled(), { timeout: 5000 });

    const steps = (onAdopted.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command);
    expect(steps).toEqual(["mkdir -p /srv", "printf '%s" + String.fromCharCode(92) + "n' 'porta=8080' > '/srv/app.ini'"]);
    expect(screen.getByRole("status", { name: "O que foi feito com os editores" })).toHaveTextContent("Para ficar exatamente como no terminal, foram acrescentados 1 comando ao fim da lista");
    // The replay machine was built from the commands, in a window of its own that is destroyed.
    expect(win.destroy).toHaveBeenCalled();
  });

  it("adds nothing when the replay is already the same machine", async () => {
    const tree = treeOf({ nome: "a.txt", conteudo: "x" + String.fromCharCode(10) });
    const view = await adopt(["touch /srv/a.txt"], tree, tree);
    await waitFor(() => expect(view.onChange).toHaveBeenCalled());
    expect((view.onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual(["touch /srv/a.txt"]);
    expect(screen.queryByText(/Para ficar exatamente/)).toBeNull();
  });

  it("says what cannot be reproduced by a command", async () => {
    const recorded = treeOf({ nome: "b.txt", conteudo: "sem quebra" });
    const view = await adopt(["touch /srv/b.txt"], recorded, treeOf());
    await waitFor(() => expect(view.onChange).toHaveBeenCalled());
    expect(await screen.findByText(/Não dá para reproduzir por comando: \/srv\/b.txt: o arquivo não termina com quebra de linha/)).toBeDefined();
  });

  it("warns, and still keeps the commands, when the replay cannot be checked", async () => {
    const view = await adopt(["touch /srv/c.txt"], treeOf(), "not a machine");
    await waitFor(() => expect(view.onChange).toHaveBeenCalled());
    expect((view.onChange.mock.calls.at(-1)![0] as Setup).steps.map((s) => s.command)).toEqual(["touch /srv/c.txt"]);
    expect(await screen.findByText(/Não foi possível conferir se o ambiente reproduz exatamente o terminal/)).toBeDefined();
  });
});
