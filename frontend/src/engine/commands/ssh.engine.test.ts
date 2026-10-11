import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";
import { fingerprint, publicLine, randomart } from "./crypto/ssh";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  await win.execute({ command: "mkdir -p /tmp/s && cd /tmp/s" });
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

const GITHUB_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

// Covers SPEC-031 CA-10 and CA-11: ssh-keygen and ssh-copy-id.
describe("the fingerprint and the randomart", () => {
  it("give what OpenSSH gives for a known key (the ed25519 key of GitHub)", async () => {
    const key = { type: "ed25519" as const, pub: Buffer.from(GITHUB_KEY, "base64").subarray(19) };
    expect(await fingerprint(key)).toBe("SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU");
    expect(publicLine(key, "")).toBe(`ssh-ed25519 ${GITHUB_KEY}`);
    const rows = (await randomart(key)).split("\n");
    expect(rows).toHaveLength(11);
    expect(rows[0]).toBe("+--[ED25519 256]--+");
    expect(rows[10]).toBe("+----[SHA256]-----+");
    expect(rows.slice(1, 10).every((row) => row.length === 19)).toBe(true);
    expect(rows.join("")).toContain("S");
    expect(rows.join("")).toContain("E");
  });
});

describe("ssh-keygen", () => {
  it("creates the pair with the modes 600 and 644 and shows the fingerprint (CA-10)", async () => {
    const output = await ok('ssh-keygen -t ed25519 -f chave -N "" -C aula@teste');
    expect(output).toContain("Your identification has been saved in chave");
    expect(output).toContain("Your public key has been saved in chave.pub");
    const printed = /(SHA256:\S+) aula@teste/.exec(output)?.[1];
    expect(printed).toBeDefined();
    expect(output).toContain("+--[ED25519 256]--+");
    expect(await ok("stat -c %a chave")).toBe("600");
    expect(await ok("stat -c %a chave.pub")).toBe("644");
    expect(await ok("head -n 1 chave")).toBe("-----BEGIN OPENSSH PRIVATE KEY-----");
    const line = await ok("cat chave.pub");
    expect(line).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\S+ aula@teste$/);
    const blob = Buffer.from(line.split(" ")[1]!, "base64");
    expect(`SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`).toBe(printed);
    expect(await ok("ssh-keygen -l -f chave.pub")).toBe(`256 ${printed} aula@teste (ED25519)`);
    expect(await ok("ssh-keygen -lf chave")).toBe(`256 ${printed} aula@teste (ED25519)`);
    expect(await ok("ssh-keygen -y -f chave")).toBe(line);
  });

  it("stores the real seed in the private key, so another tool derives the same public key", async () => {
    const body = (await ok("grep -v -- ----- chave")).replace(/\s/g, "");
    const data = Buffer.from(body, "base64");
    // after the header, the three strings (cipher, kdf, options), the count, the public blob and then the private section
    let at = "openssh-key-v1\0".length;
    const skip = () => (at += 4 + data.readUInt32BE(at));
    skip();
    skip();
    skip();
    at += 4;
    skip();
    at += 4 + 8 + 4 + "ssh-ed25519".length + 4 + 32 + 4;
    const seed = data.subarray(at, at + 32);
    const { createPrivateKey, createPublicKey } = await import("node:crypto");
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
    const derived = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(12);
    const blob = Buffer.from((await ok("cat chave.pub")).split(" ")[1]!, "base64");
    expect(derived.toString("hex")).toBe(blob.subarray(blob.length - 32).toString("hex"));
  });

  it("creates RSA keys of the size asked, and refuses what it does not offer", async () => {
    const output = await ok('ssh-keygen -t rsa -b 2048 -f rsa_chave -N "" -q');
    expect(output).toBe("");
    expect(await ok("ssh-keygen -l -f rsa_chave.pub")).toMatch(/^2048 SHA256:\S+ root@servidor \(RSA\)$/);
    expect(await ok("cut -d' ' -f1 rsa_chave.pub")).toBe("ssh-rsa");
    expect(await ok("ssh-keygen -l -f rsa_chave")).toBe(await ok("ssh-keygen -l -f rsa_chave.pub"));
    expect(await ok("ssh-keygen -y -f rsa_chave")).toBe(await ok("cat rsa_chave.pub"));
    expect((await run('ssh-keygen -t rsa -b 512 -f x -N ""')).output).toContain("minimum is 1024 bits");
    expect((await run('ssh-keygen -t ecdsa -f x -N ""')).status).toBe(1);
    expect((await run("ssh-keygen -t ed25519 -f y -N senha")).status).toBe(1);
  }, 30000);

  it("asks before overwriting, and the default place is ~/.ssh with a folder of mode 700", async () => {
    const output = await ok("ssh-keygen", ["", "", ""]);
    expect(output).toContain("Created directory '/root/.ssh'.");
    expect(output).toContain("Enter file in which to save the key (/root/.ssh/id_ed25519):");
    expect(await ok("stat -c %a /root/.ssh")).toBe("700");
    expect(await ok("stat -c %a /root/.ssh/id_ed25519")).toBe("600");
    const refused = await run("ssh-keygen", ["", "n"]);
    expect(refused.status).toBe(1);
    expect(refused.output).toContain("already exists");
  });

  it("refuses a private key open to others, like Ubuntu", async () => {
    await ok("chmod 644 chave");
    const result = await run("ssh-keygen -y -f chave");
    expect(result.status).toBe(1);
    expect(result.output).toContain("UNPROTECTED PRIVATE KEY FILE");
    expect(result.output).toContain("Permissions 0644 for 'chave' are too open.");
    await ok("chmod 600 chave");
  });

  it("removes a host from known_hosts with -R", async () => {
    await ok("printf 'servidor.aula ssh-ed25519 AAAA\\nout.aula ssh-ed25519 BBBB\\n' > /root/.ssh/known_hosts");
    const output = await ok("ssh-keygen -R servidor.aula");
    expect(output).toContain("# Host servidor.aula found: line 1");
    expect(await ok("cat /root/.ssh/known_hosts")).toBe("out.aula ssh-ed25519 BBBB");
    expect((await run("ssh-keygen -R nada.aula")).output).toContain("not found");
  });
});

describe("ssh-copy-id", () => {
  it("writes the key in the authorized_keys of the account, with the right modes (CA-11)", async () => {
    const pub = await ok("cat chave.pub");
    const output = await ok("ssh-copy-id -i chave.pub ricardo@localhost");
    expect(output).toContain("Number of key(s) added: 1");
    expect(await ok("cat /home/ricardo/.ssh/authorized_keys")).toBe(pub);
    expect(await ok("stat -c '%a %U' /home/ricardo/.ssh")).toBe("700 ricardo");
    expect(await ok("stat -c '%a %U' /home/ricardo/.ssh/authorized_keys")).toBe("600 ricardo");
    const again = await run("ssh-copy-id -i chave.pub ricardo@localhost");
    expect(again.output).toContain("All keys were skipped");
    expect(await ok("wc -l < /home/ricardo/.ssh/authorized_keys")).toBe("1");
  });

  it("appends a second key, and refuses unknown accounts, hosts and missing keys", async () => {
    await ok("ssh-copy-id -i rsa_chave.pub ricardo@localhost");
    expect(await ok("wc -l < /home/ricardo/.ssh/authorized_keys")).toBe("2");
    expect((await run("ssh-copy-id -i chave.pub fantasma@localhost")).status).toBe(1);
    expect((await run("ssh-copy-id -i chave.pub ricardo@outra.maquina")).output).toContain("Could not resolve hostname");
    expect((await run("ssh-copy-id -i nada.pub ricardo@localhost")).output).toContain("No identities found");
    expect((await run("ssh-copy-id")).status).toBe(1);
  });

  it("asks the password of the account when it is not run by root", async () => {
    await run("useradd -m bia");
    await win.execute({ command: "passwd bia", answers: ["123", "123"] });
    await win.execute({ command: "ssh-keygen -t ed25519 -f /home/bia/k -N '' -q", terminal: 2, login: { user: "bia", password: "123" } });
    const result = await win.execute({ command: "ssh-copy-id -i /home/bia/k.pub ricardo@localhost", terminal: 2, answers: ["", "", ""] });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Permission denied");
  }, 30000);
});
