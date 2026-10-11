import { createDecipheriv, createHash, createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  await win.execute({ command: "mkdir -p /tmp/o && cd /tmp/o && printf 'segredo da aula' > msg.txt" });
}, 30000);
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
/** The exact bytes of a file of the machine, read through base64. */
const bytesOf = async (path: string) => Buffer.from((await ok(`base64 ${path}`)).replace(/\s/g, ""), "base64");

// Covers SPEC-031 CA-03 to CA-09: openssl does real cryptography, in the formats of Ubuntu.
describe("openssl: rand, dgst, passwd", () => {
  it("rand gives the number of bytes asked", async () => {
    expect(await ok("openssl rand -hex 16")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("dgst prints the digest the OpenSSL 3 way and agrees with sha256sum", async () => {
    const expected = createHash("sha256").update("segredo da aula").digest("hex");
    expect(await ok("openssl dgst -sha256 msg.txt")).toBe(`SHA2-256(msg.txt)= ${expected}`);
    expect(await ok("openssl dgst msg.txt")).toBe(`SHA2-256(msg.txt)= ${expected}`);
    expect(await ok("sha256sum msg.txt")).toBe(`${expected}  msg.txt`);
    expect(await ok("openssl dgst -sha1 -hmac chave msg.txt")).toMatch(/^HMAC-SHA1\(msg.txt\)= [0-9a-f]{40}$/);
  });

  it("passwd makes the hash of /etc/shadow, and fails on an unknown subcommand", async () => {
    expect(await ok("openssl passwd -6 -salt abcdefgh senha")).toMatch(/^\$6\$abcdefgh\$/);
    expect(await ok("openssl passwd -1 -salt abcdefgh senha")).toMatch(/^\$1\$abcdefgh\$/);
    const bad = await run("openssl naoexiste");
    expect(bad.status).toBe(1);
    expect(bad.output).toContain("Invalid command");
    expect((await run("openssl s_client -connect a:443")).status).toBe(1);
    expect(await ok("openssl version")).toMatch(/^OpenSSL/);
  });
});

describe("openssl enc", () => {
  it("encrypts with a password in the Salted__ format and decrypts back, and a wrong password fails (CA-04)", async () => {
    await ok("openssl enc -aes-256-cbc -pbkdf2 -pass pass:senha -in msg.txt -out msg.enc");
    expect((await bytesOf("msg.enc")).subarray(0, 8).toString()).toBe("Salted__");
    expect(await ok("openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:senha -in msg.enc")).toBe("segredo da aula");
    const wrong = await run("openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:errada -in msg.enc");
    expect(wrong.status).toBe(1);
    expect(wrong.output).toContain("bad decrypt");
  });

  it("asks twice for the password when none is given", async () => {
    await ok("openssl enc -aes-128-cbc -pbkdf2 -in msg.txt -out msg2.enc", ["x1", "x1"]);
    expect(await ok("openssl enc -d -aes-128-cbc -pbkdf2 -in msg2.enc", ["x1"])).toContain("segredo da aula");
    const mismatch = await run("openssl enc -aes-128-cbc -pbkdf2 -in msg.txt -out msg3.enc", ["a", "b"]);
    expect(mismatch.status).toBe(1);
  });

  it("with -K and -iv gives the bytes Node gives (CA-05) and -a makes base64", async () => {
    const key = "00112233445566778899aabbccddeeff";
    const iv = "0f0e0d0c0b0a09080706050403020100";
    await ok(`openssl enc -aes-128-cbc -K ${key} -iv ${iv} -in msg.txt -out raw.enc`);
    const decipher = createDecipheriv("aes-128-cbc", Buffer.from(key, "hex"), Buffer.from(iv, "hex"));
    expect(Buffer.concat([decipher.update(await bytesOf("raw.enc")), decipher.final()]).toString()).toBe("segredo da aula");
    const armored = await ok(`openssl enc -aes-128-cbc -a -K ${key} -iv ${iv} -in msg.txt`);
    expect(Buffer.from(armored.replace(/\s/g, ""), "base64").equals(await bytesOf("raw.enc"))).toBe(true);
  });
});

describe("openssl keys, signatures and encryption", () => {
  it("genrsa writes a private key with mode 600, and rsa -pubout gives a public one Node reads (CA-06)", async () => {
    await ok("openssl genrsa -out priv.pem 2048");
    expect(await ok("stat -c %a priv.pem")).toBe("600");
    expect(await ok("head -n 1 priv.pem")).toBe("-----BEGIN PRIVATE KEY-----");
    await ok("openssl rsa -in priv.pem -pubout -out pub.pem");
    expect(createPublicKey(await ok("cat pub.pem")).asymmetricKeyType).toBe("rsa");
    expect(await ok("openssl rsa -in priv.pem -check -noout")).toBe("RSA key ok");
    expect(await ok("openssl rsa -in priv.pem -noout -text | head -n 1")).toBe("Private-Key: (2048 bit, 2 primes)");
    expect(await ok("openssl rsa -in priv.pem")).toContain("BEGIN RSA PRIVATE KEY");
    expect((await run("openssl genrsa 3000")).status).toBe(1);
  }, 30000);

  it("dgst -sign makes a signature Node verifies, and -verify detects a changed file (CA-07)", async () => {
    await ok("openssl dgst -sha256 -sign priv.pem -out msg.sig msg.txt");
    const verifier = createVerify("sha256").update("segredo da aula");
    expect(verifier.verify(await ok("cat pub.pem"), await bytesOf("msg.sig"))).toBe(true);
    expect(await ok("openssl dgst -sha256 -verify pub.pem -signature msg.sig msg.txt")).toBe("Verified OK");
    await ok("printf 'segredo alterado' > outra.txt");
    const bad = await run("openssl dgst -sha256 -verify pub.pem -signature msg.sig outra.txt");
    expect(bad.status).toBe(1);
    expect(bad.output).toContain("Verification failure");
  });

  it("pkeyutl encrypts with the public key and decrypts with the private one, in both paddings (CA-08)", async () => {
    await ok("openssl pkeyutl -encrypt -pubin -inkey pub.pem -in msg.txt -out msg.rsa");
    expect(await ok("openssl pkeyutl -decrypt -inkey priv.pem -in msg.rsa")).toBe("segredo da aula");
    await ok("openssl pkeyutl -encrypt -pubin -inkey pub.pem -pkeyopt rsa_padding_mode:oaep -in msg.txt -out msg.oaep");
    expect(await ok("openssl pkeyutl -decrypt -inkey priv.pem -pkeyopt rsa_padding_mode:oaep -in msg.oaep")).toBe("segredo da aula");
    expect((await run("openssl pkeyutl -decrypt -inkey priv.pem -in msg.txt")).status).toBe(1);
    await ok("openssl pkeyutl -sign -inkey priv.pem -rawin -digest sha256 -in msg.txt -out p.sig");
    expect(await ok("openssl pkeyutl -verify -pubin -inkey pub.pem -rawin -digest sha256 -in msg.txt -sigfile p.sig")).toBe("Signature Verified Successfully");
  }, 30000);

  it("works with Ed25519 keys (RN-14)", async () => {
    await ok("openssl genpkey -algorithm ED25519 -out ed.pem");
    await ok("openssl pkey -in ed.pem -pubout -out edpub.pem");
    await ok("openssl pkeyutl -sign -inkey ed.pem -rawin -in msg.txt -out ed.sig");
    expect(await ok("openssl pkeyutl -verify -pubin -inkey edpub.pem -rawin -in msg.txt -sigfile ed.sig")).toBe("Signature Verified Successfully");
  });
});

describe("openssl req, x509 and verify", () => {
  it("req -x509 makes a self-signed certificate Node reads, and x509 shows its fields (CA-09)", async () => {
    await ok("openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 365 -subj /C=BR/O=UTFPR/CN=AC-Aula");
    const certificate = new X509Certificate(await ok("cat ca.crt"));
    expect(certificate.subject).toContain("CN=AC-Aula");
    expect(certificate.ca).toBe(true);
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(await ok("openssl x509 -in ca.crt -noout -subject")).toBe("subject=C = BR, O = UTFPR, CN = AC-Aula");
    expect(await ok("openssl x509 -in ca.crt -noout -issuer")).toBe("issuer=C = BR, O = UTFPR, CN = AC-Aula");
    expect(await ok("openssl x509 -in ca.crt -noout -dates")).toMatch(/^notBefore=.* GMT\nnotAfter=.* GMT$/);
    expect(await ok("openssl x509 -in ca.crt -noout -fingerprint -sha256")).toBe(`SHA256 Fingerprint=${certificate.fingerprint256}`);
    expect(await ok("openssl verify -CAfile ca.crt ca.crt")).toBe("ca.crt: OK");
  }, 30000);

  it("signs a request with the CA, and verify accepts the chain and refuses a stranger", async () => {
    await ok("openssl req -new -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj /CN=servidor.aula");
    expect(await ok("openssl req -in srv.csr -verify -noout")).toContain("verify OK");
    await ok("openssl x509 -req -in srv.csr -CA ca.crt -CAkey ca.key -days 30 -out srv.crt");
    const server = new X509Certificate(await ok("cat srv.crt"));
    const authority = new X509Certificate(await ok("cat ca.crt"));
    expect(server.verify(authority.publicKey)).toBe(true);
    expect(server.checkIssued(authority)).toBe(true);
    expect(await ok("openssl verify -CAfile ca.crt srv.crt")).toBe("srv.crt: OK");

    await ok("openssl req -x509 -newkey rsa:1024 -nodes -keyout o.key -out outra.crt -subj /CN=Outra-AC");
    const rejected = await run("openssl verify -CAfile outra.crt srv.crt");
    expect(rejected.status).toBe(2);
    expect(rejected.output).toContain("error 20");
  }, 60000);

  it("asks for the name fields when there is no -subj", async () => {
    await ok("openssl req -x509 -newkey rsa:1024 -nodes -keyout p.key -out p.crt", ["BR", "PR", "Curitiba", "UTFPR", ".", "perguntado", "."]);
    expect(await ok("openssl x509 -in p.crt -noout -subject")).toBe("subject=C = BR, ST = PR, L = Curitiba, O = UTFPR, CN = perguntado");
  }, 30000);
});
