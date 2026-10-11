import { concat, pemDecode, pemEncode, randomBytes } from "./bytes";
import { digest, type HashName } from "./hashing";
import {
  bitString,
  bool,
  children,
  context,
  der,
  ed25519Sign,
  ed25519Verify,
  int,
  intValue,
  nul,
  octet,
  oid,
  oidValue,
  OID,
  parse,
  printable,
  publicFromSpki,
  rsaSign,
  rsaVerify,
  seq,
  set,
  spki,
  time,
  utf8String,
  type Node,
  type PrivateKey,
  type PublicKey,
  publicOf,
} from "./pki";

// X.509 certificates and certificate requests: building, reading and checking (SPEC-031, openssl req, x509 and verify).

export interface NameAttribute {
  oid: string;
  value: string;
}

const SHORT_NAMES: Record<string, string> = { C: OID.country, ST: OID.state, L: OID.locality, O: OID.organization, OU: OID.unit, CN: OID.commonName, emailAddress: OID.email };
const LABELS: Record<string, string> = {
  [OID.country]: "C",
  [OID.state]: "ST",
  [OID.locality]: "L",
  [OID.organization]: "O",
  [OID.unit]: "OU",
  [OID.commonName]: "CN",
  [OID.email]: "emailAddress",
};

/** "/C=BR/O=UTFPR/CN=aula" as attributes, or null when it is not in that form. */
export function parseSubject(text: string): NameAttribute[] | null {
  if (!text.startsWith("/")) return null;
  const attributes: NameAttribute[] = [];
  for (const part of text.slice(1).split(/\/(?=[A-Za-z]+=)/)) {
    const [key, ...rest] = part.split("=");
    const id = SHORT_NAMES[key ?? ""];
    if (!id || rest.length === 0) return null;
    attributes.push({ oid: id, value: rest.join("=") });
  }
  return attributes;
}

function nameDer(attributes: NameAttribute[]): Uint8Array {
  return seq(
    ...attributes.map((attribute) => {
      const value = attribute.oid === OID.country ? printable(attribute.value) : attribute.oid === OID.email ? der(0x16, new TextEncoder().encode(attribute.value)) : utf8String(attribute.value);
      return set(seq(oid(attribute.oid), value));
    }),
  );
}

/** The name as OpenSSL 3 prints it: "C = BR, O = UTFPR, CN = aula". */
export function nameText(node: Node): string {
  return children(node)
    .map((rdn) => {
      const [id, value] = children(children(rdn)[0]!) as [Node, Node];
      return `${LABELS[oidValue(id)] ?? oidValue(id)} = ${new TextDecoder().decode(value.content)}`;
    })
    .join(", ");
}

const SIGNATURE_OID: Record<string, { hash: HashName; label: string; oid: string }> = {
  sha1: { hash: "sha1", label: "sha1WithRSAEncryption", oid: OID.sha1WithRSA },
  sha256: { hash: "sha256", label: "sha256WithRSAEncryption", oid: OID.sha256WithRSA },
  sha384: { hash: "sha384", label: "sha384WithRSAEncryption", oid: OID.sha384WithRSA },
  sha512: { hash: "sha512", label: "sha512WithRSAEncryption", oid: OID.sha512WithRSA },
};

function signatureAlgorithm(key: PrivateKey, hash: HashName): { algorithm: Uint8Array; label: string } {
  if (key.type === "ed25519") return { algorithm: seq(oid(OID.ed25519)), label: "ED25519" };
  const entry = SIGNATURE_OID[hash] ?? SIGNATURE_OID.sha256!;
  return { algorithm: seq(oid(entry.oid), nul()), label: entry.label };
}

async function signData(key: PrivateKey, hash: HashName, data: Uint8Array): Promise<Uint8Array> {
  return key.type === "ed25519" ? ed25519Sign(key, data) : rsaSign(key.rsa, hash, data);
}

async function keyIdentifier(key: PublicKey): Promise<Uint8Array> {
  const bitsNode = children(parse(spki(key)))[1]!;
  return digest("sha1", bitsNode.content.slice(1));
}

function extension(id: string, value: Uint8Array, critical = false): Uint8Array {
  return seq(oid(id), ...(critical ? [bool(true)] : []), octet(value));
}

export interface IssueOptions {
  subject: NameAttribute[];
  subjectKey: PublicKey;
  signer: PrivateKey;
  /** The name of the issuer: the signer itself when null. */
  issuerName: Uint8Array | null;
  /** The key identifier of the issuer's certificate, for the authority key identifier. */
  issuerKeyId: Uint8Array | null;
  days: number;
  hash: HashName;
  isCa: boolean;
  serial?: Uint8Array;
  now?: Date;
}

/** The DER of a certificate, signed by the signer's key. */
export async function issueCertificate(options: IssueOptions): Promise<Uint8Array> {
  const now = options.now ?? new Date();
  const notBefore = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const notAfter = new Date(notBefore.getTime() + options.days * 86_400_000);
  const serial = options.serial ?? Uint8Array.of(randomBytes(1)[0]! & 0x7f, ...randomBytes(19));
  const subjectName = nameDer(options.subject);
  const { algorithm } = signatureAlgorithm(options.signer, options.hash);
  const extensions = [extension(OID.subjectKeyId, octet(await keyIdentifier(options.subjectKey)))];
  if (options.issuerKeyId) extensions.push(extension(OID.authorityKeyId, seq(der(0x80, options.issuerKeyId))));
  extensions.push(extension(OID.basicConstraints, seq(...(options.isCa ? [bool(true)] : [])), true));
  const tbs = seq(
    context(0, int(2)),
    der(0x02, serial[0]! & 0x80 ? concat(Uint8Array.of(0), serial) : serial),
    algorithm,
    options.issuerName ?? subjectName,
    seq(time(notBefore), time(notAfter)),
    subjectName,
    spki(options.subjectKey),
    context(3, seq(...extensions)),
  );
  return seq(tbs, algorithm, bitString(await signData(options.signer, options.hash, tbs)));
}

/** The DER of a certificate request (PKCS#10) for the subject and key. */
export async function createRequest(subject: NameAttribute[], signer: PrivateKey, hash: HashName): Promise<Uint8Array> {
  const info = seq(int(0), nameDer(subject), spki(publicOf(signer)), context(0));
  const { algorithm } = signatureAlgorithm(signer, hash);
  return seq(info, algorithm, bitString(await signData(signer, hash, info)));
}

export interface ParsedCertificate {
  der: Uint8Array;
  tbs: Uint8Array;
  version: number;
  serial: Uint8Array;
  signatureOid: string;
  signatureLabel: string;
  issuerNode: Node;
  subjectNode: Node;
  notBefore: Date;
  notAfter: Date;
  publicKey: PublicKey | null;
  spkiBytes: Uint8Array;
  extensions: { oid: string; critical: boolean; value: Uint8Array }[];
  signature: Uint8Array;
}

function parseTime(node: Node): Date {
  const text = new TextDecoder().decode(node.content);
  const year = node.tag === 0x17 ? (Number(text.slice(0, 2)) >= 50 ? 1900 : 2000) + Number(text.slice(0, 2)) : Number(text.slice(0, 4));
  const rest = node.tag === 0x17 ? text.slice(2) : text.slice(4);
  return new Date(Date.UTC(year, Number(rest.slice(0, 2)) - 1, Number(rest.slice(2, 4)), Number(rest.slice(4, 6)), Number(rest.slice(6, 8)), Number(rest.slice(8, 10))));
}

const SIGNATURE_LABELS: Record<string, string> = {
  [OID.sha1WithRSA]: "sha1WithRSAEncryption",
  [OID.sha256WithRSA]: "sha256WithRSAEncryption",
  [OID.sha384WithRSA]: "sha384WithRSAEncryption",
  [OID.sha512WithRSA]: "sha512WithRSAEncryption",
  [OID.ed25519]: "ED25519",
};

/** The certificate in a PEM or DER text, read for its fields; null when it is not a certificate. */
export function parseCertificate(text: string): ParsedCertificate | null {
  const pem = pemDecode(text);
  if (!pem || pem.label !== "CERTIFICATE") return null;
  try {
    const [tbsNode, algorithmNode, signatureNode] = children(parse(pem.der)) as [Node, Node, Node];
    const fields = children(tbsNode);
    const versioned = fields[0]!.tag === 0xa0;
    const offset = versioned ? 1 : 0;
    const [serialNode, , issuerNode, validityNode, subjectNode, spkiNode] = fields.slice(offset) as [Node, Node, Node, Node, Node, Node];
    const [before, after] = children(validityNode) as [Node, Node];
    const extensionsNode = fields.find((field) => field.tag === 0xa3);
    const signatureOid = oidValue(children(algorithmNode)[0]!);
    return {
      der: pem.der,
      tbs: tbsNode.bytes,
      version: versioned ? Number(intValue(children(fields[0]!)[0]!)) + 1 : 1,
      serial: serialNode.content,
      signatureOid,
      signatureLabel: SIGNATURE_LABELS[signatureOid] ?? signatureOid,
      issuerNode,
      subjectNode,
      notBefore: parseTime(before),
      notAfter: parseTime(after),
      publicKey: publicFromSpki(spkiNode),
      spkiBytes: spkiNode.bytes,
      extensions: extensionsNode
        ? children(children(extensionsNode)[0]!).map((item) => {
            const parts = children(item);
            const critical = parts[1]!.tag === 0x01;
            return { oid: oidValue(parts[0]!), critical, value: parts[critical ? 2 : 1]!.content };
          })
        : [],
      signature: signatureNode.content.slice(1),
    };
  } catch {
    return null;
  }
}

export interface ParsedRequest {
  subjectNode: Node;
  publicKey: PublicKey | null;
  info: Uint8Array;
  signatureOid: string;
  signature: Uint8Array;
}

export function parseRequest(text: string): ParsedRequest | null {
  const pem = pemDecode(text);
  if (!pem || !pem.label.includes("CERTIFICATE REQUEST")) return null;
  try {
    const [infoNode, algorithmNode, signatureNode] = children(parse(pem.der)) as [Node, Node, Node];
    const [, subjectNode, spkiNode] = children(infoNode) as [Node, Node, Node];
    return { subjectNode, publicKey: publicFromSpki(spkiNode), info: infoNode.bytes, signatureOid: oidValue(children(algorithmNode)[0]!), signature: signatureNode.content.slice(1) };
  } catch {
    return null;
  }
}

function hashOfSignature(signatureOid: string): HashName {
  return (Object.values(SIGNATURE_OID).find((entry) => entry.oid === signatureOid)?.hash ?? "sha256") as HashName;
}

/** Whether the signature of the certificate (or request) was made with the key that goes with this public key. */
export async function checkSignature(data: Uint8Array, signatureOid: string, signature: Uint8Array, key: PublicKey | null): Promise<boolean> {
  if (!key) return false;
  if (key.type === "ed25519") return signatureOid === OID.ed25519 && ed25519Verify(key.pub, data, signature);
  if (signatureOid === OID.ed25519) return false;
  return rsaVerify(key, hashOfSignature(signatureOid), data, signature);
}

export const certificatePem = (derBytes: Uint8Array): string => pemEncode("CERTIFICATE", derBytes);
export const requestPem = (derBytes: Uint8Array): string => pemEncode("CERTIFICATE REQUEST", derBytes);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 10 12:00:00 2026 GMT", the way OpenSSL prints dates. */
export function dateText(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, " ")} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} ${date.getUTCFullYear()} GMT`;
}

export const colonHex = (bytes: Uint8Array, upper = true): string => {
  const text = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(":");
  return upper ? text.toUpperCase() : text;
};

/** The extension of the certificate with this identifier, or undefined. */
export const findExtension = (certificate: ParsedCertificate, id: string) => certificate.extensions.find((item) => item.oid === id);

