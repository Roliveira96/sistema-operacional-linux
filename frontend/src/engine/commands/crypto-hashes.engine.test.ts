import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";
import { base32Decode, base32Encode, posixCksum } from "./encoding";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  await win.execute({ command: "mkdir -p /tmp/c && cd /tmp/c" });
  await win.execute({ command: "printf abc > abc.txt" });
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

// Covers SPEC-031 CA-01 and CA-02: the sums and the dumps give what Ubuntu gives.
describe("the sums of the SHA family and MD5 (CA-01)", () => {
  it.each([
    ["sha1sum", "a9993e364706816aba3e25717850c26c9cd0d89d"],
    ["sha224sum", "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7"],
    ["sha256sum", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["sha384sum", "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7"],
    ["sha512sum", "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"],
    ["md5sum", "900150983cd24fb0d6963f7d28e17f72"],
  ])("%s of abc", async (command, sum) => {
    expect(await lines(`${command} abc.txt`)).toEqual([`${sum}  abc.txt`]);
    expect(await lines(`printf abc | ${command}`)).toEqual([`${sum}  -`]);
  });

  it("each sum conferes a list, with --check and --ignore-missing, and 1 when a file changed (CA-02)", async () => {
    await run("sha256sum abc.txt > SUMS");
    expect(await lines("sha256sum -c SUMS")).toEqual(["abc.txt: OK"]);
    expect(await lines("sha256sum --check SUMS")).toEqual(["abc.txt: OK"]);
    await run("sha512sum abc.txt > SUMS512");
    expect(await lines("sha512sum -c SUMS512")).toEqual(["abc.txt: OK"]);
    await run("echo mais >> abc.txt");
    const changed = await run("sha256sum -c SUMS");
    expect(changed.status).toBe(1);
    expect(changed.output).toContain("abc.txt: FALHOU");
    await run("echo '0000  nada.txt' > MISSING && sha256sum abc.txt >> MISSING");
    expect((await run("sha256sum -c MISSING")).status).toBe(1);
    const ignored = await run("sha256sum -c --ignore-missing MISSING");
    expect(ignored.output).not.toContain("nada.txt");
    await run("printf abc > abc.txt");
  });

  it("a list with no valid line is an error", async () => {
    await run("echo nada > VAZIA");
    expect((await run("sha256sum -c VAZIA")).status).toBe(1);
  });
});

describe("cksum, base32, od and hexdump (CA-01)", () => {
  it("cksum gives the POSIX checksum and the size", async () => {
    expect(posixCksum(new TextEncoder().encode("123456789"))).toBe(930766865);
    expect(posixCksum(new Uint8Array(0))).toBe(4294967295);
    expect(await lines("printf 123456789 | cksum")).toEqual(["930766865 9"]);
    expect(await lines("cksum abc.txt")).toEqual([`${posixCksum(new TextEncoder().encode("abc"))} 3 abc.txt`]);
    expect((await run("cksum nada")).status).toBe(1);
  });

  it("base32 follows RFC 4648 and goes both ways", async () => {
    const encode = (text: string) => base32Encode(new TextEncoder().encode(text));
    expect(encode("")).toBe("");
    expect(encode("f")).toBe("MY======");
    expect(encode("fo")).toBe("MZXQ====");
    expect(encode("foo")).toBe("MZXW6===");
    expect(encode("foobar")).toBe("MZXW6YTBOI======");
    expect(new TextDecoder().decode(base32Decode("MZXW6YTBOI======")!)).toBe("foobar");
    expect(base32Decode("1!")).toBeNull();
    expect(await lines("printf foobar | base32")).toEqual(["MZXW6YTBOI======"]);
    expect(await lines("printf foobar | base32 | base32 -d")).toEqual(["foobar"]);
    expect(await lines("printf foobar | base32 -w 8")).toEqual(["MZXW6YTB", "OI======"]);
    expect((await run("echo '1!' | base32 -d")).status).toBe(1);
    expect((await run("base32 -w x abc.txt")).status).toBe(1);
  });

  it("od shows the bytes in the format asked", async () => {
    expect(await lines("printf 'hello\\n' | od -A x -t x1")).toEqual(["000000 68 65 6c 6c 6f 0a", "000006"]);
    expect(await lines("printf 'hello\\n' | od -A n -t x1")).toEqual([" 68 65 6c 6c 6f 0a"]);
    expect(await lines("printf 'hi\\n' | od -t c")).toEqual(["0000000   h   i  \\n", "0000003"]);
    expect(await lines("printf 'hi' | od -A n -t d1")).toEqual(["  104  105"]);
    expect(await lines("printf 'hi' | od -A n -t u1 -N 1")).toEqual([" 104"]);
    expect(await lines("printf 'hi' | od -A n -t o1")).toEqual([" 150 151"]);
    expect((await lines("printf 'hello' | od"))[0]).toBe("0000000 062550 066154 000157");
    expect((await run("od -t z abc.txt")).status).toBe(1);
  });

  it("hexdump -C shows the canonical dump and the default shows words", async () => {
    expect(await lines("printf 'hello world\\n' | hexdump -C")).toEqual(["00000000  68 65 6c 6c 6f 20 77 6f  72 6c 64 0a              |hello world.|", "0000000c"]);
    expect(await lines("printf 'hi' | hexdump")).toEqual(["0000000 6968", "0000002"]);
    expect(await lines("printf '' | hexdump -C")).toEqual([]);
  });

  it("the dumps and sums read text with accents, and base64 goes both ways on it", async () => {
    await run("echo café > acento.txt");
    expect((await lines("md5sum acento.txt"))[0]).toMatch(/^[0-9a-f]{32}  acento.txt$/);
    expect(await lines("base64 acento.txt | base64 -d")).toEqual(["café"]);
  });
});
