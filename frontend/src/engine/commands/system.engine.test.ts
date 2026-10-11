import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
});
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

const run = (command: string) => win.execute({ command });
const lines = async (command: string, status = 0) => {
  const result = await run(command);
  expect(result.status).toBe(status);
  return result.output === "" ? [] : result.output.split("\n");
};

// Covers SPEC-028 CA-02, CA-04, CA-05, CA-08, CA-10 for the system and process commands.
describe("information of the system (CA-10)", () => {
  it("nproc agrees with /proc/cpuinfo, and ignores some when asked", async () => {
    const count = (await lines("grep -c processor /proc/cpuinfo"))[0]!;
    expect(await lines("nproc")).toEqual([count]);
    expect(await lines("nproc --all")).toEqual([count]);
    expect(await lines("nproc --ignore=1")).toEqual([String(Number(count) - 1)]);
    expect(await lines("nproc --ignore=99")).toEqual(["1"]);
    expect((await run("nproc --ignore=x")).status).toBe(1);
    expect((await run("nproc extra")).status).toBe(1);
  });

  it("lscpu shows the architecture, the processors and the model of /proc/cpuinfo", async () => {
    const output = (await lines("lscpu")).join("\n");
    const count = (await lines("nproc"))[0]!;
    expect(output).toMatch(new RegExp(String.raw`CPU\(s\):\s+${count}\b`));
    expect(output).toContain("x86_64");
    expect(output).toContain("Intel(R) Xeon(R) Platinum 8592+");
  });

  it("hostnamectl shows the name, the system and the kernel of the machine", async () => {
    const output = (await lines("hostnamectl")).join("\n");
    expect(output).toContain("Static hostname: servidor");
    expect(output).toContain("Operating System: Ubuntu 24.04");
    expect(output).toContain(`Kernel: Linux ${(await lines("uname -r"))[0]}`);
    expect(output).toContain("Architecture: x86-64");
    expect(await lines("hostnamectl status")).toEqual(output.split("\n"));
    expect((await run("hostnamectl set-hostname x")).status).toBe(1);
  });

  it("tty names the terminal, and refuses a pipe", async () => {
    expect((await lines("tty"))[0]).toMatch(/^\/dev\/pts\/\d+$/);
    const piped = await run("echo x | tty");
    expect(piped.status).toBe(1);
    expect(piped.output).toBe("não é um tty");
    expect(await lines("echo x | tty -s", 1)).toEqual([]);
  });
});

describe("cal", () => {
  it("draws a month with the names in Portuguese and the week starting on Sunday", async () => {
    const output = await lines("cal 2 2024");
    expect(output[0]).toBe("   fevereiro 2024");
    expect(output[1]).toBe("Do Se Te Qu Qu Se Sá");
    expect(output[2]).toBe("             1  2  3");
    expect(output[output.length - 1]).toBe("25 26 27 28 29");
  });

  it("draws a whole year, and today's month when there are no arguments", async () => {
    const year = await lines("cal 2024");
    expect(year[0]!.trim()).toBe("2024");
    expect(year.join("\n")).toContain("janeiro");
    expect(year.join("\n")).toContain("dezembro");
    const now = new Date();
    expect((await lines("cal"))[0]).toContain(String(now.getFullYear()));
  });

  it("refuses an impossible month, year or number of arguments", async () => {
    expect((await run("cal 13 2024")).status).toBe(1);
    expect((await run("cal 2 0")).status).toBe(1);
    expect((await run("cal x")).status).toBe(1);
    expect((await run("cal 1 2 3")).status).toBe(1);
  });
});

describe("whereis and whatis", () => {
  it("whereis gives the program and the manual of known commands", async () => {
    expect(await lines("whereis ls")).toEqual(["ls: /usr/bin/ls /usr/share/man/man1/ls.1.gz"]);
    expect(await lines("whereis ufw")).toEqual(["ufw: /usr/sbin/ufw /usr/share/man/man1/ufw.1.gz"]);
    expect(await lines("whereis cd")).toEqual(["cd: /usr/share/man/man1/cd.1.gz"]);
    expect(await lines("whereis zzz")).toEqual(["zzz:"]);
    expect((await run("whereis")).status).toBe(1);
  });

  it("whatis gives one line per command, and 16 for an unknown one", async () => {
    const output = await lines("whatis tac");
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^tac \(1\)\s+- mostra o arquivo de trás para frente/);
    const missing = await run("whatis zzz");
    expect(missing.status).toBe(16);
    expect(missing.output).toBe("zzz: nada apropriado.");
    expect((await run("whatis")).status).toBe(1);
  });
});

describe("the binaries of the new commands (RN-01)", () => {
  it("are in the PATH like any program: which, type and ls /usr/bin find them", async () => {
    expect(await lines("which tac nproc")).toEqual(["/usr/bin/tac", "/usr/bin/nproc"]);
    expect((await lines("type seq"))[0]).toContain("seq");
    expect((await lines("ls /usr/bin | grep -c -E '^(tac|seq|nproc)$'"))[0]).toBe("3");
  });
});

describe("processes", () => {
  it("time runs the command and reports real, user and sys with its exit status, in the folder and as the user of the shell (CA-08)", async () => {
    const ok = await run("time echo oi");
    expect(ok.status).toBe(0);
    expect(ok.output).toMatch(/^oi\n\nreal\t0m\d,\d{3}s\nuser\t0m0,000s\nsys\t0m0,000s$/);
    expect((await run("time false")).status).toBe(1);
    expect((await run("cd /tmp && time ls -d .")).output).toMatch(/^\.\n/);
    await run("cd /root");
    const bare = await run("time");
    expect(bare.status).toBe(0);
    expect(bare.output).toContain("real\t0m0,000s");
  });
});
