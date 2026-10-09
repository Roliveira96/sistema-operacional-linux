import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardCommand } from "@/lib/cardModel";
import type { SetupLayer } from "@/lib/setup";
import { CardTester, judge } from "./CardTester";
import "@/test/domMatchers";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));

afterEach(() => {
  cleanup();
  mount.mockReset();
});

const cmd = (command: string, extra: Partial<CardCommand> = {}): CardCommand => ({
  id: command || "empty",
  terminal: 1,
  expectError: false,
  command,
  explanation: "",
  outputExplanation: "",
  answers: [],
  ...extra,
});

type Outcome = { status: number | null; output?: string };
let outcomes: Outcome[];
let execute: ReturnType<typeof vi.fn>;
let loadScenario: ReturnType<typeof vi.fn>;
let calls: string[];

beforeEach(() => {
  outcomes = [];
  calls = [];
  execute = vi.fn(async (step: { command: string }) => {
    calls.push(`execute ${step.command}`);
    const next = outcomes.shift() ?? { status: 0 };
    return { status: next.status, output: next.output ?? "" };
  });
  loadScenario = vi.fn(async () => {});
  mount.mockImplementation(async () => ({ execute, loadScenario, setSpeed: vi.fn(), snapshot: vi.fn(), history: vi.fn(() => []), destroy: vi.fn() }));
});

const layer = (kind: "module" | "card", label: string, ...commands: string[]): SetupLayer => ({ id: label, kind, label, setup: { summary: "", steps: commands.map((command) => ({ command })) } });

const setup = (commands: CardCommand[], extra: { loadBase?: () => Promise<unknown>; layers?: SetupLayer[]; onFinish?: (passed: boolean) => void } = {}) => {
  const onClose = vi.fn();
  const loadBase = extra.loadBase ?? vi.fn().mockResolvedValue({ formato: "base" });
  render(<CardTester commands={commands} loadBase={loadBase} layers={extra.layers ?? []} onClose={onClose} onFinish={extra.onFinish} />);
  return { onClose, loadBase };
};

/** The summary line, which appears when the test is over. */
const summary = () => screen.findByText(/\d+ de \d+ comandos? como esperado|nenhum comando rodou/);

const row = (n: number, command: string) => screen.getByRole("listitem", { name: `Comando ${n}: ${command}` });

describe("judge", () => {
  it("compares the exit status with what the author expects (RN-08)", () => {
    expect(judge(0, false)).toEqual({ kind: "ok" });
    expect(judge(1, true)).toEqual({ kind: "okError" });
    expect(judge(127, false)).toEqual({ kind: "unexpectedError", code: 127 });
    expect(judge(0, true)).toEqual({ kind: "expectedErrorMissing" });
    expect(judge(null, false)).toEqual({ kind: "notRun" });
  });
});

describe("CardTester", () => {
  it("runs every command in order, in its terminal and with its login, and tells how each ended (CA-10, CA-11)", async () => {
    outcomes = [{ status: 0 }, { status: 2, output: "ls: cannot access '/nao-existe'" }, { status: 1 }, { status: 0 }, { status: null }];
    const commands = [
      cmd("mkdir /x"),
      cmd("ls /nao-existe"),
      cmd("curl http://localhost", { expectError: true }),
      cmd("whoami", { expectError: true, terminal: 2, login: { user: "ana", password: "123" } }),
      cmd("passwd ana", { answers: ["nova", "nova", ""] }),
    ];
    const { loadBase } = setup(commands);

    expect(await summary()).toHaveTextContent("2 de 5 comandos como esperado");
    expect(loadBase).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "base" });
    expect(execute.mock.calls.map(([step]) => step.command)).toEqual(["mkdir /x", "ls /nao-existe", "curl http://localhost", "whoami", "passwd ana"]);
    expect(execute.mock.calls[3]![0]).toMatchObject({ terminal: 2, login: { user: "ana", password: "123" } });
    expect(execute.mock.calls[4]![0].answers).toEqual(["nova", "nova"]);

    expect(within(row(1, "mkdir /x")).getByText("Como esperado")).toBeDefined();
    expect(within(row(2, "ls /nao-existe")).getByText("Deu erro (código 2) e não era esperado")).toBeDefined();
    expect(within(row(3, "curl http://localhost")).getByText("Deu erro, como esperado")).toBeDefined();
    expect(within(row(4, "whoami")).getByText("Era para dar erro e não deu")).toBeDefined();
    expect(within(row(5, "passwd ana")).getByText("Não rodou")).toBeDefined();
    expect(await summary()).toHaveTextContent("Há comandos fora do esperado");
  });

  it("shows what the terminal said when a command fails", async () => {
    outcomes = [{ status: 0, output: "criado" }, { status: 1, output: "cat: /nao-existe: No such file or directory" }, { status: 1, output: "saída de um erro esperado" }];
    setup([cmd("touch /a"), cmd("cat /nao-existe"), cmd("false", { expectError: true })]);
    await summary();
    expect(within(row(2, "cat /nao-existe")).getByText("O terminal disse:")).toBeDefined();
    expect(within(row(2, "cat /nao-existe")).getByText("cat: /nao-existe: No such file or directory")).toBeDefined();
    // What went as expected needs no explanation.
    expect(within(row(1, "touch /a")).queryByText("criado")).toBeNull();
    expect(within(row(3, "false")).queryByText("O terminal disse:")).toBeNull();
  });

  it("starts from a clean machine, runs the snapshots of the module and the cards in order, and only then the commands (SPEC-021 CA-05)", async () => {
    setup([cmd("ls /financeiro")], { layers: [layer("module", "Módulo", "mkdir /financeiro", "useradd ana"), layer("card", "Card A", "touch /financeiro/a")] });

    expect(await summary()).toHaveTextContent("1 de 1 comando como esperado");
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "base" });
    expect(calls).toEqual(["execute mkdir /financeiro", "execute useradd ana", "execute touch /financeiro/a", "execute ls /financeiro"]);
    expect(loadScenario).not.toHaveBeenCalled();
    expect(screen.getByRole("listitem", { name: "Preparar o ambiente (snapshots)" })).toHaveTextContent("Ambiente preparado");
  });

  it("reports the snapshot command that failed as a conflict, says what the terminal said and does not run the commands (SPEC-021 CA-06)", async () => {
    outcomes = [{ status: 0 }, { status: 1, output: "mkdir: cannot create directory '/financeiro': File exists" }];
    setup([cmd("ls"), cmd("pwd")], { layers: [layer("module", "Módulo", "mkdir /a"), layer("card", "Card A", "mkdir /financeiro")] });

    expect(await screen.findByText(/nenhum comando rodou/)).toBeDefined();
    expect(calls).toEqual(["execute mkdir /a", "execute mkdir /financeiro"]);
    const env = screen.getByRole("listitem", { name: "Preparar o ambiente (snapshots)" });
    expect(env).toHaveTextContent("Conflito: 1 comando do snapshot deu erro");
    expect(env).toHaveTextContent('Snapshot do card "Card A": o comando "mkdir /financeiro" deu erro.');
    expect(within(env).getByText("mkdir: cannot create directory '/financeiro': File exists")).toBeDefined();
    expect(screen.getAllByText("Não rodou: o ambiente deu conflito")).toHaveLength(2);
  });

  it("names the module when its snapshot is the one that failed, and lists every conflict", async () => {
    outcomes = [{ status: 1, output: "x" }, { status: 0 }, { status: 2, output: "y" }];
    setup([cmd("ls")], { layers: [layer("module", "Módulo", "bad1", "good"), layer("card", "Card A", "bad2")] });
    await screen.findByText(/nenhum comando rodou/);
    const env = screen.getByRole("listitem", { name: "Preparar o ambiente (snapshots)" });
    expect(env).toHaveTextContent("Conflito: 2 comandos do snapshot deram erro");
    expect(env).toHaveTextContent('Snapshot do módulo: o comando "bad1" deu erro.');
    expect(env).toHaveTextContent('Snapshot do card "Card A": o comando "bad2" deu erro.');
  });

  it("has no snapshot row when there is no snapshot", async () => {
    setup([cmd("ls")]);
    await summary();
    expect(screen.queryByRole("listitem", { name: "Preparar o ambiente (snapshots)" })).toBeNull();
  });

  it("says the environment serves the student when everything ended as expected", async () => {
    outcomes = [{ status: 0 }, { status: 1 }];
    setup([cmd("touch /a"), cmd("cat /nao", { expectError: true })]);
    expect(await summary()).toHaveTextContent("2 de 2 comandos como esperado. Tudo como esperado. O ambiente serve ao aluno.");
  });

  it("tells whether the test passed, only when it ran to the end", async () => {
    const onFinish = vi.fn();
    outcomes = [{ status: 0 }, { status: 1 }];
    setup([cmd("touch /a"), cmd("cat /nao", { expectError: true })], { onFinish });
    await summary();
    expect(onFinish).toHaveBeenCalledExactlyOnceWith(true);
    cleanup();

    const failed = vi.fn();
    outcomes = [{ status: 1 }];
    setup([cmd("cat /nao")], { onFinish: failed });
    await summary();
    expect(failed).toHaveBeenCalledExactlyOnceWith(false);
    cleanup();

    const conflict = vi.fn();
    outcomes = [{ status: 1 }];
    setup([cmd("ls")], { onFinish: conflict, layers: [layer("module", "Módulo", "bad")] });
    await screen.findByText(/nenhum comando rodou/);
    expect(conflict).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("marks an empty command without running it", async () => {
    setup([cmd("ls"), cmd("   ", { id: "blank" })]);
    await summary();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Comando vazio")).toBeDefined();
    expect(await summary()).toHaveTextContent("1 de 2 comandos como esperado");
  });

  it("can be stopped, and what was left is shown as not run (CA-12)", async () => {
    let release: (result: { status: number; output: string }) => void = () => {};
    execute.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    setup([cmd("sleep 1"), cmd("ls"), cmd("pwd")]);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    release({ status: 0, output: "" });

    expect(await summary()).toHaveTextContent("1 de 3 comandos como esperado");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Parado antes de rodar")).toHaveLength(2);
  });

  it("runs again on a fresh terminal, preparing the snapshots again, and closes", async () => {
    const { onClose } = setup([cmd("ls")], { layers: [layer("module", "Módulo", "mkdir /x")] });
    await summary();
    expect(execute).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Rodar de novo" }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    await summary();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["execute mkdir /x", "execute ls", "execute mkdir /x", "execute ls"]);

    fireEvent.click(screen.getByRole("button", { name: "Fechar teste" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when the machine of the test cannot be loaded", async () => {
    setup([cmd("ls")], { loadBase: vi.fn().mockRejectedValue(new Error("x")) });
    expect(await screen.findByText("Não foi possível carregar a máquina do teste.")).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
