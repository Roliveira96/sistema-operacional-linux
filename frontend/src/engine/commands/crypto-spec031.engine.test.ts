import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  await win.execute({ command: "mkdir -p /tmp/c && cd /tmp/c" });
}, 60000);
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

const run = (command: string, answers?: string[]) => win.execute({ command, answers });
const ok = async (command: string, answers?: string[]) => {
  const result = await run(command, answers);
  expect(result.status, `${command}: ${result.output}`).toBe(0);
  return result.output;
};

// Covers SPEC-031 CA-03: the HMAC is the one of the standards, with the vectors of RFC 2202 and RFC 4231 (key "Jefe", test case 2).
describe("openssl dgst -hmac, with the vectors of the standards", () => {
  const MESSAGE = "what do ya want for nothing?";
  const vectors: [string, string][] = [
    ["-md5", "750c783e6ab0b503eaa86e310a5db738"],
    ["-sha1", "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79"],
    ["-sha256", "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"],
    ["-sha512", "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737"],
  ];
  it.each(vectors)("%s gives the digest of the standard", async (option, digest) => {
    await ok(`printf '%s' '${MESSAGE}' > hmac.txt`);
    const output = await ok(`openssl dgst ${option} -hmac Jefe hmac.txt`);
    expect(output.trim().split(/\s+/).at(-1)).toBe(digest);
    expect(output).toMatch(/^HMAC-/);
  });
});

// Covers SPEC-031 CA-06: the public key goes out in PEM with the mode 644, and the private one with 600.
describe("the modes of the files of a pair of keys", () => {
  it("writes the private key with 600 and the public one with 644", async () => {
    await ok("openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem");
    await ok("openssl rsa -in priv.pem -pubout -out pub.pem");
    expect((await ok("stat -c %a priv.pem")).trim()).toBe("600");
    expect((await ok("stat -c %a pub.pem")).trim()).toBe("644");
    expect(await ok("head -n 1 pub.pem")).toContain("-----BEGIN PUBLIC KEY-----");
  });
});

// Covers SPEC-031 CA-13 (RN-07): the algorithms that were broken and removed answer as unknown to the simulator, and end with 1.
describe("the algorithms that were removed", () => {
  it.each([
    "openssl dgst -md4 msg.txt",
    "openssl dgst -md2 msg.txt",
    "openssl enc -rc4 -pbkdf2 -in msg.txt -out out.bin -pass pass:x",
    "openssl enc -des -pbkdf2 -in msg.txt -out out.bin -pass pass:x",
  ])("%s says the algorithm is unknown to the simulator", async (command) => {
    await ok("printf 'segredo' > msg.txt");
    const result = await run(command);
    expect(result.status, command).toBe(1);
    expect(result.output, command).toContain("algoritmo desconhecido no simulador");
  });

  it("still refuses an RSA size that is not offered", async () => {
    const result = await run("openssl genrsa 3000");
    expect(result.status).toBe(1);
    expect(result.output).toContain("use 1024, 2048 ou 4096");
  });
});

// Covers SPEC-031 CA-14 (RN-10): what would open a connection says the simulator does not, and ends with 1.
describe("the openssl subcommands that need the network", () => {
  it.each(["openssl s_client -connect exemplo.com:443", "openssl s_server -accept 4433", "openssl speed"])("%s is refused", async (command) => {
    const result = await run(command);
    expect(result.status, command).toBe(1);
    expect(result.output, command).toContain("não abre conexões de rede");
  });
});

// Covers SPEC-031 CA-16 (RN-12): keys, certificates and encrypted files come back the same when the machine is saved and restored.
describe("the machine saved and restored", () => {
  it("keeps the keys, the certificate and the encrypted file, and they still work", async () => {
    await ok("printf 'recado secreto' > recado.txt");
    await ok("openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out chave.pem");
    await ok("openssl req -x509 -new -key chave.pem -subj /CN=aula -days 30 -out cert.pem");
    await ok("openssl enc -aes-256-cbc -pbkdf2 -in recado.txt -out recado.enc -pass pass:treino");
    await ok("ssh-keygen -t ed25519 -f id_aula -N ''");
    const files = ["chave.pem", "cert.pem", "recado.enc", "id_aula", "id_aula.pub"];
    const sums = async () => (await ok(`sha256sum ${files.join(" ")}`)).split("\n").filter(Boolean).map((l) => l.split(/\s+/)[0]);
    const modes = async () => (await ok(`stat -c '%a' ${files.join(" ")}`)).trim().split("\n");
    const before = { sums: await sums(), modes: await modes() };

    await win.reset(win.snapshot());

    await ok("cd /tmp/c");
    expect({ sums: await sums(), modes: await modes() }).toEqual(before);
    expect(await ok("openssl enc -d -aes-256-cbc -pbkdf2 -in recado.enc -pass pass:treino")).toBe("recado secreto");
    expect(await ok("openssl x509 -in cert.pem -noout -subject")).toContain("aula");
    expect(await ok("ssh-keygen -l -f id_aula.pub")).toContain("ED25519");
  });
});
