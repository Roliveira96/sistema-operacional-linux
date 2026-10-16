import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  for (const command of ["mkdir -p /tmp/lab/pasta", "cd /tmp/lab", "echo 'hello world' > a.txt", "echo banana > frutas.txt", "echo b > pasta/b.txt"]) {
    await win.execute({ command });
  }
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

const VAR_ONE_LEVEL = ["4,0K\t/var/backups", "12K\t/var/cache", "24K\t/var/lib", "24K\t/var/log", "4,0K\t/var/mail", "12K\t/var/spool", "4,0K\t/var/tmp", "88K\t/var"];

// Covers SPEC-028 CA-16: what the du of the engine already did must not change (RN-13), plus the new options.
describe("du keeps what it already showed (regression, CA-16)", () => {
  it.each([
    ["du", ["8\t./pasta", "20\t."]],
    ["du -h", ["8,0K\t./pasta", "20K\t."]],
    ["du -s", ["20\t."]],
    ["du -sh .", ["20K\t."]],
    ["du -a pasta", ["4\tpasta/b.txt", "8\tpasta"]],
    ["du -ah pasta", ["4,0K\tpasta/b.txt", "8,0K\tpasta"]],
    ["du -sh /var/log", ["24K\t/var/log"]],
    ["du -hs /etc", ["108K\t/etc"]],
    ["du -h -d 0 /etc", ["108K\t/etc"]],
    ["du -h --max-depth=1 /var", VAR_ONE_LEVEL],
    ["du -d 1 -h /var", VAR_ONE_LEVEL],
  ])("%s", async (command, expected) => {
    expect(await lines(command)).toEqual(expected);
  });

  it("still pipes into sort and head", async () => {
    expect((await lines("du -h /var | sort -rh | head -n 1"))[0]).toBe("88K\t/var");
  });
});

describe("du, new behavior (CA-16)", () => {
  it("lists the files given as arguments, with and without -s", async () => {
    expect(await lines("du -sh *")).toEqual(["4,0K\ta.txt", "4,0K\tfrutas.txt", "8,0K\tpasta"]);
    expect(await lines("du a.txt frutas.txt")).toEqual(["4\ta.txt", "4\tfrutas.txt"]);
    expect(await lines("du -sh pasta a.txt")).toEqual(["8,0K\tpasta", "4,0K\ta.txt"]);
  });

  it("adds the total with -c and --total", async () => {
    expect(await lines("du -c a.txt frutas.txt")).toEqual(["4\ta.txt", "4\tfrutas.txt", "8\ttotal"]);
    expect(await lines("du -shc a.txt frutas.txt")).toEqual(["4,0K\ta.txt", "4,0K\tfrutas.txt", "8,0K\ttotal"]);
    expect(await lines("du --total -sh pasta")).toEqual(["8,0K\tpasta", "8,0K\ttotal"]);
  });

  it("shows the sizes in KB, MB, bytes, a block size, powers of 1000 and apparent size", async () => {
    expect(await lines("du -k pasta")).toEqual(["8\tpasta"]);
    expect(await lines("du -m pasta")).toEqual(["1\tpasta"]);
    expect(await lines("du -b a.txt")).toEqual(["12\ta.txt"]);
    expect(await lines("du -s --block-size=1K pasta")).toEqual(["8\tpasta"]);
    expect(await lines("du -sBM pasta")).toEqual(["1\tpasta"]);
    expect(await lines("du -B 4K -s pasta")).toEqual(["2\tpasta"]);
    expect(await lines("du --si -sh a.txt")).toEqual(["4,1k\ta.txt"]);
    expect(await lines("du --apparent-size -sh pasta")).toEqual(["4,1K\tpasta"]);
    expect(await lines("du -bs a.txt frutas.txt")).toEqual(["12\ta.txt", "7\tfrutas.txt"]);
  });

  it("separates the folders with -S, skips what --exclude matches and accepts -x and -L", async () => {
    await run("mkdir -p s1/sub && echo x > s1/sub/x.txt && echo y > s1/y.txt");
    expect(await lines("du s1")).toEqual(["8\ts1/sub", "16\ts1"]);
    expect(await lines("du -S s1")).toEqual(["8\ts1/sub", "8\ts1"]);
    expect(await lines("du --exclude='*.txt' -sh .")).toEqual(["16K\t."]);
    expect(await lines("du -sx /tmp/lab/pasta")).toEqual(["8\t/tmp/lab/pasta"]);
    await run("ln -s pasta atalho");
    expect(await lines("du -sL atalho")).toEqual(["8\tatalho"]);
    expect(await lines("du -s atalho")).toEqual(["0\tatalho"]);
    expect(await lines("du -a atalho")).toEqual(["0\tatalho"]);
  });

  it("ends each line with NUL on -0", async () => {
    const result = await run("du -0 a.txt");
    expect(result.status).toBe(0);
    expect(result.output).toContain("4\ta.txt\0");
  });

  it("continues after a path that does not exist and fails with 1, and on an unknown option", async () => {
    const result = await run("du -sh /root/naoexiste a.txt");
    expect(result.status).toBe(1);
    expect(result.output).toContain("du: não foi possível acessar '/root/naoexiste': Arquivo ou diretório inexistente");
    expect(result.output).toContain("4,0K\ta.txt");
    const unknown = await run("du -z");
    expect(unknown.status).toBe(1);
    expect(unknown.output).toContain("du: opção inválida -- 'z'");
    expect((await run("du -B xx a.txt")).status).toBe(1);
    expect((await run("du -d x .")).status).toBe(1);
  });

  it("refuses a folder it may not read", async () => {
    await run("mkdir -p fechada && chmod 000 fechada");
    await run("useradd -m bia");
    await win.execute({ command: "passwd bia", answers: ["123", "123"] });
    const result = await win.execute({ command: "du /tmp/lab/fechada", terminal: 2, login: { user: "bia", password: "123" } });
    expect(result.status).toBe(1);
    expect(result.output).toContain("du: não foi possível ler o diretório '/tmp/lab/fechada': Permissão negada");
  });
});

describe("dd (RN-09, CA-11)", () => {
  it("creates a file of zeros of the size asked and reports the records", async () => {
    const result = await run("dd if=/dev/zero of=z.img bs=1k count=4");
    expect(result.status).toBe(0);
    expect(result.output.split("\n").slice(0, 2)).toEqual(["4+0 registros de entrada", "4+0 registros de saída"]);
    expect(result.output).toMatch(/4096 bytes \(4,1 kB, 4,0 KiB\) copiados, 0,0001 s, [\d,]+ MB\/s/);
    expect((await lines("ls -l z.img"))[0]).toMatch(/\s4096\s/);
  });

  it("copies a file, reads the standard input and writes to the screen without a destination", async () => {
    expect((await run("dd if=a.txt of=copia.txt status=none")).output).toBe("");
    expect(await lines("cat copia.txt")).toEqual(["hello world"]);
    expect((await lines("echo hi | dd status=none"))[0]).toBe("hi");
    expect((await lines("dd if=a.txt bs=5 count=1 status=none"))[0]).toBe("hello");
    expect((await run("dd if=a.txt of=p.txt bs=5")).output).toContain("2+1 registros de entrada");
    await run("dd if=/dev/urandom of=r.bin bs=16 count=1 status=none");
    expect((await lines("ls -l r.bin"))[0]).toMatch(/\s16\s/);
  });

  it("refuses more than 64 KiB without creating the file, and bad operands, numbers and sources", async () => {
    const big = await run("dd if=/dev/zero of=big.img bs=1M count=1");
    expect(big.status).toBe(1);
    expect(big.output).toContain("limita o arquivo gerado a 65536 bytes");
    expect((await run("ls big.img")).status).not.toBe(0);
    expect((await run("dd if=/dev/zero of=sem.img bs=1k")).status).toBe(1);
    expect((await run("dd if=/dev/zero of=x bs=65M count=1")).status).toBe(1);
    expect((await run("dd badop")).status).toBe(1);
    expect((await run("dd bs=x")).status).toBe(1);
    expect((await run("dd count=-1")).status).toBe(1);
    expect((await run("dd if=nada.txt of=x")).status).toBe(1);
    expect((await run("dd if=/tmp of=x")).status).toBe(1);
    expect((await run("dd if=a.txt of=/nada/x")).status).toBe(1);
  });
});

describe("swapon", () => {
  it("shows the swap of the machine, the same as free reports", async () => {
    const table = await lines("swapon --show");
    expect(table[0]).toMatch(/^NAME\s+TYPE\s+SIZE\s+USED\s+PRIO$/);
    expect(table[1]).toMatch(/^\/swap\.img file\s+\d+T\s+0B\s+-2$/);
    expect(await lines("swapon")).toEqual(table);
    expect((await run("swapon -z")).status).toBe(1);
  });
});

describe("the help of the commands changed by SPEC-028 (RN-14)", () => {
  it("du --help shows its help, with the new options", async () => {
    const help = (await lines("du --help")).join("\n");
    expect(help).toContain("du [OPÇÃO]... [ARQUIVO]...");
    expect(help).toContain("--apparent-size");
  });
});

// Covers SPEC-028 CA-15: the files that dd makes are part of the machine, and come back the same when it is saved and restored.
describe("dd and the saved machine (CA-15)", () => {
  it("keeps a file made by dd, with its size and content, after the machine is saved and restored", async () => {
    await run("dd if=/dev/zero of=img.bin bs=1k count=3 status=none");
    await run("dd if=a.txt of=copia-dd.txt status=none");
    const before = (await lines("sha256sum img.bin copia-dd.txt && ls -l img.bin | awk '{print $5}'")).join("\n");
    expect(before).toContain("copia-dd.txt");
    expect(before.endsWith("3072")).toBe(true);

    await win.reset(win.snapshot());

    await run("cd /tmp/lab");
    expect((await lines("sha256sum img.bin copia-dd.txt && ls -l img.bin | awk '{print $5}'")).join("\n")).toBe(before);
    expect((await lines("cat copia-dd.txt"))[0]).toBe("hello world");
  });
});
