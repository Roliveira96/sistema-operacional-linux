import { beforeEach, describe, expect, it } from "vitest";
import { fake } from "./fakes";
import { setProcessLister, type ProcessLine } from "./ps";
import { pidofCommand, pstreeCommand } from "./tree";

const line = (pid: number, ppid: number, comando: string, extra: Partial<ProcessLine> = {}): ProcessLine => ({
  pid,
  ppid,
  usuario: "ricardo",
  tty: "pts/0",
  estado: "S",
  comando,
  cpu: 0,
  mem: 0.1,
  ...extra,
});

beforeEach(() => {
  setProcessLister(() => [
    line(1, 0, "/sbin/init", { usuario: "root", tty: "?" }),
    // the threads of the kernel are not part of the tree that pstree draws
    line(2, 0, "[kthreadd]", { usuario: "root", tty: "?" }),
    line(3, 2, "[rcu_gp]", { usuario: "root", tty: "?" }),
    line(500, 1, "/usr/sbin/cron", { usuario: "root", tty: "?" }),
    line(2400, 1, "-bash"),
    line(2451, 2400, "sleep 300"),
    line(2452, 2400, "sleep 600"),
    line(2460, 2400, "top"),
    line(3000, 1, "-bash"),
  ]);
});

const run = async (command: typeof pstreeCommand, args: string[]) => {
  const f = fake();
  const status = await command.executar(args, f.context);
  return { status, out: f.out.join(""), err: f.err.join("") };
};

// SPEC-029 CA-05: who is the parent of whom, with the right PIDs
describe("pstree", () => {
  it("draws the tree of the processes from the first one, with a branch for each child, as pstree does", async () => {
    const { status, out } = await run(pstreeCommand, []);
    expect(status).toBe(0);
    expect(out.split("\n").filter(Boolean)).toEqual([
      "init─┬─bash─┬─sleep",
      "     │      ├─sleep",
      "     │      └─top",
      "     ├─bash",
      "     └─cron",
    ]);
  });

  it("does not draw the threads of the kernel, which the real pstree leaves out", async () => {
    const { out } = await run(pstreeCommand, ["-p"]);
    expect(out).not.toContain("kthreadd");
    expect(out).not.toContain("rcu_gp");
    expect(out.split("\n")[0]).toMatch(/^init\(1\)/);
  });

  it("shows the PIDs with -p", async () => {
    const { out } = await run(pstreeCommand, ["-p"]);
    expect(out.split("\n")[0]).toBe("init(1)─┬─bash(2400)─┬─sleep(2451)");
    expect(out).toContain("sleep(2452)");
    expect(out).toContain("top(2460)");
    expect(out).toContain("cron(500)");
  });

  it("puts a chain of single children on one line", async () => {
    setProcessLister(() => [line(1, 0, "/sbin/init"), line(2, 1, "-bash"), line(3, 2, "sleep 5")]);
    expect((await run(pstreeCommand, [])).out).toBe("init───bash───sleep\n");
  });

  it("draws only the tree of a PID given, and refuses a PID that does not exist", async () => {
    expect((await run(pstreeCommand, ["2400"])).out.split("\n")[0]).toBe("bash─┬─sleep");
    const missing = await run(pstreeCommand, ["99999"]);
    expect(missing.status).toBe(1);
    expect(missing.err).toContain("pstree: nenhum processo com o PID 99999");
  });

  it("refuses an option it does not know", async () => {
    const result = await run(pstreeCommand, ["-x"]);
    expect(result.status).toBe(1);
    expect(result.err).toContain("pstree: opção inválida -- 'x'");
    expect(result.out).toBe("");
  });

  it("has a help that starts by the name", () => {
    expect(pstreeCommand.nome).toBe("pstree");
    expect(pstreeCommand.ajuda?.uso).toMatch(/^pstree /);
    expect(pstreeCommand.ajuda?.opcoes?.map(([option]) => option).join(" ")).toContain("-p");
  });
});

describe("pidof", () => {
  it("prints the PIDs of the program, the highest first, and ends with 0", async () => {
    expect(await run(pidofCommand, ["sleep"])).toMatchObject({ status: 0, out: "2452 2451\n" });
    expect((await run(pidofCommand, ["bash"])).out).toBe("3000 2400\n");
  });

  it("takes more than one name, and -s gives only one PID", async () => {
    expect((await run(pidofCommand, ["top", "cron"])).out).toBe("2460 500\n");
    expect((await run(pidofCommand, ["-s", "sleep"])).out).toBe("2452\n");
  });

  it("ends with 1 and says nothing when no process has the name, and is silent with -q", async () => {
    expect(await run(pidofCommand, ["nginx"])).toMatchObject({ status: 1, out: "", err: "" });
    expect(await run(pidofCommand, ["-q", "sleep"])).toMatchObject({ status: 0, out: "" });
    expect((await run(pidofCommand, ["-q", "nginx"])).status).toBe(1);
  });

  it("refuses a call with no name and an option it does not know", async () => {
    const none = await run(pidofCommand, []);
    expect(none.status).toBe(1);
    expect(none.err).toContain("Uso: pidof");
    const unknown = await run(pidofCommand, ["-x", "sleep"]);
    expect(unknown.status).toBe(1);
    expect(unknown.err).toContain("pidof: opção inválida -- 'x'");
  });

  it("has a help that starts by the name", () => {
    expect(pidofCommand.ajuda?.uso).toMatch(/^pidof /);
  });
});
