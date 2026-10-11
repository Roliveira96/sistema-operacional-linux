import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";
import { md5, sha256 } from "./digest";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  for (const command of [
    "mkdir -p /tmp/t",
    "cd /tmp/t",
    "printf 'banana\\napple\\ncherry\\napple\\n' > f.txt",
    "printf 'hello world\\n' > a.txt",
    "printf 'a\\nb\\nc\\n' > x.txt",
    "printf 'a\\nB\\nc\\nd\\n' > y.txt",
  ]) {
    await win.execute({ command });
  }
});
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

const run = (command: string) => win.execute({ command });
const expectOutput = async (command: string, expected: string[], status = 0) => {
  const result = await run(command);
  expect(result.output === "" ? [] : result.output.split("\n")).toEqual(expected);
  expect(result.status).toBe(status);
};

// Covers SPEC-028 CA-02, CA-04, CA-05, CA-06, CA-07 for the text and file commands.
describe("digests (RN-04, CA-06)", () => {
  it("computes MD5 and SHA-256 like the Ubuntu tools", () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(md5(bytes(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5(bytes("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5(bytes("The quick brown fox jumps over the lazy dog"))).toBe("9e107d9d372bb6826bd81d3542a419d6");
    expect(sha256(bytes(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256(bytes("a".repeat(1000)))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
});

describe("tac, paste, rev, nl", () => {
  it("tac reverses the lines, from a file and from a pipe, and fails on a missing file", async () => {
    await expectOutput("tac f.txt", ["apple", "cherry", "apple", "banana"]);
    await expectOutput("printf 'b\\na\\n' | tac", ["a", "b"]);
    const missing = await run("tac nada.txt");
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("nada.txt");
  });

  it("paste joins files side by side, with a delimiter and in serial", async () => {
    await expectOutput("paste a.txt a.txt", ["hello world\thello world"]);
    await expectOutput("paste -d, x.txt y.txt", ["a,a", "b,B", "c,c", ",d"]);
    await expectOutput("paste -s -d, f.txt", ["banana,apple,cherry,apple"]);
  });

  it("rev reverses each line, from a pipe too", async () => {
    await expectOutput("echo linux | rev", ["xunil"]);
    await expectOutput("rev a.txt", ["dlrow olleh"]);
  });

  it("nl numbers the non empty lines, all of them with -b a, with width and separator", async () => {
    await expectOutput("nl x.txt", ["     1\ta", "     2\tb", "     3\tc"]);
    await expectOutput("printf 'a\\n\\nb\\n' | nl", ["     1\ta", "       ", "     2\tb"]);
    await expectOutput("printf 'a\\n\\nb\\n' | nl -b a -w 3 -s :", ["  1:a", "  2:", "  3:b"]);
    expect((await run("nl -b z x.txt")).status).toBe(1);
  });
});

describe("diff", () => {
  it("exits 0 for equal files, 1 for different ones and 2 on error (CA-05)", async () => {
    expect((await run("diff a.txt a.txt")).status).toBe(0);
    expect((await run("diff x.txt y.txt")).status).toBe(1);
    expect((await run("diff x.txt nada.txt")).status).toBe(2);
    expect((await run("diff x.txt")).status).toBe(2);
  });

  it("writes the normal format", async () => {
    await expectOutput("diff x.txt y.txt", ["2c2", "< b", "---", "> B", "3a4", "> d"], 1);
    await expectOutput("printf 'a\\nb\\nc\\n' > z.txt && diff x.txt z.txt", [], 0);
    await expectOutput("printf 'a\\nc\\n' > w.txt && diff x.txt w.txt", ["2d1", "< b"], 1);
  });

  it("writes the unified format with context and the brief message", async () => {
    const unified = await run("diff -u x.txt y.txt");
    const lines = unified.output.split("\n");
    expect(lines[0]).toMatch(/^--- x\.txt\t/);
    expect(lines[1]).toMatch(/^\+\+\+ y\.txt\t/);
    expect(lines.slice(2)).toEqual(["@@ -1,3 +1,4 @@", " a", "-b", "+B", " c", "+d"]);
    await expectOutput("diff -q x.txt y.txt", ["Os arquivos x.txt e y.txt são diferentes"], 1);
  });
});

describe("xxd and base64", () => {
  it("xxd dumps the bytes with the address and the text, plain and limited", async () => {
    await expectOutput("printf 'hello world\\n' | xxd", ["00000000: 6865 6c6c 6f20 776f 726c 640a            hello world."]);
    await expectOutput("printf 'hello world\\n' | xxd -p", ["68656c6c6f20776f726c640a"]);
    await expectOutput("printf 'hello world\\n' | xxd -l 3", ["00000000: 6865 6c                                  hel"]);
    await expectOutput("printf 'abcdefgh' | xxd -c 4", ["00000000: 6162 6364  abcd", "00000004: 6566 6768  efgh"]);
    expect((await run("xxd -c 0 a.txt")).status).toBe(1);
  });

  it("base64 encodes, decodes, wraps and refuses invalid input", async () => {
    await expectOutput("echo oi | base64", ["b2kK"]);
    await expectOutput("echo b2kK | base64 -d", ["oi"]);
    await expectOutput("printf 'abcdefghij' | base64 -w 4", ["YWJj", "ZGVm", "Z2hp", "ag=="]);
    expect((await run("echo '!!' | base64 -d")).status).toBe(1);
    expect((await run("base64 -w x a.txt")).status).toBe(1);
  });
});

describe("md5sum and sha256sum", () => {
  it("print the real sums of a file and of the standard input", async () => {
    await expectOutput("printf abc | md5sum", ["900150983cd24fb0d6963f7d28e17f72  -"]);
    await expectOutput("printf abc | sha256sum", ["ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -"]);
    await expectOutput("printf abc > abc.txt && md5sum abc.txt", ["900150983cd24fb0d6963f7d28e17f72  abc.txt"]);
  });

  it("-c checks a list of sums, and fails when a file changed or is missing", async () => {
    await expectOutput("md5sum abc.txt > sums.md5 && md5sum -c sums.md5", ["abc.txt: OK"]);
    const changed = await run("echo mais >> abc.txt && md5sum -c sums.md5");
    expect(changed.output).toContain("abc.txt: FALHOU");
    expect(changed.status).toBe(1);
    expect((await run("md5sum nada.txt")).status).toBe(1);
  });
});

describe("seq, shuf, expr", () => {
  it("seq counts with first, step and last, separator and equal width", async () => {
    await expectOutput("seq 3", ["1", "2", "3"]);
    await expectOutput("seq 2 2 8", ["2", "4", "6", "8"]);
    await expectOutput("seq -w 8 10", ["08", "09", "10"]);
    await expectOutput("seq 1 0.5 2", ["1.0", "1.5", "2.0"]);
    await expectOutput("seq -s, 3", ["1,2,3"]);
    await expectOutput("seq 3 -1 1", ["3", "2", "1"]);
    expect((await run("seq x")).status).toBe(1);
    expect((await run("seq")).status).toBe(1);
    expect((await run("seq 1 0 5")).status).toBe(1);
  });

  it("shuf only reorders: the same lines come out, the count is respected", async () => {
    await expectOutput("shuf -e c a b | sort", ["a", "b", "c"]);
    await expectOutput("shuf -i 1-3 | sort", ["1", "2", "3"]);
    await expectOutput("shuf -n 1 f.txt | wc -l", ["1"]);
    await expectOutput("shuf f.txt | sort | uniq -c | wc -l", ["3"]);
    expect((await run("shuf -i x-y")).status).toBe(1);
  });

  it("expr calculates, compares and answers with the status of the result", async () => {
    await expectOutput("expr 2 + 3", ["5"]);
    await expectOutput("expr 7 % 3", ["1"]);
    await expectOutput("expr 4 '*' 5", ["20"]);
    await expectOutput("expr 9 / 2", ["4"]);
    await expectOutput("expr 2 + 3 '*' 4", ["14"]);
    await expectOutput("expr 1 = 2", ["0"], 1);
    await expectOutput("expr 3 '>' 2", ["1"]);
    await expectOutput("expr length hello", ["5"]);
    await expectOutput("expr substr hello 2 3", ["ell"]);
    await expectOutput("expr abc '<' abd", ["1"]);
    expect((await run("expr 1 / 0")).status).toBe(2);
    expect((await run("expr")).status).toBe(2);
    expect((await run("expr 1 +")).status).toBe(2);
    expect((await run("expr a + 1")).status).toBe(2);
  });
});

describe("basename, dirname, file", () => {
  it("basename and dirname split a path", async () => {
    await expectOutput("basename /tmp/lab/a.txt", ["a.txt"]);
    await expectOutput("basename /tmp/lab/a.txt .txt", ["a"]);
    await expectOutput("basename -a /x/a /y/b", ["a", "b"]);
    await expectOutput("basename -s .c /src/main.c /src/util.c", ["main", "util"]);
    await expectOutput("basename /", ["/"]);
    await expectOutput("dirname /tmp/lab/a.txt", ["/tmp/lab"]);
    await expectOutput("dirname a.txt /x/y/", [".", "/x"]);
    await expectOutput("dirname /a", ["/"]);
    expect((await run("basename")).status).toBe(1);
    expect((await run("dirname")).status).toBe(1);
  });

  it("file tells the kind of each node", async () => {
    await run("touch vazio.txt && printf '#!/bin/bash\\necho oi\\n' > s.sh && chmod +x s.sh && ln -s a.txt atalho && printf 'café\\n' > u.txt");
    await expectOutput("file a.txt", ["a.txt: ASCII text"]);
    await expectOutput("file vazio.txt", ["vazio.txt: empty"]);
    await expectOutput("file /tmp", ["/tmp: directory"]);
    await expectOutput("file s.sh", ["s.sh: Bourne-Again shell script, ASCII text executable"]);
    await expectOutput("file atalho", ["atalho: symbolic link to a.txt"]);
    await expectOutput("file -b a.txt", ["ASCII text"]);
    await expectOutput("file u.txt", ["u.txt: Unicode text, UTF-8 text"]);
    const missing = await run("file nada.txt");
    expect(missing.status).toBe(0);
    expect(missing.output).toContain("cannot open");
    expect((await run("file")).status).toBe(1);
  });
});

describe("options and errors common to the commands (CA-05)", () => {
  it.each(["tac", "paste", "rev", "nl", "seq 1", "xxd", "base64", "md5sum", "diff a b", "basename x", "dirname x", "file x", "shuf -e a", "nproc", "cal", "tty", "ifconfig"])(
    "%s rejects an unknown option",
    async (command) => {
      const result = await run(`${command} --nao-existe`);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("nao-existe");
    },
  );
});
