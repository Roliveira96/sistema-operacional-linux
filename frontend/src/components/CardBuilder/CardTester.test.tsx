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

let statuses: (number | null)[];
let run: ReturnType<typeof vi.fn>;

beforeEach(() => {
  statuses = [];
  run = vi.fn(async () => (statuses.length > 0 ? (statuses.shift() as number | null) : 0));
  mount.mockImplementation(async () => ({ run, setSpeed: vi.fn(), snapshot: vi.fn(), history: vi.fn(() => []), destroy: vi.fn() }));
});

const setup = (commands: CardCommand[], loadBase = vi.fn().mockResolvedValue({ formato: "base" })) => {
  const onClose = vi.fn();
  render(<CardTester commands={commands} loadBase={loadBase} onClose={onClose} />);
  return { onClose, loadBase };
};

/** The summary line, which appears when the test is over. */
const summary = () => screen.findByText(/\d+ de \d+ comandos? como esperado/);

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
    statuses = [0, 2, 1, 0, null];
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
    expect(run.mock.calls.map(([step]) => step.command)).toEqual(["mkdir /x", "ls /nao-existe", "curl http://localhost", "whoami", "passwd ana"]);
    expect(run.mock.calls[3]![0]).toMatchObject({ terminal: 2, login: { user: "ana", password: "123" } });
    expect(run.mock.calls[4]![0].answers).toEqual(["nova", "nova"]);

    expect(within(row(1, "mkdir /x")).getByText("Como esperado")).toBeDefined();
    expect(within(row(2, "ls /nao-existe")).getByText("Deu erro (código 2) e não era esperado")).toBeDefined();
    expect(within(row(3, "curl http://localhost")).getByText("Deu erro, como esperado")).toBeDefined();
    expect(within(row(4, "whoami")).getByText("Era para dar erro e não deu")).toBeDefined();
    expect(within(row(5, "passwd ana")).getByText("Não rodou")).toBeDefined();
    expect(await summary()).toHaveTextContent("Há comandos fora do esperado");
  });

  it("says the environment serves the student when everything ended as expected", async () => {
    statuses = [0, 1];
    setup([cmd("touch /a"), cmd("cat /nao", { expectError: true })]);
    expect(await summary()).toHaveTextContent("2 de 2 comandos como esperado. Tudo como esperado. O ambiente serve ao aluno.");
  });

  it("marks an empty command without running it", async () => {
    setup([cmd("ls"), cmd("   ", { id: "blank" })]);
    await summary();
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Comando vazio")).toBeDefined();
    expect(await summary()).toHaveTextContent("1 de 2 comandos como esperado");
  });

  it("can be stopped, and what was left is shown as not run (CA-12)", async () => {
    let release: (status: number) => void = () => {};
    run.mockImplementationOnce(() => new Promise<number>((resolve) => (release = resolve)));
    setup([cmd("sleep 1"), cmd("ls"), cmd("pwd")]);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    release(0);

    expect(await summary()).toHaveTextContent("1 de 3 comandos como esperado");
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Parado antes de rodar")).toHaveLength(2);
  });

  it("runs again on a fresh terminal, and closes", async () => {
    const { onClose } = setup([cmd("ls")]);
    await summary();
    expect(run).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Rodar de novo" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await summary();
    expect(mount).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Fechar teste" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when the machine of the test cannot be loaded", async () => {
    setup([cmd("ls")], vi.fn().mockRejectedValue(new Error("x")));
    expect(await screen.findByText("Não foi possível carregar a máquina do teste.")).toBeDefined();
    expect(run).not.toHaveBeenCalled();
  });
});
