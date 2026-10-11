import { beforeEach, describe, expect, it } from "vitest";
import { fake, makeProcess } from "./fakes";
import { setNice } from "./priority";
import { forest, makePs, setProcessLister, type ProcessLine } from "./ps";
import type { EngineCommand } from "./types";

const line = (pid: number, ppid: number, usuario: string, comando: string, extra: Partial<ProcessLine> = {}): ProcessLine => ({
  pid,
  ppid,
  usuario,
  tty: "pts/0",
  estado: "S",
  comando,
  cpu: 0,
  mem: 0.1,
  ...extra,
});

const NL = String.fromCharCode(10);

describe("ps, extended", () => {
  const sleeper = makeProcess(2451, 1000);
  const table: ProcessLine[] = [
    line(1, 0, "root", "/sbin/init", { tty: "?", estado: "Ss" }),
    line(2400, 1, "ricardo", "-bash", { estado: "Ss" }),
    line(2451, 2400, "ricardo", "sleep 60", { processo: sleeper, estado: "T" }),
    line(2460, 2451, "ricardo", "ps -l", { estado: "R" }),
    line(2500, 1, "root", "[kworker]", { tty: "?" }),
  ];
  const original: EngineCommand & { calls: string[][]; output: string } = {
    nome: "ps",
    resumo: "lista processos",
    calls: [],
    output: "    PID TTY          TIME CMD\n   2400 pts/0    00:00:00 bash\n   2451 pts/0    00:00:00 sleep\n   2460 pts/0    00:00:00 ps\n",
    async executar(args, context) {
      this.calls.push(args);
      context.escrever(this.output);
      return 0;
    },
  };
  const ps = () => {
    original.calls = [];
    return makePs(original);
  };
  const lines = (text: string) => text.split(NL).filter(Boolean);
  const context = () => fake({ uid: 1000, table: [] });

  beforeEach(() => {
    setNice(sleeper, 10);
    setProcessLister(() => table);
  });

  // Covers SPEC-029 CA-04, CA-05: the long format with the niceness, and the fields asked for.
  it("hands the engine what it already did, as it came", async () => {
    for (const args of [[], ["aux"], ["-ef"], ["-u", "ricardo"], ["-p", "1,2"], ["-C", "bash"]]) {
      const f = context();
      expect(await ps().executar(args, f.context)).toBe(0);
      expect(original.calls, args.join(" ")).toEqual([args]);
    }
  });

  it("shows -l with the parent, the priority and the niceness, for the processes of the terminal", async () => {
    const f = context();
    expect(await ps().executar(["-l"], f.context)).toBe(0);
    const out = lines(f.out.join(""));
    expect(out[0]).toBe("F S   UID     PID    PPID  C PRI  NI ADDR SZ WCHAN  TTY          TIME CMD");
    // Only what is on this terminal: no init and no kernel thread.
    expect(out).toHaveLength(4);
    const sleep = out.find((row) => row.endsWith("sleep"))!;
    expect(sleep).toMatch(/^0 T\s+1000\s+2451\s+2400\s+0\s+90\s+10 -/);
    expect(out.find((row) => row.endsWith("bash"))).toMatch(/\s+80\s+0 -/);
    expect(original.calls).toEqual([]);
  });

  it("shows every process with -e or -A, marks the root's with F 4, and filters with -u, -p and -C", async () => {
    const all = context();
    await ps().executar(["-el"], all.context);
    const out = lines(all.out.join(""));
    expect(out).toHaveLength(6);
    expect(out.find((row) => row.endsWith("init"))).toMatch(/^4 S\s+0\s+1\s+0/);
    const user = context();
    await ps().executar(["-l", "-u", "ricardo"], user.context);
    expect(lines(user.out.join("")).slice(1).every((row) => row.includes("pts/0"))).toBe(true);
    const pid = context();
    await ps().executar(["-l", "-p", "2451"], pid.context);
    expect(lines(pid.out.join(""))).toHaveLength(2);
    const name = context();
    await ps().executar(["-l", "-C", "sleep"], name.context);
    expect(lines(name.out.join("")).slice(1)).toHaveLength(1);
  });

  it("shows only the columns of -o, in the order asked, with the aliases, the renamed headers and the hidden ones", async () => {
    const f = context();
    await ps().executar(["-o", "pid,ppid,ni,stat,comm", "-p", "2451"], f.context);
    expect(lines(f.out.join(""))).toEqual(["    PID    PPID  NI STAT COMMAND", "   2451    2400  10 T    sleep"]);
    const g = context();
    await ps().executar(["-opid,nice,user", "-p", "2451"], g.context);
    expect(lines(g.out.join(""))[0]).toBe("    PID  NI USER");
    const h = context();
    await ps().executar(["--format=pid=P,args=", "-p", "2451"], h.context);
    expect(lines(h.out.join(""))).toEqual(["      P", "   2451 sleep 60"]);
    const hidden = context();
    await ps().executar(["-o", "pid=,comm=", "-p", "2451"], hidden.context);
    expect(lines(hidden.out.join(""))).toEqual(["   2451 sleep"]);
    const uid = context();
    await ps().executar(["-o", "uid,pri,pcpu,pmem,s,tty,time,c", "-p", "2451"], uid.context);
    expect(lines(uid.out.join(""))[0]).toBe("  UID PRI %CPU %MEM S TT           TIME  C");
  });

  it("refuses a field that does not exist", async () => {
    const f = context();
    expect(await ps().executar(["-o", "pid,foo"], f.context)).toBe(1);
    expect(f.err.join("")).toContain('"foo"');
  });

  it("draws the tree of parents and children over what the engine printed, and over its own tables (CA-05)", async () => {
    const f = context();
    await ps().executar(["--forest"], f.context);
    expect(original.calls).toEqual([[]]);
    expect(lines(f.out.join(""))).toEqual([
      "    PID TTY          TIME CMD",
      "   2400 pts/0    00:00:00 bash",
      "   2451 pts/0    00:00:00  \\_ sleep",
      "   2460 pts/0    00:00:00      \\_ ps",
    ].map((row, i) => (i === 3 ? "   2460 pts/0    00:00:00    \\_ ps" : row)));
    // The letter f of the BSD style, among the others, is the forest; the others go to the engine.
    const g = context();
    await ps().executar(["axf"], g.context);
    expect(original.calls).toEqual([["ax"]]);
    const h = context();
    await ps().executar(["f"], h.context);
    expect(original.calls).toEqual([[]]);
    const own = context();
    await ps().executar(["-el", "--forest"], own.context);
    const rows = lines(own.out.join(""));
    expect(rows[1]).toMatch(/init$/);
    expect(rows.find((row) => row.includes("sleep"))).toContain("\\_ sleep");
    expect(rows.find((row) => row.includes("kworker")) ?? "").toMatch(/kworker/);
  });

  it("keeps the selectors the engine needs together with the forest, and a user named like the letter f is not the forest", async () => {
    const f = context();
    await ps().executar(["-u", "fred", "--forest"], f.context);
    expect(original.calls).toEqual([["-u", "fred"]]);
  });

  it("gives back what the engine said when it fails, with no tree", async () => {
    const failing = { ...original, async executar(_args: string[], context: { escrever(t: string): void }) { context.escrever("ps: erro\n"); return 1; } } as unknown as EngineCommand;
    const f = context();
    expect(await makePs(failing).executar(["--forest"], f.context)).toBe(1);
    expect(f.out.join("")).toBe("ps: erro\n");
  });

  it("leaves a table with no PID or no command column as it is", () => {
    expect(forest("USER\nroot\n", table)).toBe("USER\nroot\n");
    expect(forest("  PID\n    1\n", table)).toBe("  PID\n    1\n");
  });

  it("keeps the help of the engine and adds the new options", () => {
    const k = ps();
    expect(k.ajuda?.uso.startsWith("ps")).toBe(true);
    expect(k.ajuda?.opcoes?.map(([o]) => o)).toEqual(expect.arrayContaining(["-l", "-o CAMPOS", "--forest, f"]));
  });
});
