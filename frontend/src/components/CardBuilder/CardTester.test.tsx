import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardCommand } from "@/lib/cardModel";
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
  loadScenario = vi.fn(async () => {
    calls.push("loadScenario");
  });
  mount.mockImplementation(async () => ({ execute, loadScenario, setSpeed: vi.fn(), snapshot: vi.fn(), history: vi.fn(() => []), destroy: vi.fn() }));
});

const setup = (commands: CardCommand[], extra: { loadBase?: () => Promise<unknown>; loadEnvironment?: () => Promise<unknown> } = {}) => {
  const onClose = vi.fn();
  const loadBase = extra.loadBase ?? vi.fn().mockResolvedValue({ formato: "base" });
  render(<CardTester commands={commands} loadBase={loadBase} loadEnvironment={extra.loadEnvironment} onClose={onClose} />);
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

  it("starts from a clean machine, loads the snapshot of the card, and only then runs the commands", async () => {
    const loadEnvironment = vi.fn().mockResolvedValue({ formato: "do-card" });
    setup([cmd("ls /financeiro")], { loadEnvironment });

    expect(await summary()).toHaveTextContent("1 de 1 comando como esperado");
    expect(mount.mock.calls[0]![1]).toEqual({ formato: "base" });
    expect(loadEnvironment).toHaveBeenCalledTimes(1);
    expect(loadScenario).toHaveBeenCalledWith({ formato: "do-card" });
    expect(calls).toEqual(["loadScenario", "execute ls /financeiro"]);
    expect(screen.getByRole("listitem", { name: "Preparar o ambiente (snapshot)" })).toHaveTextContent("Ambiente preparado");
  });

  it("does not run the commands when the snapshot cannot be prepared, and says so", async () => {
    setup([cmd("ls"), cmd("pwd")], { loadEnvironment: vi.fn().mockRejectedValue(new Error("x")) });
    expect(await screen.findByText(/nenhum comando rodou/)).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("listitem", { name: "Preparar o ambiente (snapshot)" })).toHaveTextContent("Não foi possível preparar o ambiente");
    expect(screen.getAllByText("Não rodou: o ambiente não foi preparado")).toHaveLength(2);
  });

  it("has no snapshot row when the card has no environment", async () => {
    setup([cmd("ls")]);
    await summary();
    expect(screen.queryByRole("listitem", { name: "Preparar o ambiente (snapshot)" })).toBeNull();
    expect(loadScenario).not.toHaveBeenCalled();
  });

  it("says the environment serves the student when everything ended as expected", async () => {
    outcomes = [{ status: 0 }, { status: 1 }];
    setup([cmd("touch /a"), cmd("cat /nao", { expectError: true })]);
    expect(await summary()).toHaveTextContent("2 de 2 comandos como esperado. Tudo como esperado. O ambiente serve ao aluno.");
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

  it("runs again on a fresh terminal, preparing the snapshot again, and closes", async () => {
    const loadEnvironment = vi.fn().mockResolvedValue({ formato: "do-card" });
    const { onClose } = setup([cmd("ls")], { loadEnvironment });
    await summary();
    expect(execute).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Rodar de novo" }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await summary();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(loadScenario).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Fechar teste" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when the machine of the test cannot be loaded", async () => {
    setup([cmd("ls")], { loadBase: vi.fn().mockRejectedValue(new Error("x")) });
    expect(await screen.findByText("Não foi possível carregar a máquina do teste.")).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
