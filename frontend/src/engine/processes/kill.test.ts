import { describe, expect, it } from "vitest";
import { fake, makeProcess, type Fake } from "./fakes";
import { makeKill } from "./kill";

// Covers SPEC-029 CA-02, CA-06, CA-07: kill with every signal, wrapped over the one of the engine.
describe("kill", () => {
  const original = {
    nome: "kill",
    resumo: "envia um sinal",
    embutido: true,
    calls: [] as string[][],
    async executar(args: string[]) {
      this.calls.push(args);
      return 0;
    },
  };
  const make = () => {
    original.calls = [];
    return makeKill(original);
  };
  const run = (args: string[], f: Fake) => make().executar(args, f.context);

  it("lists the signals, and converts each one between number and name, also from the status of a process that ended by a signal", async () => {
    const f = fake();
    expect(await run(["-l"], f)).toBe(0);
    expect(f.out.join("").split(String.fromCharCode(10)).filter(Boolean)).toHaveLength(13);
    const g = fake();
    expect(await run(["-l", "9", "TERM", "sigint", "137"], g)).toBe(0);
    expect(g.out.join("")).toBe("KILL\n15\n2\nKILL\n");
    const h = fake();
    expect(await run(["-l", "99", "FOO"], h)).toBe(1);
    expect(h.err.join("")).toContain("99: especificação de sinal inválida");
    expect(original.calls).toEqual([]);
  });

  it("leaves the signals the engine knows, jobs and everything else it does to the engine's kill, as they came", async () => {
    for (const args of [["1234"], ["-9", "1234"], ["-s", "TERM", "1234"], ["-KILL", "1234"], ["-STOP", "1234"], ["-0", "1234"], ["%1"]]) {
      const f = fake();
      await run(args, f);
      expect(original.calls, args.join(" ")).toEqual([args]);
    }
  });

  it("delivers the signals the engine does not know to the processes of the user, ending them with that signal", async () => {
    const mine = makeProcess(2451, 1000);
    const f = fake({ uid: 1000, table: [mine] });
    expect(await run(["-USR1", "2451"], f)).toBe(0);
    expect(mine.sinal).toBe(10);
    const other = makeProcess(2452, 1000);
    expect(await run(["-s", "usr2", "2452"], fake({ uid: 1000, table: [other] }))).toBe(0);
    expect(other.sinal).toBe(12);
    const byNumber = makeProcess(2453, 1000);
    await run(["-n", "14", "2453"], fake({ uid: 1000, table: [byNumber] }));
    expect(byNumber.sinal).toBe(14);
    expect(original.calls).toEqual([]);
  });

  it("stops with TTIN and TTOU, and does nothing with the signals Linux ignores by default", async () => {
    const stopped = makeProcess(1, 0);
    await run(["-TTIN", "1"], fake({ table: [stopped] }));
    expect(stopped.sinal).toBeNull();
    expect(stopped.pausado).toBe(true);
    for (const name of ["CHLD", "URG", "WINCH"]) {
      const p = makeProcess(2, 0);
      await run([`-${name}`, "2"], fake({ table: [p] }));
      expect(p.sinal, name).toBeNull();
      expect(p.pausado, name).toBe(false);
    }
  });

  it("does not let a user signal another one's process, says when there is none, and refuses a job with these signals", async () => {
    const theirs = makeProcess(2470, 0);
    const f = fake({ uid: 1000, table: [theirs] });
    expect(await run(["-USR1", "2470"], f)).toBe(1);
    expect(f.err.join("")).toContain("(2470) - Operação não permitida");
    expect(theirs.sinal).toBeNull();
    // The root may.
    await run(["-USR1", "2470"], fake({ uid: 0, table: [theirs] }));
    expect(theirs.sinal).toBe(10);

    const g = fake({ table: [] });
    expect(await run(["-USR1", "%1"], g)).toBe(1);
    expect(g.err.join("")).toContain("%1");
    expect(await run(["-USR1"], fake())).toBe(2);
  });

  it("hands the engine a system process, with the signal that ends, and ignores one that would not end it", async () => {
    const f = fake({ table: [] });
    await run(["-USR1", "1"], f);
    expect(original.calls).toEqual([["-15", "1"]]);
    // A signal that would not end it is left alone (every call starts a new count of what the engine received).
    await run(["-CHLD", "1"], fake({ table: [] }));
    expect(original.calls).toEqual([]);
  });

  it("refuses a signal that does not exist, in any of the forms", async () => {
    for (const args of [["-FOO", "1"], ["-s", "FOO", "1"], ["-n", "99", "1"], ["-99", "1"]]) {
      const f = fake();
      expect(await run(args, f), args.join(" ")).toBe(1);
      expect(f.err.join(""), args.join(" ")).toContain("especificação de sinal inválida");
    }
    expect(original.calls).toEqual([]);
  });

  it("keeps what the engine says about itself, with the help of the new options", () => {
    const k = make();
    expect(k.embutido).toBe(true);
    expect(k.ajuda?.uso.startsWith("kill")).toBe(true);
    expect(k.ajuda?.opcoes?.some(([o]) => o.startsWith("-l"))).toBe(true);
  });
});
