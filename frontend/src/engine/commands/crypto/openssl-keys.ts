import type { EngineContext } from "../types";
import { bytesFromBig, concat, hex, pemEncode } from "./bytes";
import { digest, hashFromName, type HashName } from "./hashing";
import { first, mode600, openOptions, readBytes, readText, writeBytes } from "./io";
import { unknownOption } from "./openssl-basic";
import {
  ed25519Sign,
  ed25519Verify,
  generateEd25519,
  generateRsa,
  int,
  modulusBytes,
  parsePrivateKey,
  parsePublicKey,
  privatePem,
  publicOf,
  publicPem,
  rsaDecryptOaep,
  rsaDecryptV15,
  rsaEncryptOaep,
  rsaEncryptV15,
  rsaSignDigest,
  rsaVerifyDigest,
  seq,
  type PrivateKey,
  type RsaKey,
} from "./pki";

// genrsa, genpkey, rsa, pkey and pkeyutl: creating, showing and using keys (SPEC-031, entrega B).

export const RSA_SIZES = [1024, 2048, 4096];

/** A new private key, or null (after printing why) when the size or the algorithm is not available. */
export async function newKey(context: EngineContext, command: string, algorithm: string, bits: number): Promise<PrivateKey | null> {
  if (algorithm.toLowerCase() === "ed25519") {
    const key = await generateEd25519();
    if (!key) context.falhar(`${command}: algoritmo não disponível neste navegador; use RSA`);
    return key;
  }
  if (algorithm.toLowerCase() !== "rsa") {
    context.falhar(`${command}: algoritmo desconhecido no simulador: ${algorithm} (use RSA ou ED25519)`);
    return null;
  }
  if (!RSA_SIZES.includes(bits)) {
    context.falhar(`${command}: tamanho de chave RSA não aceito: ${bits} (use 1024, 2048 ou 4096)`);
    return null;
  }
  if (bits === 1024) context.falhar(`${command}: aviso: 1024 bits é pouco para uso real; serve só para a aula`);
  if (bits === 4096) context.falhar(`${command}: gerar 4096 bits pode demorar alguns segundos...`);
  return { type: "rsa", rsa: await generateRsa(bits) };
}

export async function genrsa(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["out"], []);
  if (options.unknown) return unknownOption(context, "genrsa", options.unknown);
  const bits = options.positional[0] === undefined ? 2048 : Number(options.positional[0]);
  const key = await newKey(context, "openssl genrsa", "rsa", bits);
  if (!key) return 1;
  return writeBytes(context, "openssl genrsa", first(options, "out"), privatePem(key), mode600) ? 0 : 1;
}

export async function genpkey(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["algorithm", "pkeyopt", "out"], []);
  if (options.unknown) return unknownOption(context, "genpkey", options.unknown);
  const algorithm = first(options, "algorithm");
  if (!algorithm) {
    context.falhar("openssl genpkey: falta -algorithm (RSA ou ED25519)");
    return 1;
  }
  const bitsOption = options.values.get("pkeyopt")?.find((item) => item.startsWith("rsa_keygen_bits:"));
  const key = await newKey(context, "openssl genpkey", algorithm, bitsOption ? Number(bitsOption.split(":")[1]) : 2048);
  if (!key) return 1;
  return writeBytes(context, "openssl genpkey", first(options, "out"), privatePem(key), mode600) ? 0 : 1;
}

function groups(bytes: Uint8Array, indent: string): string[] {
  const pairs = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += 15) lines.push(`${indent}${pairs.slice(i, i + 15).join(":")}${i + 15 < pairs.length ? ":" : ""}`);
  return lines;
}

/** A big number the way `openssl rsa -text` shows it: with a leading 00 when the first bit is set. */
const bigLines = (value: bigint): string[] => {
  const bytes = bytesFromBig(value);
  return groups(bytes[0]! & 0x80 ? concat(Uint8Array.of(0), bytes) : bytes, "    ");
};

function rsaText(rsa: RsaKey, isPrivate: boolean): string {
  const bits = rsa.n.toString(2).length;
  const exponent = `${rsa.e} (0x${rsa.e.toString(16)})`;
  const lines = isPrivate
    ? [`Private-Key: (${bits} bit, 2 primes)`, "modulus:", ...bigLines(rsa.n), `publicExponent: ${exponent}`, "privateExponent:", ...bigLines(rsa.d!), "prime1:", ...bigLines(rsa.p!), "prime2:", ...bigLines(rsa.q!), "exponent1:", ...bigLines(rsa.dp!), "exponent2:", ...bigLines(rsa.dq!), "coefficient:", ...bigLines(rsa.qi!)]
    : [`Public-Key: (${bits} bit)`, "Modulus:", ...bigLines(rsa.n), `Exponent: ${exponent}`];
  return `${lines.join("\n")}\n`;
}

function pkcs1Pem(rsa: RsaKey): string {
  return pemEncode("RSA PRIVATE KEY", seq(int(0), int(rsa.n), int(rsa.e), int(rsa.d!), int(rsa.p!), int(rsa.q!), int(rsa.dp!), int(rsa.dq!), int(rsa.qi!)));
}

function keyCommand(name: "rsa" | "pkey") {
  return async (args: string[], context: EngineContext): Promise<number> => {
    const options = openOptions(args, ["in", "out", "inform", "outform", "passin", "passout"], ["pubout", "pubin", "text", "noout", "modulus", "check"]);
    if (options.unknown) return unknownOption(context, name, options.unknown);
    const text = readText(context, `openssl ${name}`, first(options, "in"));
    if (text === null) return 1;
    const pubin = options.flags.has("pubin");
    const priv = pubin ? null : await parsePrivateKey(text);
    const pub = pubin ? await parsePublicKey(text) : priv ? publicOf(priv) : null;
    if (!pub) {
      context.falhar(`openssl ${name}: não foi possível ler a chave (o arquivo precisa ser um PEM ${pubin ? "de chave pública" : "de chave privada"})`);
      return 1;
    }
    if (name === "rsa" && pub.type !== "rsa") {
      context.falhar("openssl rsa: não é uma chave RSA (use openssl pkey)");
      return 1;
    }
    const rsa = pub.type === "rsa" ? (priv?.type === "rsa" ? priv.rsa : { n: pub.n, e: pub.e }) : null;
    const wantsPublic = options.flags.has("pubout") || pubin;
    let output = "";
    if (options.flags.has("text")) {
      if (rsa) output += rsaText(rsa, !wantsPublic && priv !== null);
      else output += priv?.type === "ed25519" && !wantsPublic ? `ED25519 Private-Key:\npriv:\n${groups(priv.seed, "    ").join("\n")}\npub:\n${groups(priv.pub, "    ").join("\n")}\n` : `ED25519 Public-Key:\npub:\n${groups((pub as { pub: Uint8Array }).pub, "    ").join("\n")}\n`;
    }
    if (options.flags.has("modulus") && rsa) output += `Modulus=${hex(bytesFromBig(rsa.n)).toUpperCase()}\n`;
    if (options.flags.has("check")) {
      if (!priv || priv.type !== "rsa") {
        context.falhar("openssl rsa: -check precisa de uma chave privada RSA");
        return 1;
      }
      output += priv.rsa.p! * priv.rsa.q! === priv.rsa.n ? "RSA key ok\n" : "RSA key error: n não é p vezes q\n";
    }
    if (!options.flags.has("noout")) {
      if (wantsPublic) output += publicPem(pub);
      else output += name === "rsa" && priv?.type === "rsa" ? pkcs1Pem(priv.rsa) : privatePem(priv!);
      context.falhar(`writing ${name === "rsa" ? "RSA" : "PKEY"} key`);
    }
    return writeBytes(context, `openssl ${name}`, first(options, "out"), output, wantsPublic ? 0o644 : mode600) ? 0 : 1;
  };
}

export const rsaCommand = keyCommand("rsa");
export const pkeyCommand = keyCommand("pkey");

/** The digest a bare signature was made over, told by its size. */
function hashBySize(length: number): HashName | null {
  return ({ 16: "md5", 20: "sha1", 28: "sha224", 32: "sha256", 48: "sha384", 64: "sha512" } as Record<number, HashName>)[length] ?? null;
}

export async function pkeyutl(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["inkey", "in", "out", "sigfile", "digest", "pkeyopt", "keyform"], ["pubin", "encrypt", "decrypt", "sign", "verify", "rawin"]);
  if (options.unknown) return unknownOption(context, "pkeyutl", options.unknown);
  const operations = (["encrypt", "decrypt", "sign", "verify"] as const).filter((operation) => options.flags.has(operation));
  const keyPath = first(options, "inkey");
  if (operations.length !== 1 || keyPath === undefined) {
    context.falhar("Uso: openssl pkeyutl (-encrypt | -decrypt | -sign | -verify) -inkey CHAVE [-pubin] [-in ARQUIVO] [-out ARQUIVO] [-sigfile ASSINATURA]");
    return 1;
  }
  const operation = operations[0]!;
  const keyText = readText(context, "openssl pkeyutl", keyPath);
  const data = readBytes(context, "openssl pkeyutl", first(options, "in"));
  if (keyText === null || data === null) return 1;
  const priv = options.flags.has("pubin") ? null : await parsePrivateKey(keyText);
  const pub = priv ? publicOf(priv) : await parsePublicKey(keyText);
  if (!pub) {
    context.falhar("openssl pkeyutl: não foi possível ler a chave");
    return 1;
  }
  const settings = new Map((options.values.get("pkeyopt") ?? []).map((item) => item.split(":") as [string, string]));
  const oaep = settings.get("rsa_padding_mode") === "oaep";
  const oaepHash = hashFromName(settings.get("rsa_oaep_md") ?? "sha1") ?? "sha1";
  const out = first(options, "out");
  const needPrivate = operation === "decrypt" || operation === "sign";
  if (needPrivate && !priv) {
    context.falhar("openssl pkeyutl: esta operação precisa da chave privada");
    return 1;
  }

  if (pub.type === "ed25519") {
    if (operation === "encrypt" || operation === "decrypt") {
      context.falhar("openssl pkeyutl: Ed25519 só assina e verifica");
      return 1;
    }
    if (!options.flags.has("rawin")) {
      context.falhar("openssl pkeyutl: Ed25519 exige -rawin (a mensagem inteira, sem resumo)");
      return 1;
    }
    if (operation === "sign") return writeBytes(context, "openssl pkeyutl", out, await ed25519Sign(priv as Extract<PrivateKey, { type: "ed25519" }>, data)) ? 0 : 1;
    const signature = readBytes(context, "openssl pkeyutl", first(options, "sigfile"));
    if (signature === null) return 1;
    const ok = await ed25519Verify(pub.pub, data, signature);
    context.linha(ok ? "Signature Verified Successfully" : "Signature Verification Failure");
    return ok ? 0 : 1;
  }

  if (operation === "encrypt") {
    const result = oaep ? await rsaEncryptOaep(pub, oaepHash, data) : rsaEncryptV15(pub, data);
    if (!result) {
      context.falhar(`openssl pkeyutl: dados grandes demais para a chave (no máximo ${modulusBytes(pub.n) - (oaep ? 2 * 20 + 2 : 11)} bytes)`);
      return 1;
    }
    return writeBytes(context, "openssl pkeyutl", out, result) ? 0 : 1;
  }
  if (operation === "decrypt") {
    const rsa = (priv as Extract<PrivateKey, { type: "rsa" }>).rsa;
    const result = oaep ? await rsaDecryptOaep(rsa, oaepHash, data) : rsaDecryptV15(rsa, data);
    if (!result) {
      context.falhar("openssl pkeyutl: erro ao decifrar (chave errada ou dados corrompidos)");
      return 1;
    }
    return writeBytes(context, "openssl pkeyutl", out, result) ? 0 : 1;
  }
  const hashName = hashFromName(first(options, "digest") ?? "");
  const rawin = options.flags.has("rawin");
  const hash = hashName ?? (rawin ? "sha256" : hashBySize(data.length));
  if (!hash) {
    context.falhar("openssl pkeyutl: a entrada não parece um resumo; use -rawin -digest sha256 para assinar a mensagem");
    return 1;
  }
  const digestBytes = rawin ? await digest(hash, data) : data;
  if (operation === "sign") {
    const rsa = (priv as Extract<PrivateKey, { type: "rsa" }>).rsa;
    return writeBytes(context, "openssl pkeyutl", out, rsaSignDigest(rsa, hash, digestBytes)) ? 0 : 1;
  }
  const signature = readBytes(context, "openssl pkeyutl", first(options, "sigfile"));
  if (signature === null) return 1;
  const ok = rsaVerifyDigest(pub, hash, digestBytes, signature);
  context.linha(ok ? "Signature Verified Successfully" : "Signature Verification Failure");
  return ok ? 0 : 1;
}
