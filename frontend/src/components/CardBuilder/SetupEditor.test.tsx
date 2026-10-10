import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/test/domMatchers";
import { useState } from "react";
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

// The snapshot must leave the student's machine as the author left theirs: both machines are compared, and what the commands
// do not reproduce goes in as a file with its text exactly as it is, or as a command (SPEC-021 RN-12).
const treeOf = (...files: { nome: string; conteudo: string; dono?: number }[]) => ({
  raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: [{ nome: "srv", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos: files.map((f) => ({ nome: f.nome, conteudo: f.conteudo, tipo: "arquivo", dono: f.dono ?? 0, grupo: 0, permissoes: "644" })) }] },
  contas: { usuarios: [{ nome: "root", uid: 0 }], grupos: [{ nome: "root", gid: 0 }] },
});
const NL = String.fromCharCode(10);

describe("SetupEditor, the snapshot is exactly the terminal", () => {
  /** Records `typedCommands` in a terminal whose machine is `recordedTree`; the machine built again from the list is `replayedTree`. */
  async function adopt(typedCommands: string[], recordedTree: unknown, replayedTree: unknown) {
    let history: string[] = [];
    let onCommand: ((snapshot: unknown) => void) | undefined;
    // The first snapshot is the author's machine, when the commands are adopted; the next one is the replay.
    const snapshots = [recordedTree, replayedTree];
    const win = {
      execute: vi.fn(async () => ({ status: 0, output: "" })),
      setSpeed: vi.fn(),
      history: () => history,
      snapshot: vi.fn(() => snapshots.shift()),
      destroy: vi.fn(),
    };
    mount.mockImplementation(async (_c: HTMLElement, _s: unknown, callbacks: { onCommand(s: unknown): void }) => {
      onCommand = callbacks.onCommand;
      return win;
    });
    const onAdopted = vi.fn();
    const onChange = vi.fn();
    // The editor shows what it is given, as the screens that hold it do.
    function Harness() {
      const [value, setValue] = useState<Setup | undefined>();
      return (
        <SetupEditor
          setup={value}
          before={[]}
          loadBase={vi.fn().mockResolvedValue(null)}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
          onAdopted={onAdopted}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Gravar no terminal" }));
    await waitFor(() => expect(mount).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Nenhum comando ainda.")).toBeDefined());
    history = typedCommands;
    onCommand?.({});
    await waitFor(() => expect((screen.getByRole("button", { name: "Usar estes comandos" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Usar estes comandos" }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalled(), { timeout: 5000 });
    return { onChange, onAdopted, win, adopted: onAdopted.mock.calls.at(-1)![0] as Setup };
  }
  const notes = () => screen.getByRole("status", { name: "O que foi feito com os editores" });

  it("adds a file the typed commands do not reproduce, with its text as it is, and says so", async () => {
    const text = "porta=8080" + NL + "caminho=C:" + String.fromCharCode(92) + "dados" + NL;
    const { adopted, win } = await adopt(["mkdir -p /srv"], treeOf({ nome: "app.ini", conteudo: text }), treeOf());
    expect(adopted.steps.map((s) => s.command)).toEqual(["mkdir -p /srv"]);
    expect(adopted.files).toEqual([{ path: "/srv/app.ini", content: text, mode: "644", owner: "root", group: "root" }]);
    expect(notes()).toHaveTextContent("Para ficar exatamente como no terminal, foram acrescentados 1 arquivo com o texto como está.");
    // The window the replay was built in is destroyed.
    expect(win.destroy).toHaveBeenCalled();
    // The files are listed, with their size, and can be removed.
    expect(screen.getByRole("list", { name: "Arquivos do ambiente (1)" })).toHaveTextContent("/srv/app.ini");
  });

  it("leaves the editor sessions out of the list: their text comes in as the file", async () => {
    const recorded = treeOf({ nome: "teste.txt", conteudo: "123123" + NL });
    const { adopted } = await adopt(["mkdir -p /srv", "vim /srv/teste.txt", "nano notas.txt", "tee /srv/t.txt"], recorded, treeOf());
    expect(adopted.steps.map((s) => s.command)).toEqual(["mkdir -p /srv"]);
    expect(adopted.files?.map((f) => [f.path, f.content])).toEqual([["/srv/teste.txt", "123123" + NL]]);
    expect(notes()).toHaveTextContent("3 sessões de editor (nano, vim, tee…) não viram comando: o texto que você escreveu entra como arquivo");
  });

  it("adds nothing when the replay is already the same machine", async () => {
    const tree = treeOf({ nome: "a.txt", conteudo: "x" + NL });
    const { adopted } = await adopt(["touch /srv/a.txt"], tree, tree);
    expect(adopted.steps.map((s) => s.command)).toEqual(["touch /srv/a.txt"]);
    expect(adopted.files).toBeUndefined();
    expect(screen.queryByText(/Para ficar exatamente/)).toBeNull();
  });

  it("adds the commands for folders, permissions and owners, apart from the files", async () => {
    const recorded = treeOf();
    (recorded.raiz.filhos[0] as { filhos: unknown[] }).filhos.push({ nome: "dados", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "700", filhos: [] });
    const { adopted } = await adopt(["touch /srv/x"], recorded, treeOf());
    expect(adopted.steps.map((s) => s.command)).toEqual(["touch /srv/x", "mkdir -p '/srv/dados'", "chmod 700 '/srv/dados'"]);
    expect(notes()).toHaveTextContent("foram acrescentados 2 comandos (pastas, permissões, donos ou links)");
  });

  it("says what cannot be reproduced", async () => {
    const { adopted } = await adopt(["touch /srv/b.txt"], treeOf({ nome: "b.txt", conteudo: "x" + NL, dono: 4242 }), treeOf());
    expect(adopted.files).toBeUndefined();
    expect(notes()).toHaveTextContent("Não dá para reproduzir por comando: /srv/b.txt: o dono (4242:0) não tem nome na máquina.");
  });

  it("removes a file from the snapshot", async () => {
    const { onChange } = await adopt(["mkdir -p /srv"], treeOf({ nome: "a.txt", conteudo: "x" + NL }), treeOf());
    fireEvent.click(screen.getByRole("button", { name: "Remover o arquivo /srv/a.txt" }));
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ files: [] });
  });

  it("warns, and still keeps the commands, when the replay cannot be checked", async () => {
    const { adopted } = await adopt(["touch /srv/c.txt"], treeOf(), "not a machine");
    expect(adopted.steps.map((s) => s.command)).toEqual(["touch /srv/c.txt"]);
    expect(notes()).toHaveTextContent("Não foi possível conferir se o ambiente reproduz exatamente o terminal");
  });
});

// The professor can change the files of the snapshot whenever they want: edit, add, load from the computer, remove.
describe("SetupEditor, the files of the snapshot are editable", () => {
  function renderEditor(initial?: Setup) {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<Setup | undefined>(initial);
      return (
        <SetupEditor
          setup={value}
          before={[]}
          loadBase={vi.fn().mockResolvedValue(null)}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Harness />);
    return onChange;
  }
  const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0] as Setup;
  const NEWLINE = String.fromCharCode(10);

  it("edits the path, the mode, the owner and the text of a file", () => {
    const script = "#!/bin/bash" + NEWLINE + "echo oi" + NEWLINE;
    const onChange = renderEditor({ summary: "", steps: [], files: [{ path: "/home/ricardo/financeiro/teste.sh", content: script, mode: "755", owner: "root", group: "root" }] });
    expect(screen.getByRole("list", { name: "Arquivos do ambiente (1)" })).toHaveTextContent("/home/ricardo/financeiro/teste.sh");

    fireEvent.change(screen.getByLabelText("Conteúdo do arquivo (1)"), { target: { value: script + "echo tchau" + NEWLINE } });
    expect(last(onChange).files![0]!.content).toBe(script + "echo tchau" + NEWLINE);
    fireEvent.change(screen.getByLabelText("Caminho do arquivo (1)"), { target: { value: "/srv/novo.sh" } });
    fireEvent.change(screen.getByLabelText("Permissão (octal) (1)"), { target: { value: "700" } });
    fireEvent.change(screen.getByLabelText("Dono (1)"), { target: { value: "ricardo" } });
    fireEvent.change(screen.getByLabelText("Grupo (1)"), { target: { value: "ricardo" } });
    expect(last(onChange).files).toEqual([{ path: "/srv/novo.sh", content: script + "echo tchau" + NEWLINE, mode: "700", owner: "ricardo", group: "ricardo" }]);
  });

  it("adds a file, warns about a path that is not absolute, and removes a file", () => {
    const onChange = renderEditor({ summary: "", steps: [], files: [{ path: "/a.txt", content: "a" }] });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar arquivo" }));
    expect(last(onChange).files).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Caminho do arquivo (2)"), { target: { value: "relativo.txt" } });
    expect(screen.getByText(/O caminho precisa começar por \//)).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: /Remover/ })[0]!);
    expect(last(onChange).files).toEqual([{ path: "relativo.txt", content: "" }]);
  });

  it("loads a text file of the computer as a file of the snapshot, replacing the one with the same path", async () => {
    const onChange = renderEditor({ summary: "", steps: [], files: [{ path: "/teste.sh", content: "velho" }] });
    const input = screen.getByLabelText("Carregar arquivo do computador") as HTMLInputElement;
    const text = "#!/bin/bash" + NEWLINE + 'echo "olá"' + NEWLINE;
    fireEvent.change(input, { target: { files: [new File([text], "teste.sh", { type: "text/x-shellscript" })] } });
    await waitFor(() => expect(last(onChange).files).toEqual([{ path: "/teste.sh", content: text }]));
  });

  it("refuses a file that is too large or not text", async () => {
    renderEditor({ summary: "", steps: [], files: [] });
    const input = screen.getByLabelText("Carregar arquivo do computador") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a".repeat(1048577)], "enorme.log")] } });
    expect(await screen.findByText('"enorme.log" passa de 1 MB, o limite por arquivo.')).toBeDefined();
    fireEvent.change(input, { target: { files: [new File(["a" + String.fromCharCode(0) + "b"], "binario.bin")] } });
    expect(await screen.findByText('"binario.bin" não é um arquivo de texto.')).toBeDefined();
  });

  it("does not let the permission, the owner and the group take anything outside what is expected", () => {
    const onChange = renderEditor({ summary: "", steps: [], files: [{ path: "/a.sh", content: "x" }] });
    const mode = screen.getByLabelText("Permissão (octal) (1)") as HTMLInputElement;
    expect(mode.maxLength).toBe(4);
    for (const [typed, kept] of [["888", ""], ["8888", ""], ["abc123", "123"], ["64a4", "644"], ["75555", "7555"]] as const) {
      fireEvent.change(mode, { target: { value: typed } });
      expect(last(onChange).files![0]!.mode, typed).toBe(kept);
    }
    // An incomplete permission is told, a complete one is not.
    fireEvent.change(mode, { target: { value: "64" } });
    expect(screen.getByText(/A permissão tem 3 ou 4 números, cada um de 0 a 7/)).toBeDefined();
    fireEvent.change(mode, { target: { value: "644" } });
    expect(screen.queryByText(/A permissão tem 3 ou 4 números/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Dono (1)"), { target: { value: "Ana Maria!" } });
    fireEvent.change(screen.getByLabelText("Grupo (1)"), { target: { value: "1../adm" } });
    expect(last(onChange).files![0]).toMatchObject({ owner: "anamaria", group: "adm" });
  });
});
