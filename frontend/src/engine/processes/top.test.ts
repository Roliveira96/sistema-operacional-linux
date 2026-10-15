import { beforeEach, describe, expect, it } from "vitest";
import { fake, makeProcess, Pipe } from "./fakes";
import { setNotTerminalOutputs } from "./output";
import { setNice } from "./priority";
import { setProcessLister, type ProcessLine } from "./ps";
import { makeTop } from "./top";
import type { EngineCommand } from "./types";

const line = (pid: number, usuario: string, comando: string, extra: Partial<ProcessLine> = {}): ProcessLine => ({
  pid,
  ppid: 1,
  usuario,
  tty: "pts/0",
  estado: "S",
  comando,
  cpu: 0,
  mem: 0.1,
  ...extra,
});

// The `top` of the engine is a photo; this one takes it again and again, as the real one does (SPEC-029 entrega A).
const original: EngineCommand = {
  nome: "top",
  resumo: "monitor de processos",
  async executar() {
    return 99;
  },
};
const top = makeTop(original);

const reniced = makeProcess(2451, 1000);
setNice(reniced, 5);

beforeEach(() => {
  setNotTerminalOutputs([Pipe]);
  setProcessLister(() => [
    line(1, "root", "/sbin/init", { estado: "Ss", mem: 0.5 }),
    line(2400, "ricardo", "-bash", { estado: "Ss", mem: 0.3 }),
    line(2451, "ricardo", "sleep 300", { estado: "R", mem: 0.2, processo: reniced }),
    line(2460, "ricardo", "yes", { estado: "T", mem: 0.1 }),
    line(2470, "ricardo", "[defunto]", { estado: "Z", mem: 0 }),
  ]);
});

describe("top", () => {
  it("shows the summary and the table with the real PR and NI of each process, and takes it again until it is interrupted", async () => {
    const f = fake();
    f.setBeats(3);
    expect(await top.executar([], f.context)).toBe(0);
    expect(f.cleared()).toBe(3);

    const text = f.out.join("");
    expect(text.match(/^top - /gm)).toHaveLength(3);
    expect(text).toContain("Tarefas: ");
    expect(text).toContain("PID USUARIO   PR  NI");
    // nice 0 is PR 20, and nice 5 is PR 25: the PR of `top` is not the PRI of `ps -l`
    expect(text).toMatch(/\n\s+2451 ricardo\s+25\s+5 /);
    expect(text).toMatch(/\n\s+2400 ricardo\s+20\s+0 /);
  });

  it("counts the tasks by state: running, sleeping, stopped and zombie", async () => {
    const f = fake();
    f.setBeats(1);
    await top.executar([], f.context);
    const tasks = f.out.join("").split("\n").find((l) => l.startsWith("Tarefas:"))!;
    expect(tasks).toMatch(/\b1 executando\b/);
    expect(tasks).toMatch(/\b1 parado\b/);
    expect(tasks).toMatch(/\b1 zumbi\b/);
    const total = Number(/Tarefas:\s+(\d+) total/.exec(tasks)![1]);
    const sleeping = Number(/(\d+) dormindo/.exec(tasks)![1]);
    expect(sleeping).toBe(total - 1 - 1 - 1);
  });

  it("lists the processes with the most memory first", async () => {
    const f = fake();
    f.setBeats(1);
    await top.executar([], f.context);
    const pids = [...f.out.join("").matchAll(/^\s+(\d+) (?:root|ricardo)\s/gm)].map((m) => Number(m[1]));
    expect(pids).toEqual([1, 2400, 2451, 2460, 2470]);
  });

  it("tells how to leave, only while it is alive", async () => {
    const live = fake();
    live.setBeats(2);
    await top.executar([], live.context);
    expect(live.out.join("")).toContain("Ctrl+C");

    const batch = fake();
    await top.executar(["-b", "-n", "1"], batch.context);
    expect(batch.out.join("")).not.toContain("Ctrl+C");
  });

  it("stops by itself after the number of screens of -n, even with the time still going", async () => {
    const f = fake();
    f.setBeats(10);
    expect(await top.executar(["-n", "2"], f.context)).toBe(0);
    expect(f.out.join("").match(/^top - /gm)).toHaveLength(2);
    expect(f.cleared()).toBe(2);
  });

  it("in batch mode (-b) writes the screens one after the other, without clearing the terminal", async () => {
    const f = fake();
    expect(await top.executar(["-b", "-n", "2", "-d", "1"], f.context)).toBe(0);
    expect(f.out.join("").match(/^top - /gm)).toHaveLength(2);
    expect(f.cleared()).toBe(0);
  });

  it("in a pipe or a file writes one screen and ends, since nobody reads before it ends", async () => {
    const pipe = new Pipe();
    const f = fake({ out: Object.assign(pipe, { linha: undefined }) });
    expect(await top.executar([], f.context)).toBe(0);
    expect(pipe.texto.match(/^top - /gm)).toHaveLength(1);
    expect(f.cleared()).toBe(0);
  });

  it("shows the whole command line of each process with -c, and only the program without it", async () => {
    const plain = fake();
    await top.executar(["-b", "-n", "1"], plain.context);
    expect(plain.out.join("")).toMatch(/ sleep\n/);
    expect(plain.out.join("")).not.toContain("sleep 300");

    const full = fake();
    await top.executar(["-b", "-n", "1", "-c"], full.context);
    const text = full.out.join("");
    expect(text).toContain(" sleep 300\n");
    expect(text).toContain(" /sbin/init\n");
    expect(text).toContain(" bash\n"); // the dash of a login shell is not part of the command
  });

  it("refuses an option it does not know, and numbers that are not numbers", async () => {
    for (const [args, message] of [
      [["-x"], "top: opção inválida -- 'x'"],
      [["-n", "abc"], "top: argumento de iterações inválido 'abc'"],
      [["-n"], "top: a opção requer um argumento -- 'n'"],
      [["-d", "xyz"], "top: argumento de atraso inválido 'xyz'"],
    ] as const) {
      const f = fake();
      expect(await top.executar([...args], f.context), args.join(" ")).toBe(1);
      expect(f.err.join("")).toContain(message);
      expect(f.out).toEqual([]);
    }
  });

  it("keeps what the command of the engine is (name, summary) and says in its help that it is alive", () => {
    expect(top.nome).toBe("top");
    expect(top.ajuda?.uso).toContain("-n");
    expect(top.ajuda?.descricao).toContain("Ctrl+C");
    expect(top.ajuda?.opcoes?.map(([option]) => option).join(" ")).toMatch(/-b.*-d.*-n/);
  });
});
