import { beforeEach, describe, expect, it } from "vitest";
import { fake, makeProcess, Pipe } from "./fakes";
import { watchCommand, yesCommand } from "./loops";
import { niceCommand, reniceCommand } from "./nice";
import { setNotTerminalOutputs } from "./output";
import { niceOf, niceOfPid, priorityOf, setNice } from "./priority";

beforeEach(() => setNotTerminalOutputs([Pipe]));

// Covers SPEC-029 RN-05, CA-04: the niceness of the processes, as Linux has it.
describe("priority", () => {
  it("is the niceness of the process or the one of whoever started it, and PRI is 80 plus it", () => {
    const parent = makeProcess(1, 0);
    const child = makeProcess(2, 0, parent);
    expect(niceOf(child)).toBe(0);
    expect(priorityOf(child)).toBe(80);
    setNice(parent, 10);
    expect(niceOf(child)).toBe(10);
    setNice(child, -5);
    expect(niceOf(child)).toBe(-5);
    expect(priorityOf(child)).toBe(75);
    expect(niceOf(null)).toBe(0);
    // Out of range values are held in the range.
    setNice(child, 99);
    expect(niceOf(child)).toBe(19);
    setNice(child, -99);
    expect(niceOf(child)).toBe(-20);
    expect(niceOfPid(31337)).toBe(0);
  });
});

describe("nice", () => {
  it("shows the niceness alone, and starts the command as itself with the adjustment, 10 by default", async () => {
    const f = fake();
    expect(await niceCommand.executar([], f.context)).toBe(0);
    expect(f.out.join("")).toBe("0\n");

    const g = fake();
    await niceCommand.executar(["sleep", "30"], g.context);
    expect(g.ran).toEqual(["sleep 30"]);
    expect(niceOf(g.context.processo)).toBe(10);
    // nice becomes the command: one process, named by it, that the engine hands to the command.
    expect(g.context.processo!.comando).toBe("sleep 30");
    expect(g.context.processo!.reutilizavel).toBe(true);
  });

  it("takes the adjustment as -n N, --adjustment=N and the old -N, and adds it to the niceness it already has", async () => {
    for (const [args, expected] of [
      [["-n", "5", "ls"], 5],
      [["--adjustment=7", "ls"], 7],
      [["-3", "ls"], 3],
      [["-n", "25", "ls"], 19],
    ] as const) {
      const f = fake();
      await niceCommand.executar([...args], f.context);
      expect(niceOf(f.context.processo), args.join(" ")).toBe(expected);
    }
    const started = makeProcess(5, 0);
    setNice(started, 4);
    const f = fake({ process: started });
    await niceCommand.executar(["-n", "6", "ls"], f.context);
    expect(niceOf(started)).toBe(10);
  });

  it("lets only the root lower the niceness; anyone else is warned and the command runs with what it had", async () => {
    const root = fake({ uid: 0 });
    await niceCommand.executar(["-n", "-5", "ls"], root.context);
    expect(niceOf(root.context.processo)).toBe(-5);
    expect(root.err).toEqual([]);
    // The old form --N is -N.
    const old = fake({ uid: 0 });
    await niceCommand.executar(["--8", "ls"], old.context);
    expect(niceOf(old.context.processo)).toBe(-8);

    const user = fake({ uid: 1000 });
    expect(await niceCommand.executar(["-n", "-5", "ls"], user.context)).toBe(0);
    expect(user.err.join("")).toContain("Permissão negada");
    expect(niceOf(user.context.processo)).toBe(0);
    expect(user.ran).toEqual(["ls"]);
  });

  it("refuses a value that is not a number, and a -n with no value", async () => {
    const a = fake();
    expect(await niceCommand.executar(["-n", "dez", "ls"], a.context)).toBe(125);
    expect(a.err.join("")).toContain("'dez' não é um número válido");
    const b = fake();
    expect(await niceCommand.executar(["-n"], b.context)).toBe(125);
    const c = fake();
    expect(await niceCommand.executar(["--adjustment=x", "ls"], c.context)).toBe(125);
    expect(a.ran).toEqual([]);
  });

  it("works with no process behind it (a script) and has a help that leaves the rest of the line to the command", async () => {
    const f = fake({ process: null });
    expect(await niceCommand.executar(["ls"], f.context)).toBe(0);
    expect(f.ran).toEqual(["ls"]);
    expect(niceCommand.ajuda?.soPrimeiro).toBe(true);
    expect(niceCommand.ajuda?.uso.startsWith("nice")).toBe(true);
  });
});

describe("renice", () => {
  const owned = () => [makeProcess(2451, 1000), makeProcess(2460, 1000), makeProcess(2470, 0)];

  it("changes the niceness of the processes asked for and says the old and the new one", async () => {
    const table = owned();
    const f = fake({ uid: 1000, table });
    expect(await reniceCommand.executar(["10", "-p", "2451"], f.context)).toBe(0);
    expect(f.out.join("")).toBe("2451 (ID do processo) prioridade antiga 0, nova prioridade 10\n");
    expect(niceOf(table[0]!)).toBe(10);

    // -n, bare PIDs and more than one.
    const g = fake({ uid: 1000, table });
    await reniceCommand.executar(["-n", "12", "2451", "2460"], g.context);
    expect(g.out.join("")).toContain("2451 (ID do processo) prioridade antiga 10, nova prioridade 12");
    expect(g.out.join("")).toContain("2460 (ID do processo) prioridade antiga 0, nova prioridade 12");
  });

  it("does not let a user change another one's process, nor lower the niceness of its own (CA-07)", async () => {
    const table = owned();
    const f = fake({ uid: 1000, table });
    expect(await reniceCommand.executar(["5", "-p", "2470"], f.context)).toBe(1);
    expect(f.err.join("")).toContain("falha ao definir a prioridade de 2470");
    expect(niceOf(table[2]!)).toBe(0);

    setNice(table[0]!, 10);
    const g = fake({ uid: 1000, table });
    expect(await reniceCommand.executar(["5", "-p", "2451"], g.context)).toBe(1);
    expect(niceOf(table[0]!)).toBe(10);
  });

  it("lets the root change any process, lower the niceness, and the ones of the system by PID", async () => {
    const table = owned();
    const f = fake({ uid: 0, table });
    await reniceCommand.executar(["-5", "-p", "2451"], f.context);
    expect(niceOf(table[0]!)).toBe(-5);
    const g = fake({ uid: 0, table });
    await reniceCommand.executar(["3", "-p", "1"], g.context);
    expect(g.out.join("")).toContain("1 (ID do processo) prioridade antiga 0, nova prioridade 3");
    expect(niceOfPid(1)).toBe(3);
    // A user cannot touch the system.
    const h = fake({ uid: 1000, table });
    expect(await reniceCommand.executar(["9", "-p", "1"], h.context)).toBe(1);
  });

  it("changes every process of a user with -u, by name or by number, and says when there is none", async () => {
    const table = owned();
    const f = fake({ uid: 0, table });
    await reniceCommand.executar(["7", "-u", "ana"], f.context);
    expect(niceOf(table[0]!)).toBe(7);
    expect(niceOf(table[1]!)).toBe(7);
    expect(niceOf(table[2]!)).toBe(0);
    const g = fake({ uid: 0, table });
    await reniceCommand.executar(["8", "-u", "1000"], g.context);
    expect(niceOf(table[0]!)).toBe(8);
    const h = fake({ uid: 0, table });
    expect(await reniceCommand.executar(["8", "-u", "nobody"], h.context)).toBe(1);
  });

  it("reports a missing process, a bad priority, a bad identifier and a missing argument, and holds the priority in the range", async () => {
    const table = owned();
    const f = fake({ uid: 0, table });
    expect(await reniceCommand.executar(["5", "-p", "77"], f.context)).toBe(1);
    expect(f.err.join("")).toContain("Processo inexistente");
    expect(await reniceCommand.executar(["alta", "-p", "2451"], fake({ table }).context)).toBe(1);
    const g = fake({ table });
    expect(await reniceCommand.executar(["5", "-p", "abc"], g.context)).toBe(1);
    expect(g.err.join("")).toContain("ID inválido: abc");
    expect(await reniceCommand.executar([], fake({ table }).context)).toBe(1);
    expect(await reniceCommand.executar(["5"], fake({ table }).context)).toBe(1);
    await reniceCommand.executar(["99", "-p", "2451"], fake({ table }).context);
    expect(niceOf(table[0]!)).toBe(19);
  });
});

describe("yes", () => {
  it("prints y, or the text, in beats until it is interrupted, and ends with 130 (CA-01)", async () => {
    const f = fake();
    f.setBeats(3);
    expect(await yesCommand.executar([], f.context)).toBe(130);
    const lines = f.out.join("").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(new Set(lines)).toEqual(new Set(["y"]));

    const g = fake();
    await yesCommand.executar(["ola", "mundo"], g.context);
    expect(new Set(g.out.join("").split("\n").filter(Boolean))).toEqual(new Set(["ola mundo"]));
  });

  it("stops at once when the process is already ended, even before the first beat", async () => {
    const f = fake();
    f.setBeats(0);
    expect(await yesCommand.executar([], f.context)).toBe(130);
    expect(f.out).toEqual([]);
  });

  it("keeps running into /dev/null, which keeps nothing, until it is ended", async () => {
    const devNull = Object.assign(new Pipe(), { arquivo: { nome: "null" } });
    const f = fake({ out: devNull });
    f.setBeats(4);
    expect(await yesCommand.executar([], f.context)).toBe(130);
    expect(f.context.interrompido()).toBe(true);
    // Another file is not that: it is a file, and it stops at the limit.
    const other = Object.assign(new Pipe(), { arquivo: { nome: "saida.txt" } });
    expect(await yesCommand.executar(["x"], fake({ out: other }).context)).toBe(0);
  });

  it("in a pipe or a file prints a fixed number of lines and ends with 0, since nobody reads before it ends", async () => {
    const pipe = new Pipe();
    const f = fake({ out: Object.assign(pipe, { linha: undefined }) });
    expect(await yesCommand.executar(["x"], f.context)).toBe(0);
    expect(pipe.texto.split("\n").filter(Boolean)).toHaveLength(10_000);
  });
});

describe("watch", () => {
  it("runs the command, clears the screen, shows the title and repeats until it is interrupted (CA-01)", async () => {
    const f = fake();
    f.setBeats(3);
    expect(await watchCommand.executar(["-n", "1", "date"], f.context)).toBe(0);
    expect(f.ran).toEqual(["date", "date", "date"]);
    expect(f.cleared()).toBe(3);
    const text = f.out.join("");
    expect(text).toContain("A cada 1,0s: date");
    expect(text).toContain("ubuntu:");
  });

  it("takes the interval in the other forms, keeps the command with its arguments and drops the title with -t", async () => {
    const f = fake();
    f.setBeats(1);
    await watchCommand.executar(["--interval=0,5", "-t", "ls", "-l", "/tmp"], f.context);
    expect(f.ran).toEqual(["ls -l /tmp"]);
    expect(f.out.join("")).not.toContain("A cada");
    // The interval has a floor.
    const g = fake();
    g.setBeats(1);
    await watchCommand.executar(["-n", "0", "date"], g.context);
    expect(g.out.join("")).toContain("A cada 0,1s");
  });

  it("refuses an interval that is not a number, and a call with no command", async () => {
    const a = fake();
    expect(await watchCommand.executar(["-n", "x", "date"], a.context)).toBe(1);
    expect(a.err.join("")).toContain("intervalo inválido 'x'");
    expect(await watchCommand.executar(["--interval=y", "date"], fake().context)).toBe(1);
    expect(await watchCommand.executar(["-n"], fake().context)).toBe(1);
    const b = fake();
    expect(await watchCommand.executar([], b.context)).toBe(1);
    expect(b.err.join("")).toContain("falta o comando");
  });

  it("in a pipe or a file runs once, without clearing a screen", async () => {
    const pipe = new Pipe();
    const f = fake({ out: Object.assign(pipe, { linha: undefined }) });
    expect(await watchCommand.executar(["echo", "oi"], f.context)).toBe(0);
    expect(f.ran).toEqual(["echo oi"]);
    expect(f.cleared()).toBe(0);
  });
});
