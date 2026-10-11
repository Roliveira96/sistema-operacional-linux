import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell, type ComandoDoSimulador } from "@legacy-engine/shell/Shell";
import { mountTerminalWindow, type TerminalWindow } from "./terminalWindow";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 120_000 });

const commands: ComandoDoSimulador[] = Shell.obterRegistro().listar();

// Covers SPEC-027 RN-09, CA-08: every command of the simulator has a help, written the same way.
describe("the help of each command (contract)", () => {
  it("registers the commands the help is written for", () => {
    expect(commands.length).toBeGreaterThanOrEqual(121);
  });

  it.each(commands.map((c) => [c.nome, c] as const))("%s has a help that starts with its name and says what it does", (_name, command) => {
    const help = command.ajuda;
    expect(help, `${command.nome} has no ajuda`).toBeDefined();
    expect(help!.uso.startsWith(command.nome), `the uso of ${command.nome} must start with the name`).toBe(true);
    expect(help!.descricao.trim().length).toBeGreaterThan(10);
    for (const [option, text] of [...(help!.opcoes ?? []), ...(help!.exemplos ?? [])]) {
      expect(option.trim(), `${command.nome}: empty left column`).not.toBe("");
      expect(text.trim(), `${command.nome}: empty explanation for ${option}`).not.toBe("");
    }
    expect([undefined, "ajuda", "outra"]).toContain(help!.h);
    const listed = (help!.opcoes ?? []).some(([option]) => /(^|[ ,|])-[A-Za-z]*h/.test(option));
    // Where -h is another option it is listed with the others (RN-11); where it is the help it is not an option to list.
    if (help!.h === "outra") expect(listed, `${command.nome}: -h is another option and is not listed`).toBe(true);
    if (help!.h === "ajuda") expect(listed, `${command.nome}: -h is the help and must not be listed as an option`).toBe(false);
  });
});

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

async function terminal() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  win = await mountTerminalWindow(host, null, { onCommand: () => {} });
  win.setSpeed(100);
  return win;
}

const run = async (t: TerminalWindow, command: string) => {
  const r = await t.execute({ command });
  return { status: r.status, output: r.output };
};

// Covers SPEC-027 RN-01, RN-04 to RN-08, RN-10 and CA-01, CA-02, CA-04 to CA-07, CA-09, CA-10 on the real terminal.
describe("the help in the terminal", () => {
  it("shows the help of a command with --help and ends with 0, without running it", async () => {
    const t = await terminal();
    const help = await run(t, "ls --help");
    expect(help.status).toBe(0);
    expect(help.output).toContain("Uso: ls");
    expect(help.output).toContain("Opções:");
    expect(help.output).toContain("Exemplos:");
    // The sentence of the description starts with a capital, as in a manual.
    expect(help.output.split(String.fromCharCode(10))[1]).toMatch(/^[A-ZÀ-Ú]/);
    // A command with no option of its own has no section of options.
    expect((await run(t, "touch --help")).output).toContain("Uso: touch");
    // Nothing was done: no file called --help, and the machine is the same.
    expect((await run(t, "ls")).output).not.toContain("--help");
    const before = JSON.stringify(t.snapshot());
    for (const command of ["mkdir --help", "rm --help", "useradd --help", "groupadd --help", "cp --help", "mv --help"]) {
      const r = await run(t, command);
      expect(r.status, command).toBe(0);
      expect(r.output, command).toContain("Uso: ");
    }
    expect(JSON.stringify(t.snapshot())).toBe(before);
  });

  it("makes -h the help only where it is the help on a real Linux (RN-10, CA-09, CA-10)", async () => {
    const t = await terminal();
    // The help: useradd -h.
    const help = await run(t, "useradd -h");
    expect(help.status).toBe(0);
    expect(help.output).toContain("Uso: useradd");
    expect((await run(t, "id maria")).status).not.toBe(0);
    // Another option: ls -h keeps the human sizes, and df -h too.
    const ls = await run(t, "ls -lh /etc");
    expect(ls.output).not.toContain("Uso:");
    expect((await run(t, "df -h")).output).not.toContain("Uso:");
    expect((await run(t, "free -h")).output).not.toContain("Uso:");
    // No -h at all: the usual invalid option, not the help.
    const chmod = await run(t, "chmod -h 755 /tmp");
    expect(chmod.output).not.toContain("Uso: chmod");
  });

  it("treats --help after -- as an operand, and in bash builtins that print it as text", async () => {
    const t = await terminal();
    expect((await run(t, "echo --help")).output.trim()).toBe("--help");
    expect((await run(t, "echo -- --help")).output).not.toContain("Uso:");
    const afterDashes = await run(t, "ls -- --help");
    expect(afterDashes.output).not.toContain("Uso: ls");
    expect(afterDashes.status).not.toBe(0);
  });

  it("gives --help to the command that sudo runs, and to sudo only when it comes first (RN-05)", async () => {
    const t = await terminal();
    expect((await run(t, "sudo --help")).output).toContain("Uso: sudo");
    const inner = await run(t, "sudo ls --help");
    expect(inner.output).toContain("Uso: ls");
    expect(inner.output).not.toContain("Uso: sudo");
    expect((await run(t, "echo ls | xargs --help")).output).toContain("Uso: xargs");
  });

  it("works in a pipe and in a redirection (RN-06)", async () => {
    const t = await terminal();
    const first = await run(t, "ls --help | head -n 1");
    expect(first.output.trim()).toBe("Uso: ls [OPÇÃO]... [ARQUIVO]...");
    await run(t, "ls --help > /tmp/ajuda.txt");
    expect((await run(t, "head -n 1 /tmp/ajuda.txt")).output).toContain("Uso: ls");
  });

  it("answers help COMMAND and man COMMAND with the same content, and keeps the messages for what does not exist (RN-08)", async () => {
    const t = await terminal();
    const direct = (await run(t, "ls --help")).output;
    expect((await run(t, "help ls")).output).toBe(direct);
    const man = (await run(t, "man ls")).output;
    for (const part of ["LS(1)", "NOME", "SINOPSE", "DESCRIÇÃO", "OPÇÕES", "EXEMPLOS"]) expect(man).toContain(part);
    const missing = await run(t, "help naoexiste");
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("nenhum tópico de ajuda");
    expect((await run(t, "man naoexiste")).status).toBe(16);
    expect((await run(t, "help")).output).toContain("Comandos disponíveis");
  });

  it("keeps an unknown command as not found", async () => {
    const t = await terminal();
    const r = await run(t, "naoexiste --help");
    expect(r.status).toBe(127);
    expect(r.output).toContain("comando não encontrado");
  });
});
