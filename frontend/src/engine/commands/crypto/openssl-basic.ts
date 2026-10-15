import type { EngineContext } from "../types";
import { concat, fromBase64, fromHex, hex, randomBytes, textFromBytes, toBase64, utf8, wrap } from "./bytes";
import { aesDecrypt, aesEncrypt, bytesToKey, CIPHERS, pbkdf2 } from "./cipher";
import { digest, hashFromName, hmac, HASH_LABEL, type HashName } from "./hashing";
import { first, openOptions, passwordFromOption, readBytes, readText, writeBytes } from "./io";
import { parsePrivateKey, parsePublicKey, rsaSign, rsaVerify } from "./pki";
import { passwordHash, randomSalt } from "./shadow";

// The simple subcommands of openssl: rand, dgst, enc and passwd (SPEC-031, entrega B).

const HASH_FLAGS = ["md5", "sha1", "sha224", "sha256", "sha384", "sha512", "sha2-256", "sha2-512"];

export async function rand(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["out"], ["hex", "base64"]);
  if (options.unknown) return unknownOption(context, "rand", options.unknown);
  const count = Number(options.positional[0]);
  if (options.positional.length !== 1 || !Number.isInteger(count) || count < 0 || count > 1_000_000) {
    context.falhar("Uso: openssl rand [-hex | -base64] [-out ARQUIVO] NÚMERO_DE_BYTES");
    return 1;
  }
  const bytes = randomBytes(count);
  const text = options.flags.has("hex") ? `${hex(bytes)}\n` : options.flags.has("base64") ? `${wrap(toBase64(bytes), 64).join("\n")}\n` : bytes;
  return writeBytes(context, "openssl rand", first(options, "out"), text) ? 0 : 1;
}

/** The algorithms that were broken and removed from OpenSSL: the class teaches that they exist and why they went, but the simulator does not run them (SPEC-031 RN-07). */
const REMOVED_ALGORITHMS = new Set(["md2", "md4", "mdc2", "rc2", "rc4", "des", "des-cbc", "des-ecb", "des-cfb", "des-ofb"]);

export function unknownOption(context: EngineContext, command: string, option: string): number {
  const name = option.replace(/^-+/, "").toLowerCase();
  if (REMOVED_ALGORITHMS.has(name)) context.falhar(`openssl ${command}: algoritmo desconhecido no simulador: ${name}`);
  else context.falhar(`openssl ${command}: opção desconhecida ou sem valor: ${option}`);
  return 1;
}

export async function dgst(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["hmac", "sign", "verify", "signature", "out", "keyform"], [...HASH_FLAGS, "hex", "binary", "r"]);
  if (options.unknown) return unknownOption(context, "dgst", options.unknown);
  const chosen = HASH_FLAGS.find((flag) => options.flags.has(flag));
  const hash: HashName = (chosen ? hashFromName(chosen) : "sha256") ?? "sha256";
  const files = options.positional.length > 0 ? options.positional : [undefined];
  const sign = first(options, "sign");
  const verify = first(options, "verify");
  const hmacKey = first(options, "hmac");
  const out = first(options, "out");

  if (sign !== undefined || verify !== undefined) {
    const data = readBytes(context, "openssl dgst", files[0]);
    if (data === null) return 1;
    if (sign !== undefined) {
      const text = readText(context, "openssl dgst", sign);
      if (text === null) return 1;
      const key = await parsePrivateKey(text);
      if (!key) {
        context.falhar("openssl dgst: não foi possível ler a chave privada (use um arquivo PEM)");
        return 1;
      }
      if (key.type !== "rsa") {
        context.falhar("openssl dgst: este tipo de chave não assina com -sign; use pkeyutl -sign -rawin");
        return 1;
      }
      return writeBytes(context, "openssl dgst", out, await rsaSign(key.rsa, hash, data)) ? 0 : 1;
    }
    const signaturePath = first(options, "signature");
    const publicText = readText(context, "openssl dgst", verify);
    const signature = readBytes(context, "openssl dgst", signaturePath);
    if (publicText === null || signature === null || signaturePath === undefined) {
      if (signaturePath === undefined) context.falhar("openssl dgst: falta -signature ARQUIVO");
      return 1;
    }
    const key = await parsePublicKey(publicText);
    if (!key || key.type !== "rsa") {
      context.falhar("openssl dgst: não foi possível ler a chave pública RSA");
      return 1;
    }
    const ok = await rsaVerify(key, hash, data, signature);
    context.linha(ok ? "Verified OK" : "Verification failure");
    return ok ? 0 : 1;
  }

  let status = 0;
  let output = "";
  for (const file of files) {
    const data = readBytes(context, "openssl dgst", file);
    if (data === null) {
      status = 1;
      continue;
    }
    const name = file ?? "stdin";
    const result = hmacKey !== undefined ? await hmac(hash, utf8(hmacKey), data) : await digest(hash, data);
    const label = hmacKey !== undefined ? `HMAC-${HASH_LABEL[hash]}` : HASH_LABEL[hash];
    output += options.flags.has("r") ? `${hex(result)} *${name}\n` : `${label}(${name})= ${hex(result)}\n`;
  }
  return writeBytes(context, "openssl dgst", out, output) && status === 0 ? 0 : 1;
}

const NOTE_DEPRECATED = "*** WARNING : deprecated key derivation used.\nUsing -iter or -pbkdf2 would be better.";

function padHex(text: string, length: number, label: string, context: EngineContext): Uint8Array | null {
  const bytes = fromHex(text);
  if (!bytes || bytes.length > length) {
    context.falhar(`openssl enc: ${label} inválido: precisa de no máximo ${length * 2} dígitos hexadecimais`);
    return null;
  }
  return concat(bytes, new Uint8Array(length - bytes.length));
}

export async function enc(args: string[], context: EngineContext): Promise<number> {
  const cipherFlags = Object.keys(CIPHERS);
  const options = openOptions(args, ["in", "out", "pass", "k", "iter", "md", "S", "K", "iv"], [...cipherFlags, "e", "d", "a", "base64", "A", "pbkdf2", "salt", "nosalt", "p", "P"]);
  if (options.unknown) return unknownOption(context, "enc", options.unknown);
  const cipherName = cipherFlags.find((name) => options.flags.has(name));
  if (!cipherName) {
    context.falhar("openssl enc: escolha uma cifra, por exemplo -aes-256-cbc");
    return 1;
  }
  const cipher = CIPHERS[cipherName]!;
  const decrypting = options.flags.has("d");
  const armor = options.flags.has("a") || options.flags.has("base64");
  const hash = hashFromName(first(options, "md") ?? "sha256");
  const iterations = Number(first(options, "iter") ?? "10000");
  const usePbkdf2 = options.flags.has("pbkdf2") || options.values.has("iter");
  if (!hash || !Number.isInteger(iterations) || iterations < 1) {
    context.falhar("openssl enc: resumo (-md) ou número de iterações (-iter) inválido");
    return 1;
  }
  let input = readBytes(context, "openssl enc", first(options, "in"));
  if (input === null) return 1;
  if (decrypting && armor) {
    const decoded = fromBase64(new TextDecoder().decode(input));
    if (!decoded) {
      context.falhar("openssl enc: erro ao ler a entrada em base64");
      return 1;
    }
    input = decoded;
  }

  let key: Uint8Array;
  let iv: Uint8Array;
  let salt: Uint8Array | null = null;
  let body = input;
  const rawKey = first(options, "K");
  if (rawKey !== undefined) {
    const parsedKey = padHex(rawKey, cipher.keyLength, "-K", context);
    const rawIv = first(options, "iv");
    if (!parsedKey) return 1;
    if (rawIv === undefined) {
      context.falhar("openssl enc: iv indefinido (use -iv junto com -K)");
      return 1;
    }
    const parsedIv = padHex(rawIv, cipher.ivLength, "-iv", context);
    if (!parsedIv) return 1;
    key = parsedKey;
    iv = parsedIv;
  } else {
    const spec = first(options, "pass") ?? (first(options, "k") !== undefined ? `pass:${first(options, "k")}` : undefined);
    const given = passwordFromOption(context, "openssl enc", spec);
    if (given.failed) return 1;
    let password = given.password;
    const prompt = `${cipherName.toUpperCase()} ${decrypting ? "decryption" : "encryption"} password:`;
    if (password === null) {
      password = await context.interacao.perguntar(`enter ${prompt}`, true);
      if (!decrypting && (await context.interacao.perguntar(`Verifying - enter ${prompt}`, true)) !== password) {
        context.falhar("Verify failure\nbad password read");
        return 1;
      }
    }
    if (decrypting) {
      if (options.flags.has("nosalt")) body = input;
      else {
        const magic = new TextDecoder().decode(input.slice(0, 8));
        if (magic !== "Salted__" || input.length < 16) {
          context.falhar("bad magic number");
          return 1;
        }
        salt = input.slice(8, 16);
        body = input.slice(16);
      }
    } else if (!options.flags.has("nosalt")) {
      const given = first(options, "S");
      salt = given === undefined ? randomBytes(8) : padHex(given, 8, "-S", context);
      if (!salt) return 1;
    }
    const total = cipher.keyLength + cipher.ivLength;
    let derived: Uint8Array | null;
    if (usePbkdf2) derived = await pbkdf2(utf8(password), salt ?? new Uint8Array(0), iterations, hash, total);
    else {
      context.falhar(NOTE_DEPRECATED);
      derived = await bytesToKey(hash, utf8(password), salt, total);
    }
    if (!derived) {
      context.falhar("openssl enc: este resumo não serve para derivar a chave (use sha1, sha256, sha384 ou sha512)");
      return 1;
    }
    key = derived.slice(0, cipher.keyLength);
    iv = derived.slice(cipher.keyLength);
    if (options.flags.has("p") || options.flags.has("P")) context.falhar(`${salt ? `salt=${hex(salt).toUpperCase()}\n` : ""}key=${hex(key).toUpperCase()}\niv =${hex(iv).toUpperCase()}`);
  }

  if (decrypting) {
    const plain = await aesDecrypt(cipher, key, iv, body);
    if (!plain) {
      context.falhar("bad decrypt");
      return 1;
    }
    return writeBytes(context, "openssl enc", first(options, "out"), plain) ? 0 : 1;
  }
  const encrypted = await aesEncrypt(cipher, key, iv, body);
  const withHeader = salt && rawKey === undefined ? concat(utf8("Salted__"), salt, encrypted) : encrypted;
  if (armor) {
    const encoded = toBase64(withHeader);
    return writeBytes(context, "openssl enc", first(options, "out"), options.flags.has("A") ? `${encoded}\n` : `${wrap(encoded, 64).join("\n")}\n`) ? 0 : 1;
  }
  return writeBytes(context, "openssl enc", first(options, "out"), withHeader) ? 0 : 1;
}

export async function passwd(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["salt", "in"], ["1", "5", "6", "stdin", "crypt", "apr1"]);
  if (options.unknown) return unknownOption(context, "passwd", options.unknown);
  if (options.flags.has("crypt") || options.flags.has("apr1")) {
    context.falhar("openssl passwd: este formato antigo não existe no simulador; use -1, -5 ou -6");
    return 1;
  }
  const kind = (["6", "5", "1"] as const).find((flag) => options.flags.has(flag)) ?? "6";
  let password = options.positional[0];
  if (password === undefined) {
    if (options.flags.has("stdin")) password = (context.entrada ?? "").split("\n")[0] ?? "";
    else {
      password = await context.interacao.perguntar("Password: ", true);
      if ((await context.interacao.perguntar("Verifying - Password: ", true)) !== password) {
        context.falhar("Verify failure\nbad password read");
        return 1;
      }
    }
  }
  const salt = first(options, "salt") ?? randomSalt(kind);
  context.linha(await passwordHash(kind, password, salt));
  return 0;
}

export function refuseNetwork(command: string): (args: string[], context: EngineContext) => number {
  return (_args, context) => {
    context.falhar(`openssl ${command}: o simulador não abre conexões de rede`);
    return 1;
  };
}

export { textFromBytes };
