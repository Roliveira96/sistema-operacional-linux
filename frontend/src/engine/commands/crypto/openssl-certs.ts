import type { EngineContext } from "../types";
import { hex } from "./bytes";
import { digest, hashFromName, type HashName } from "./hashing";
import { first, mode600, openOptions, readText, writeBytes } from "./io";
import { unknownOption } from "./openssl-basic";
import { newKey } from "./openssl-keys";
import { OID, parsePrivateKey, privatePem, publicOf, type PrivateKey } from "./pki";
import {
  certificatePem,
  checkSignature,
  colonHex,
  createRequest,
  dateText,
  findExtension,
  issueCertificate,
  nameText,
  parseCertificate,
  parseRequest,
  parseSubject,
  requestPem,
  type NameAttribute,
  type ParsedCertificate,
} from "./x509";

// openssl req, x509 and verify: requests, certificates and the check of a chain (SPEC-031, entrega B).

const PROMPTS: [string, string, string][] = [
  ["Country Name (2 letter code) [AU]:", "C", "AU"],
  ["State or Province Name (full name) [Some-State]:", "ST", "Some-State"],
  ["Locality Name (eg, city) []:", "L", ""],
  ["Organization Name (eg, company) [Internet Widgits Pty Ltd]:", "O", "Internet Widgits Pty Ltd"],
  ["Organizational Unit Name (eg, section) []:", "OU", ""],
  ["Common Name (e.g. server FQDN or YOUR name) []:", "CN", ""],
  ["Email Address []:", "emailAddress", ""],
];

async function askSubject(context: EngineContext): Promise<NameAttribute[]> {
  context.linha("You are about to be asked to enter information that will be incorporated\ninto your certificate request.\n-----");
  let text = "";
  for (const [question, label, fallback] of PROMPTS) {
    const answer = (await context.interacao.perguntar(question, false)).trim();
    const value = answer === "." ? "" : answer || fallback;
    if (value) text += `/${label}=${value}`;
  }
  return parseSubject(text) ?? [];
}

function hashOption(context: EngineContext, command: string, name: string | undefined): HashName | null {
  const hash = name === undefined ? "sha256" : hashFromName(name.replace(/^-/, ""));
  if (!hash) context.falhar(`openssl ${command}: resumo desconhecido: ${name}`);
  return hash;
}

async function loadKey(context: EngineContext, command: string, path: string): Promise<PrivateKey | null> {
  const text = readText(context, command, path);
  if (text === null) return null;
  const key = await parsePrivateKey(text);
  if (!key) context.falhar(`${command}: não foi possível ler a chave privada de '${path}'`);
  return key;
}

const issuerKeyId = (certificate: ParsedCertificate): Uint8Array | null => {
  const found = findExtension(certificate, OID.subjectKeyId);
  return found ? found.value.slice(2) : null;
};

export async function req(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["newkey", "keyout", "out", "in", "key", "days", "subj", "config", "md"], ["x509", "new", "nodes", "noenc", "text", "noout", "verify", "sha256", "sha384", "sha512", "sha1", "batch", "utf8", "pubkey"]);
  if (options.unknown) return unknownOption(context, "req", options.unknown);
  const hashFlag = (["sha1", "sha256", "sha384", "sha512"] as const).find((flag) => options.flags.has(flag));
  const hash = hashOption(context, "req", hashFlag ?? first(options, "md"));
  if (!hash) return 1;

  if (options.flags.has("verify") && first(options, "in") !== undefined) {
    const text = readText(context, "openssl req", first(options, "in"));
    const request = text === null ? null : parseRequest(text);
    if (!request) {
      context.falhar("openssl req: não foi possível ler o pedido de certificado");
      return 1;
    }
    const ok = await checkSignature(request.info, request.signatureOid, request.signature, request.publicKey);
    context.linha(ok ? "Certificate request self-signature verify OK" : "Certificate request self-signature did not match the subject public key");
    return ok ? 0 : 1;
  }

  let key: PrivateKey | null;
  const keyPath = first(options, "key");
  if (keyPath !== undefined) key = await loadKey(context, "openssl req", keyPath);
  else {
    const spec = first(options, "newkey") ?? "rsa:2048";
    const [algorithm = "rsa", size = "2048"] = spec.split(":");
    key = await newKey(context, "openssl req", algorithm, Number(size));
    if (key) {
      const target = first(options, "keyout") ?? "privkey.pem";
      if (!options.flags.has("nodes") && !options.flags.has("noenc")) context.falhar("openssl req: aviso: o simulador não cifra a chave privada com senha; ela foi gravada sem proteção (use -nodes para deixar isso claro)");
      if (!writeBytes(context, "openssl req", target, privatePem(key), mode600)) return 1;
    }
  }
  if (!key) return 1;

  const subjectText = first(options, "subj");
  let subject: NameAttribute[];
  if (subjectText !== undefined) {
    const parsed = parseSubject(subjectText);
    if (!parsed) {
      context.falhar(`openssl req: -subj inválido: '${subjectText}' (use o formato /C=BR/O=UTFPR/CN=aula)`);
      return 1;
    }
    subject = parsed;
  } else subject = await askSubject(context);

  const days = Number(first(options, "days") ?? "30");
  if (!Number.isFinite(days) || days < 1) {
    context.falhar("openssl req: -days inválido");
    return 1;
  }
  const output = options.flags.has("x509")
    ? certificatePem(await issueCertificate({ subject, subjectKey: publicOf(key), signer: key, issuerName: null, issuerKeyId: null, days, hash, isCa: true }))
    : requestPem(await createRequest(subject, key, hash));
  let text = "";
  if (options.flags.has("text")) {
    const parsed = options.flags.has("x509") ? parseCertificate(output) : null;
    if (parsed) text += certificateText(parsed);
  }
  if (!options.flags.has("noout")) text += output;
  return writeBytes(context, "openssl req", first(options, "out"), text) ? 0 : 1;
}

function certificateText(certificate: ParsedCertificate): string {
  const serial = Array.from(certificate.serial, (byte) => byte.toString(16).padStart(2, "0")).join(":");
  return [
    "Certificate:",
    "    Data:",
    `        Version: ${certificate.version} (0x${(certificate.version - 1).toString(16)})`,
    `        Serial Number:\n            ${serial}`,
    `        Signature Algorithm: ${certificate.signatureLabel}`,
    `        Issuer: ${nameText(certificate.issuerNode)}`,
    "        Validity",
    `            Not Before: ${dateText(certificate.notBefore)}`,
    `            Not After : ${dateText(certificate.notAfter)}`,
    `        Subject: ${nameText(certificate.subjectNode)}`,
    `        Public Key Algorithm: ${certificate.publicKey?.type === "rsa" ? "rsaEncryption" : "ED25519"}`,
    ...(certificate.publicKey?.type === "rsa" ? [`            Public-Key: (${certificate.publicKey.n.toString(2).length} bit)`] : []),
    `    Signature Algorithm: ${certificate.signatureLabel}`,
    "",
  ].join("\n");
}

async function fingerprint(certificate: ParsedCertificate, hash: HashName): Promise<string> {
  return `${hash === "sha1" ? "SHA1" : hash.toUpperCase()} Fingerprint=${colonHex(await digest(hash, certificate.der))}`;
}

export async function x509(args: string[], context: EngineContext): Promise<number> {
  const printers = ["text", "subject", "issuer", "dates", "enddate", "startdate", "serial", "fingerprint", "noout", "pubkey"];
  const options = openOptions(args, ["in", "out", "CA", "CAkey", "days", "signkey", "md"], [...printers, "req", "CAcreateserial", "sha256", "sha1", "sha384", "sha512", "checkend"]);
  if (options.unknown) return unknownOption(context, "x509", options.unknown);
  const hash = hashOption(context, "x509", (["sha1", "sha256", "sha384", "sha512"] as const).find((flag) => options.flags.has(flag)) ?? first(options, "md"));
  if (!hash) return 1;
  const text = readText(context, "openssl x509", first(options, "in"));
  if (text === null) return 1;

  let certificate: ParsedCertificate | null;
  let pem = text;
  if (options.flags.has("req")) {
    const request = parseRequest(text);
    const caPath = first(options, "CA");
    const caKeyPath = first(options, "CAkey") ?? first(options, "signkey");
    if (!request || !request.publicKey) {
      context.falhar("openssl x509: não foi possível ler o pedido de certificado");
      return 1;
    }
    if (!(await checkSignature(request.info, request.signatureOid, request.signature, request.publicKey))) {
      context.falhar("openssl x509: a assinatura do pedido não confere");
      return 1;
    }
    const days = Number(first(options, "days") ?? "30");
    const subject = parseSubject(`/${nameText(request.subjectNode).split(", ").map((part) => part.replace(" = ", "=")).join("/")}`);
    if (!subject) {
      context.falhar("openssl x509: o nome do pedido não pôde ser lido");
      return 1;
    }
    let signer: PrivateKey | null;
    let issuerName: Uint8Array | null = null;
    let keyId: Uint8Array | null = null;
    if (caPath !== undefined) {
      const caText = readText(context, "openssl x509", caPath);
      const ca = caText === null ? null : parseCertificate(caText);
      if (!ca || caKeyPath === undefined) {
        if (caText !== null) context.falhar(!ca ? "openssl x509: não foi possível ler o certificado da CA" : "openssl x509: falta -CAkey");
        return 1;
      }
      signer = await loadKey(context, "openssl x509", caKeyPath);
      issuerName = ca.subjectNode.bytes;
      keyId = issuerKeyId(ca);
    } else signer = caKeyPath === undefined ? null : await loadKey(context, "openssl x509", caKeyPath);
    if (!signer) {
      if (caKeyPath === undefined) context.falhar("openssl x509: falta -CA e -CAkey (ou -signkey) para assinar");
      return 1;
    }
    pem = certificatePem(await issueCertificate({ subject, subjectKey: request.publicKey, signer, issuerName, issuerKeyId: keyId, days, hash, isCa: false }));
    context.falhar(`Certificate request self-signature ok\nsubject=${nameText(request.subjectNode)}`);
    certificate = parseCertificate(pem);
  } else certificate = parseCertificate(text);
  if (!certificate) {
    context.falhar("openssl x509: não foi possível ler o certificado (precisa ser um PEM de CERTIFICATE)");
    return 1;
  }

  let output = "";
  if (options.flags.has("text")) output += certificateText(certificate);
  if (options.flags.has("subject")) output += `subject=${nameText(certificate.subjectNode)}\n`;
  if (options.flags.has("issuer")) output += `issuer=${nameText(certificate.issuerNode)}\n`;
  if (options.flags.has("serial")) output += `serial=${hex(certificate.serial).toUpperCase()}\n`;
  if (options.flags.has("dates") || options.flags.has("startdate")) output += `notBefore=${dateText(certificate.notBefore)}\n`;
  if (options.flags.has("dates") || options.flags.has("enddate")) output += `notAfter=${dateText(certificate.notAfter)}\n`;
  if (options.flags.has("fingerprint")) output += `${await fingerprint(certificate, hash)}\n`;
  if (!options.flags.has("noout")) output += pem.startsWith("-----") ? pem.slice(pem.indexOf("-----BEGIN CERTIFICATE-----")) : certificatePem(certificate.der);
  if (options.flags.has("req") && !first(options, "out") && output === "") return 0;
  return writeBytes(context, "openssl x509", first(options, "out"), output) ? 0 : 1;
}

/** `openssl verify -CAfile ca.pem cert.pem`: whether each certificate was signed by the CA and is in its dates. */
export async function verify(args: string[], context: EngineContext): Promise<number> {
  const options = openOptions(args, ["CAfile"], []);
  if (options.unknown) return unknownOption(context, "verify", options.unknown);
  const caPath = first(options, "CAfile");
  if (options.positional.length === 0) {
    context.falhar("Uso: openssl verify [-CAfile CA.pem] certificado.pem ...");
    return 1;
  }
  const caText = caPath === undefined ? null : readText(context, "openssl verify", caPath);
  if (caPath !== undefined && caText === null) return 1;
  const ca = caText === null ? null : parseCertificate(caText);
  if (caPath !== undefined && !ca) {
    context.falhar(`openssl verify: não foi possível ler o certificado da CA em '${caPath}'`);
    return 1;
  }
  let status = 0;
  for (const path of options.positional) {
    const text = readText(context, "openssl verify", path);
    if (text === null) {
      status = 2;
      continue;
    }
    const certificate = parseCertificate(text);
    if (!certificate) {
      context.falhar(`${path}: Error: não é um certificado PEM`);
      status = 2;
      continue;
    }
    const subject = nameText(certificate.subjectNode);
    const selfSigned = certificate.issuerNode.bytes.join() === certificate.subjectNode.bytes.join();
    const issuer = ca ?? (selfSigned ? certificate : null);
    const fail = (code: number, message: string) => {
      context.linha(`CN = ${subject.split("CN = ")[1] ?? subject}\nerror ${code} at 0 depth lookup: ${message}`);
      context.linha(`error ${path}: verification failed`);
      status = 2;
    };
    if (!issuer || certificate.issuerNode.bytes.join() !== issuer.subjectNode.bytes.join()) {
      fail(20, "unable to get local issuer certificate");
      continue;
    }
    if (!(await checkSignature(certificate.tbs, certificate.signatureOid, certificate.signature, issuer.publicKey))) {
      fail(7, "certificate signature failure");
      continue;
    }
    const now = new Date();
    if (certificate.notAfter < now) {
      fail(10, "certificate has expired");
      continue;
    }
    if (certificate.notBefore > now) {
      fail(9, "certificate is not yet valid");
      continue;
    }
    context.linha(`${path}: OK`);
  }
  return status;
}
