import { absolutePath, defineCommand, rejectOptions, parseOptions } from "../helpers";
import type { EngineContext, EngineNode } from "../types";
import { bigFromBytes, bytesFromBig, concat, fromBase64, pemDecode, pemEncode, randomBytes, toBase64, utf8 } from "./bytes";
import { digest } from "./hashing";
import { first, openOptions, readText } from "./io";
import { generateEd25519, generateRsa, parsePrivateKey, publicOf, type PrivateKey, type PublicKey, type RsaKey } from "./pki";
import { passwordHash } from "./shadow";

// ssh-keygen and ssh-copy-id: the key pairs of OpenSSH, with the fingerprint and the randomart, and the authorized_keys (SPEC-031, entrega C).

const u32 = (value: number): Uint8Array => Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
const sshString = (bytes: Uint8Array): Uint8Array => concat(u32(bytes.length), bytes);
const sshMpint = (value: bigint): Uint8Array => {
  const bytes = bytesFromBig(value);
  return sshString(bytes[0]! & 0x80 ? concat(Uint8Array.of(0), bytes) : bytes);
};

class Reader {
  position = 0;
  constructor(private readonly data: Uint8Array) {}
  u32(): number {
    if (this.position + 4 > this.data.length) throw new Error("short");
    const [a, b, c, d] = this.data.subarray(this.position, this.position + 4) as unknown as [number, number, number, number];
    this.position += 4;
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }
  string(): Uint8Array {
    const length = this.u32();
    if (this.position + length > this.data.length) throw new Error("short");
    const bytes = this.data.slice(this.position, this.position + length);
    this.position += length;
    return bytes;
  }
  mpint = (): bigint => bigFromBytes(this.string());
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export const publicBlob = (key: PublicKey): Uint8Array =>
  key.type === "ed25519" ? concat(sshString(utf8("ssh-ed25519")), sshString(key.pub)) : concat(sshString(utf8("ssh-rsa")), sshMpint(key.e), sshMpint(key.n));

const keyLabel = (key: PublicKey): string => (key.type === "ed25519" ? "ED25519" : "RSA");
const keyBits = (key: PublicKey): number => (key.type === "ed25519" ? 256 : key.n.toString(2).length);
export const publicLine = (key: PublicKey, comment: string): string => `${key.type === "ed25519" ? "ssh-ed25519" : "ssh-rsa"} ${toBase64(publicBlob(key))}${comment ? ` ${comment}` : ""}`;

/** "SHA256:" and the base64 of the SHA-256 of the key, without the padding: the fingerprint ssh-keygen shows. */
export async function fingerprint(key: PublicKey): Promise<string> {
  return `SHA256:${toBase64(await digest("sha256", publicBlob(key))).replace(/=+$/, "")}`;
}

const AUGMENTATION = " .o+=*BOX@%&#/^SE";

/** The randomart box of OpenSSH (17 columns by 9 rows) for the SHA-256 of the key. */
export async function randomart(key: PublicKey): Promise<string> {
  const width = 17;
  const height = 9;
  const last = AUGMENTATION.length - 1;
  const field = Array.from({ length: width }, () => new Array<number>(height).fill(0));
  let x = Math.floor(width / 2);
  let y = Math.floor(height / 2);
  for (const byte of await digest("sha256", publicBlob(key))) {
    let input = byte;
    for (let step = 0; step < 4; step++) {
      x = Math.min(width - 1, Math.max(0, x + (input & 1 ? 1 : -1)));
      y = Math.min(height - 1, Math.max(0, y + (input & 2 ? 1 : -1)));
      if (field[x]![y]! < last - 2) field[x]![y]!++;
      input >>= 2;
    }
  }
  field[Math.floor(width / 2)]![Math.floor(height / 2)] = last - 1;
  field[x]![y] = last;
  const border = (title: string) => `+${"-".repeat(Math.floor((width - title.length) / 2))}${title}`.padEnd(width + 1, "-") + "+";
  const rows = Array.from({ length: height }, (_, row) => `|${field.map((column) => AUGMENTATION[Math.min(column[row]!, last)]).join("")}|`);
  return [border(`[${keyLabel(key)} ${keyBits(key)}]`), ...rows, border("[SHA256]")].join("\n");
}

/** The private key file in the openssh-key-v1 format, without passphrase. */
export function privateFile(key: PrivateKey, comment: string): string {
  const pub = publicOf(key);
  const check = randomBytes(4);
  const body =
    key.type === "ed25519"
      ? concat(sshString(utf8("ssh-ed25519")), sshString(key.pub), sshString(concat(key.seed, key.pub)))
      : concat(sshString(utf8("ssh-rsa")), sshMpint(key.rsa.n), sshMpint(key.rsa.e), sshMpint(key.rsa.d!), sshMpint(key.rsa.qi!), sshMpint(key.rsa.p!), sshMpint(key.rsa.q!));
  let section = concat(check, check, body, sshString(utf8(comment)));
  const padding = (8 - (section.length % 8)) % 8;
  section = concat(section, Uint8Array.from({ length: padding }, (_, i) => i + 1));
  const file = concat(utf8("openssh-key-v1\0"), sshString(utf8("none")), sshString(utf8("none")), sshString(new Uint8Array(0)), u32(1), sshString(publicBlob(pub)), sshString(section));
  return pemEncode("OPENSSH PRIVATE KEY", file);
}

interface LoadedKey {
  key: PublicKey;
  comment: string;
  isPrivate: boolean;
  /** A private key that asks a passphrase, which the simulator does not support. */
  encrypted?: boolean;
}

function parsePublicText(content: string): LoadedKey | null {
  const line = content.split("\n").find((item) => /^(ssh-ed25519|ssh-rsa)\s/.test(item));
  if (!line) return null;
  const [kind, encoded, ...comment] = line.trim().split(/\s+/);
  const blob = fromBase64(encoded ?? "");
  if (!blob) return null;
  try {
    const reader = new Reader(blob);
    if (text(reader.string()) !== kind) return null;
    if (kind === "ssh-ed25519") return { key: { type: "ed25519", pub: reader.string() }, comment: comment.join(" "), isPrivate: false };
    const e = reader.mpint();
    return { key: { type: "rsa", e, n: reader.mpint() }, comment: comment.join(" "), isPrivate: false };
  } catch {
    return null;
  }
}

function parseOpenSshPrivate(content: string): LoadedKey | null {
  const pem = pemDecode(content);
  if (!pem || pem.label !== "OPENSSH PRIVATE KEY") return null;
  const magic = utf8("openssh-key-v1\0");
  if (text(pem.der.slice(0, magic.length)) !== text(magic)) return null;
  try {
    const reader = new Reader(pem.der.slice(magic.length));
    const cipher = text(reader.string());
    reader.string();
    reader.string();
    reader.u32();
    const pubBlob = reader.string();
    if (cipher !== "none") {
      const publicKey = parsePublicText(`${text(new Reader(pubBlob).string())} ${toBase64(pubBlob)}`);
      return publicKey ? { ...publicKey, isPrivate: true, encrypted: true } : null;
    }
    const inner = new Reader(reader.string());
    if (inner.u32() !== inner.u32()) return null;
    const kind = text(inner.string());
    if (kind === "ssh-ed25519") {
      const pub = inner.string();
      inner.string();
      return { key: { type: "ed25519", pub }, comment: text(inner.string()), isPrivate: true };
    }
    if (kind === "ssh-rsa") {
      const n = inner.mpint();
      const e = inner.mpint();
      inner.mpint();
      inner.mpint();
      inner.mpint();
      inner.mpint();
      return { key: { type: "rsa", n, e }, comment: text(inner.string()), isPrivate: true };
    }
  } catch {
    return null;
  }
  return null;
}

/** The key of a file: a public key line, an OpenSSH private key or an OpenSSL PEM private key. */
async function loadKeyFile(content: string): Promise<LoadedKey | null> {
  const found = parsePublicText(content) ?? parseOpenSshPrivate(content);
  if (found) return found;
  const pem = await parsePrivateKey(content);
  return pem ? { key: publicOf(pem), comment: "", isPrivate: true } : null;
}

/** Whether the private key file may be used: not open to the group or to others. Prints the warning of OpenSSH when it is. */
function checkPermissions(context: EngineContext, path: string, node: EngineNode): boolean {
  if ((node.modo & 0o077) === 0) return true;
  const stars = "@".repeat(59);
  context.falhar(
    [
      stars,
      "@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @",
      stars,
      `Permissions ${(node.modo & 0o777).toString(8).padStart(4, "0")} for '${path}' are too open.`,
      "It is required that your private key files are NOT accessible by others.",
      "This private key will be ignored.",
      `Load key "${path}": bad permissions`,
    ].join("\n"),
  );
  return false;
}

const passwdFile = (context: EngineContext): string[][] => {
  const node = context.tentarLocalizar("/etc/passwd");
  return (node?.ler?.() ?? "").split("\n").filter(Boolean).map((line) => line.split(":"));
};

/** The account that runs the command: its name and home folder. */
function currentAccount(context: EngineContext): { name: string; home: string } {
  const row = passwdFile(context).find((fields) => Number(fields[2]) === context.credencial.uid);
  return { name: row?.[0] ?? "aluno", home: row?.[5] ?? `/home/${row?.[0] ?? "aluno"}` };
}

function save(context: EngineContext, path: string, content: string, mode: number): string | null {
  const absolute = absolutePath(path, context.quadro.cwd);
  const existing = context.tentarLocalizar(absolute);
  try {
    if (existing && !existing.ehDiretorio()) {
      existing.escrever?.(content);
      existing.modo = mode;
      return null;
    }
    const folder = absolute.slice(0, absolute.lastIndexOf("/")) || "/";
    if (!context.tentarLocalizar(folder)?.ehDiretorio()) return `${path}: No such file or directory`;
    context.maquina.criarArquivo(absolute, content, context.credencial.uid, context.credencial.gids[0] ?? 0, mode);
    return null;
  } catch (error) {
    return `${path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const expandShort = (args: string[]): string[] => args.flatMap((arg) => (/^-[A-Za-z]{2,}$/.test(arg) ? [...arg.slice(1)].map((letter) => `-${letter}`) : [arg]));

async function listKey(context: EngineContext, path: string | undefined, account: { home: string }): Promise<number> {
  const fallback = `${account.home}/.ssh/id_ed25519`;
  const target = path ?? ((await context.interacao.perguntar(`Enter file in which the key is (${fallback}): `, false)) || fallback);
  const node = context.tentarLocalizar(absolutePath(target, context.quadro.cwd));
  if (!node || node.ehDiretorio()) {
    context.falhar(`${target}: No such file or directory`);
    return 1;
  }
  const loaded = await loadKeyFile(node.ler?.() ?? "");
  if (!loaded) {
    context.falhar(`${target} is not a public key file.`);
    return 1;
  }
  context.linha(`${keyBits(loaded.key)} ${await fingerprint(loaded.key)} ${loaded.comment || "no comment"} (${keyLabel(loaded.key)})`);
  return 0;
}

async function showPublic(context: EngineContext, path: string | undefined): Promise<number> {
  const node = path === undefined ? null : context.tentarLocalizar(absolutePath(path, context.quadro.cwd));
  if (path === undefined || !node || node.ehDiretorio()) {
    context.falhar(`${path ?? "(sem -f)"}: No such file or directory`);
    return 1;
  }
  if (!checkPermissions(context, path, node)) return 1;
  const loaded = await loadKeyFile(node.ler?.() ?? "");
  if (!loaded || !loaded.isPrivate) {
    context.falhar(`Load key "${path}": invalid format`);
    return 1;
  }
  if (loaded.encrypted) {
    context.falhar("ssh-keygen: a chave tem senha (passphrase), que o simulador não sabe abrir");
    return 1;
  }
  context.linha(publicLine(loaded.key, loaded.comment));
  return 0;
}

function removeHost(context: EngineContext, host: string, account: { home: string }): number {
  const path = `${account.home}/.ssh/known_hosts`;
  const node = context.tentarLocalizar(path);
  const lines = (node?.ler?.() ?? "").split("\n");
  const found = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.split(" ")[0]?.split(",").includes(host));
  if (!node || found.length === 0) {
    context.falhar(`Host ${host} not found in ${path}`);
    return 0;
  }
  for (const { index } of found) context.linha(`# Host ${host} found: line ${index + 1}`);
  save(context, `${path}.old`, lines.join("\n"), 0o644);
  node.escrever?.(lines.filter((_, index) => !found.some((item) => item.index === index)).join("\n"));
  context.linha(`${path} updated.\nOriginal contents retained as ${path}.old`);
  return 0;
}

export const sshKeygen = defineCommand(
  "ssh-keygen",
  "cria e mostra chaves SSH: ssh-keygen -t ed25519",
  {
    uso: "ssh-keygen [-t rsa|ed25519] [-b BITS] [-f ARQUIVO] [-N SENHA] [-C COMENTÁRIO] [-q]",
    descricao:
      "Cria um par de chaves SSH: o arquivo da chave privada (modo 600) e o da pública, com final .pub (modo 644). Mostra a impressão digital (fingerprint) e a arte randomart. Use só para a aula: não coloque estas chaves em sistemas reais. O simulador só cria chaves sem senha (-N \"\").",
    h: "ajuda",
    opcoes: [
      ["-t TIPO", "tipo da chave: ed25519 (padrão) ou rsa"],
      ["-b BITS", "tamanho da chave RSA: 1024, 2048, 3072 ou 4096"],
      ["-f ARQUIVO", "onde gravar a chave (a pública ganha .pub)"],
      ["-N SENHA", "senha da chave; no simulador só vale vazia"],
      ["-C TEXTO", "comentário da chave, por padrão usuário@máquina"],
      ["-l -f ARQUIVO", "mostra a impressão digital de uma chave"],
      ["-y -f ARQUIVO", "mostra a chave pública que corresponde a uma privada"],
      ["-R MÁQUINA", "remove a máquina do known_hosts"],
      ["-q", "silencioso: não mostra mensagens"],
    ],
    exemplos: [
      ["ssh-keygen -t ed25519 -f minha_chave -N \"\"", "cria minha_chave e minha_chave.pub"],
      ["ssh-keygen -l -f minha_chave.pub", "mostra a impressão digital"],
    ],
  },
  async (rawArgs, context) => {
    const options = openOptions(expandShort(rawArgs), ["t", "b", "f", "N", "C", "R", "E", "m"], ["l", "y", "q", "H", "F"]);
    if (options.unknown) {
      context.falhar(`ssh-keygen: opção desconhecida ou sem valor: ${options.unknown}`);
      return 1;
    }
    const account = currentAccount(context);
    if (options.flags.has("l")) return listKey(context, first(options, "f"), account);
    if (options.flags.has("y")) return showPublic(context, first(options, "f"));
    const host = first(options, "R");
    if (host !== undefined) return removeHost(context, host, account);

    const type = (first(options, "t") ?? "ed25519").toLowerCase();
    if (type !== "ed25519" && type !== "rsa") {
      context.falhar(`ssh-keygen: tipo de chave não disponível no simulador: ${type} (use rsa ou ed25519)`);
      return 1;
    }
    const bits = Number(first(options, "b") ?? "3072");
    if (type === "rsa" && (!Number.isInteger(bits) || bits < 1024)) {
      context.falhar("Invalid RSA key length: minimum is 1024 bits");
      return 1;
    }
    if (type === "rsa" && ![1024, 2048, 3072, 4096].includes(bits)) {
      context.falhar(`ssh-keygen: no simulador o tamanho RSA é 1024, 2048, 3072 ou 4096 (pedido: ${bits})`);
      return 1;
    }
    const quiet = options.flags.has("q");
    const say = (line: string) => {
      if (!quiet) context.linha(line);
    };
    say(`Generating public/private ${type} key pair.`);
    const fallback = `${account.home}/.ssh/id_${type}`;
    let path = first(options, "f");
    if (path === undefined) path = (await context.interacao.perguntar(`Enter file in which to save the key (${fallback}): `, false)) || fallback;
    const absolute = absolutePath(path, context.quadro.cwd);
    const folder = absolute.slice(0, absolute.lastIndexOf("/")) || "/";
    if (!context.tentarLocalizar(folder)) {
      if (folder === `${account.home}/.ssh`) {
        context.maquina.criarDiretorio(folder, context.credencial.uid, context.credencial.gids[0] ?? 0, 0o700);
        say(`Created directory '${folder}'.`);
      } else {
        context.falhar(`Saving key "${path}" failed: No such file or directory`);
        return 1;
      }
    }
    if (context.tentarLocalizar(absolute)) {
      const answer = await context.interacao.perguntar(`${path} already exists.\nOverwrite (y/n)? `, false);
      if (!/^y/i.test(answer.trim())) return 1;
    }
    let passphrase = first(options, "N");
    if (passphrase === undefined) {
      passphrase = await context.interacao.perguntar("Enter passphrase (empty for no passphrase): ", true);
      if (passphrase !== "" || (await context.interacao.perguntar("Enter same passphrase again: ", true)) !== passphrase) {
        context.falhar(passphrase === "" ? "Passphrases do not match.  Try again." : "ssh-keygen: o simulador só cria chaves sem senha: deixe a senha vazia");
        return 1;
      }
    } else if (passphrase !== "") {
      context.falhar("ssh-keygen: o simulador só cria chaves sem senha: use -N \"\"");
      return 1;
    }

    let key: PrivateKey;
    if (type === "rsa") {
      if (bits >= 4096) say("Gerar uma chave de 4096 bits pode demorar alguns segundos...");
      key = { type: "rsa", rsa: (await generateRsa(bits)) as RsaKey };
    } else {
      const made = await generateEd25519();
      if (!made) {
        context.falhar("ssh-keygen: ed25519 não está disponível neste navegador; use -t rsa");
        return 1;
      }
      key = made;
    }
    const comment = first(options, "C") ?? `${account.name}@${context.maquina.hostname}`;
    const pub = publicOf(key);
    const failure = save(context, path, privateFile(key, comment), 0o600) ?? save(context, `${path}.pub`, `${publicLine(pub, comment)}\n`, 0o644);
    if (failure) {
      context.falhar(`Saving key "${path}" failed: ${failure}`);
      return 1;
    }
    say(`Your identification has been saved in ${path}`);
    say(`Your public key has been saved in ${path}.pub`);
    say("The key fingerprint is:");
    say(`${await fingerprint(pub)} ${comment}`);
    say("The key's randomart image is:");
    say(await randomart(pub));
    return 0;
  },
);

/** Whether the password is the one of the account in /etc/shadow ($1$, $5$ or $6$). */
async function passwordMatches(context: EngineContext, account: string, password: string): Promise<boolean> {
  const row = (context.tentarLocalizar("/etc/shadow")?.ler?.() ?? "").split("\n").map((line) => line.split(":")).find((fields) => fields[0] === account);
  const stored = row?.[1] ?? "";
  // ponytail: yescrypt ($y$, the Ubuntu default) is not implemented, so any password is taken for such an account; add it if the class needs a wrong-password case.
  if (stored.startsWith("$y$")) return password !== "";
  const [, kind, salt] = /^\$([156])\$([^$]+)\$/.exec(stored) ?? [];
  if (!kind || !salt) return false;
  return (await passwordHash(kind as "1" | "5" | "6", password, salt)) === row![1];
}

export const sshCopyId = defineCommand(
  "ssh-copy-id",
  "instala a chave pública em uma conta: ssh-copy-id usuario@localhost",
  {
    uso: "ssh-copy-id [-i ARQUIVO] [USUÁRIO@]DESTINO",
    descricao:
      "Acrescenta a sua chave pública ao arquivo ~/.ssh/authorized_keys de uma conta. No simulador o destino é uma conta da própria máquina (localhost), o que permite trocar chaves entre abas do terminal. Pede a senha da conta.",
    h: "ajuda",
    opcoes: [["-i ARQUIVO", "a chave pública a instalar (por padrão ~/.ssh/id_ed25519.pub ou id_rsa.pub)"]],
    exemplos: [["ssh-copy-id -i ~/.ssh/id_ed25519.pub bob@localhost", "instala a chave na conta bob"]],
  },
  async (args, context) => {
    const parsed = parseOptions(args, { known: "hi", withValue: "i" });
    if (rejectOptions("ssh-copy-id", parsed, context)) return 1;
    const destination = parsed.operands[0];
    if (destination === undefined) {
      context.falhar("Usage: ssh-copy-id [-i [identity_file]] [user@]hostname");
      return 1;
    }
    const me = currentAccount(context);
    const [user, host] = destination.includes("@") ? (destination.split("@") as [string, string]) : [me.name, destination];
    if (!["localhost", "127.0.0.1", "::1", context.maquina.hostname].includes(host)) {
      context.falhar(`ssh: Could not resolve hostname ${host}: Name or service not known\nssh-copy-id: no simulador o destino é uma conta desta máquina (use ${user}@localhost)`);
      return 1;
    }
    const row = passwdFile(context).find((fields) => fields[0] === user);
    if (!row) {
      context.falhar(`${user}@${host}: Permission denied (publickey,password).`);
      return 1;
    }
    const identity = parsed.values.get("i");
    const candidates = identity !== undefined ? [identity] : [`${me.home}/.ssh/id_ed25519.pub`, `${me.home}/.ssh/id_rsa.pub`];
    const source = candidates.find((candidate) => context.tentarLocalizar(absolutePath(candidate, context.quadro.cwd)));
    if (!source) {
      context.falhar(`/usr/bin/ssh-copy-id: ERROR: No identities found${identity !== undefined ? ` (${identity})` : ""}`);
      return 1;
    }
    const pubFile = source.endsWith(".pub") ? source : `${source}.pub`;
    const content = readText(context, "ssh-copy-id", pubFile);
    const loaded = content === null ? null : parsePublicText(content);
    if (!loaded) {
      context.falhar(`/usr/bin/ssh-copy-id: ERROR: ${pubFile} não é uma chave pública`);
      return 1;
    }
    context.linha(`/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "${pubFile}"`);
    context.linha("/usr/bin/ssh-copy-id: INFO: attempting to log in with the new key(s), to filter out any that are already installed");

    const folder = `${row[5] ?? `/home/${user}`}/.ssh`;
    const authorized = `${folder}/authorized_keys`;
    const existing = context.tentarLocalizar(authorized);
    const already = (existing?.ler?.() ?? "").split("\n").some((line) => line.trim().split(/\s+/)[1] === content!.trim().split(/\s+/)[1]);
    if (already) {
      context.falhar("/usr/bin/ssh-copy-id: WARNING: All keys were skipped because they already exist on the remote system.\n\t\t(if you think this is a mistake, you may want to use -f option)\n");
      return 0;
    }
    context.linha("/usr/bin/ssh-copy-id: INFO: 1 key(s) remain to be installed -- if you are prompted now it is to install the new keys");
    if (!context.ehRoot()) {
      let granted = false;
      for (let attempt = 0; attempt < 3 && !granted; attempt++) {
        const password = await context.interacao.perguntar(`${user}@${host}'s password: `, true);
        granted = await passwordMatches(context, user, password);
        if (!granted && attempt < 2) context.falhar("Permission denied, please try again.");
      }
      if (!granted) {
        context.falhar(`${user}@${host}: Permission denied (publickey,password).`);
        return 1;
      }
    }
    const owner = Number(row[2]);
    const group = Number(row[3]);
    const line = `${content!.trim().split("\n")[0]}\n`;
    if (!context.tentarLocalizar(folder)) context.maquina.criarDiretorio(folder, owner, group, 0o700);
    if (existing) existing.escrever?.(`${existing.ler?.() ?? ""}${(existing.ler?.() ?? "").endsWith("\n") || existing.ler?.() === "" ? "" : "\n"}${line}`);
    else context.maquina.criarArquivo(authorized, line, owner, group, 0o600);
    context.linha(`\nNumber of key(s) added: 1\n\nNow try logging into the machine, with:   "ssh '${user}@${host}'"\nand check to make sure that only the key(s) you wanted were added.\n`);
    return 0;
  },
);

export const sshCommands = [sshKeygen, sshCopyId];
