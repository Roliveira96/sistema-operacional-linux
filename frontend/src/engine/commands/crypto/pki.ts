import { bigFromBytes, bytesFromBig, concat, fromBase64, fromHex, modPow, pemDecode, pemEncode, randomBytes, toBase64, utf8 } from "./bytes";
import { digest, type HashName } from "./hashing";

// ASN.1 DER, RSA and Ed25519 keys, as the files of OpenSSL hold them (SPEC-031).

export const OID = {
  rsaEncryption: "1.2.840.113549.1.1.1",
  ed25519: "1.3.101.112",
  sha1WithRSA: "1.2.840.113549.1.1.5",
  sha256WithRSA: "1.2.840.113549.1.1.11",
  sha384WithRSA: "1.2.840.113549.1.1.12",
  sha512WithRSA: "1.2.840.113549.1.1.13",
  commonName: "2.5.4.3",
  country: "2.5.4.6",
  locality: "2.5.4.7",
  state: "2.5.4.8",
  organization: "2.5.4.10",
  unit: "2.5.4.11",
  email: "1.2.840.113549.1.9.1",
  basicConstraints: "2.5.29.19",
  subjectKeyId: "2.5.29.14",
  authorityKeyId: "2.5.29.35",
  keyUsage: "2.5.29.15",
  subjectAltName: "2.5.29.17",
} as const;

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function der(tag: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(...content);
  return concat(Uint8Array.of(tag), encodeLength(body.length), body);
}

export const seq = (...parts: Uint8Array[]): Uint8Array => der(0x30, ...parts);
export const set = (...parts: Uint8Array[]): Uint8Array => der(0x31, ...parts);
export const octet = (bytes: Uint8Array): Uint8Array => der(0x04, bytes);
export const bitString = (bytes: Uint8Array): Uint8Array => der(0x03, Uint8Array.of(0), bytes);
export const nul = (): Uint8Array => der(0x05);
export const bool = (value: boolean): Uint8Array => der(0x01, Uint8Array.of(value ? 0xff : 0));
export const utf8String = (text: string): Uint8Array => der(0x0c, utf8(text));
export const printable = (text: string): Uint8Array => der(0x13, utf8(text));
export const context = (index: number, ...parts: Uint8Array[]): Uint8Array => der(0xa0 | index, ...parts);

export function int(value: bigint | number): Uint8Array {
  let bytes = bytesFromBig(BigInt(value));
  if (bytes[0]! & 0x80) bytes = concat(Uint8Array.of(0), bytes);
  return der(0x02, bytes);
}

export function oid(text: string): Uint8Array {
  const parts = text.split(".").map(Number);
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let rest = part >>> 7; rest > 0; rest >>>= 7) chunk.unshift((rest & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return der(0x06, Uint8Array.from(out));
}

const two = (value: number): string => String(value).padStart(2, "0");

/** UTCTime for the years up to 2049 and GeneralizedTime after, as the certificates do. */
export function time(date: Date): Uint8Array {
  const year = date.getUTCFullYear();
  const rest = `${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
  return year < 2050 ? der(0x17, utf8(`${two(year % 100)}${rest}`)) : der(0x18, utf8(`${year}${rest}`));
}

export interface Node {
  tag: number;
  /** The node with its tag and length. */
  bytes: Uint8Array;
  content: Uint8Array;
}

export function parse(data: Uint8Array, offset = 0): Node {
  const tag = data[offset]!;
  let length = data[offset + 1]!;
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + data[offset + 2 + i]!;
    header = 2 + count;
  }
  if (offset + header + length > data.length) throw new Error("DER truncated");
  return { tag, bytes: data.slice(offset, offset + header + length), content: data.slice(offset + header, offset + header + length) };
}

export function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let offset = 0; offset < node.content.length; ) {
    const child = parse(node.content, offset);
    out.push(child);
    offset += child.bytes.length;
  }
  return out;
}

export const intValue = (node: Node): bigint => bigFromBytes(node.content);

export function oidValue(node: Node): string {
  const bytes = node.content;
  const parts = [Math.floor(bytes[0]! / 40), bytes[0]! % 40];
  let value = 0;
  for (const byte of bytes.slice(1)) {
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

export interface RsaKey {
  n: bigint;
  e: bigint;
  d?: bigint;
  p?: bigint;
  q?: bigint;
  dp?: bigint;
  dq?: bigint;
  qi?: bigint;
}

export type PrivateKey = { type: "rsa"; rsa: RsaKey } | { type: "ed25519"; seed: Uint8Array; pub: Uint8Array };
export type PublicKey = { type: "rsa"; n: bigint; e: bigint } | { type: "ed25519"; pub: Uint8Array };

const ED25519_PKCS8_PREFIX = fromHex("302e020100300506032b657004220420")!;

function rsaPrivateFromPkcs1(node: Node): RsaKey {
  const [, n, e, d, p, q, dp, dq, qi] = children(node).map(intValue) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  return { n, e, d, p, q, dp, dq, qi };
}

/** The private key of a PEM text ("PRIVATE KEY" in PKCS#8 or "RSA PRIVATE KEY" in PKCS#1), or null. */
export async function parsePrivateKey(text: string): Promise<PrivateKey | null> {
  const pem = pemDecode(text);
  if (!pem) return null;
  try {
    if (pem.label === "RSA PRIVATE KEY") return { type: "rsa", rsa: rsaPrivateFromPkcs1(parse(pem.der)) };
    if (pem.label !== "PRIVATE KEY") return null;
    const [, algorithm, body] = children(parse(pem.der)) as [Node, Node, Node];
    const algorithmOid = oidValue(children(algorithm)[0]!);
    if (algorithmOid === OID.rsaEncryption) return { type: "rsa", rsa: rsaPrivateFromPkcs1(parse(body.content)) };
    if (algorithmOid === OID.ed25519) {
      const seed = parse(body.content).content;
      return { type: "ed25519", seed, pub: await ed25519Public(seed) };
    }
  } catch {
    return null;
  }
  return null;
}

function rsaPublicFromPkcs1(node: Node): PublicKey {
  const [n, e] = children(node).map(intValue) as [bigint, bigint];
  return { type: "rsa", n, e };
}

/** The public key of a PEM text ("PUBLIC KEY" or "RSA PUBLIC KEY"), of a certificate's key or a private key, or null. */
export async function parsePublicKey(text: string): Promise<PublicKey | null> {
  const pem = pemDecode(text);
  if (!pem) return null;
  try {
    if (pem.label === "RSA PUBLIC KEY") return rsaPublicFromPkcs1(parse(pem.der));
    if (pem.label === "PUBLIC KEY") return publicFromSpki(parse(pem.der));
    const priv = await parsePrivateKey(text);
    return priv ? publicOf(priv) : null;
  } catch {
    return null;
  }
}

export function publicFromSpki(spkiNode: Node): PublicKey | null {
  const [algorithm, bits] = children(spkiNode) as [Node, Node];
  const algorithmOid = oidValue(children(algorithm)[0]!);
  const key = bits.content.slice(1);
  if (algorithmOid === OID.rsaEncryption) return rsaPublicFromPkcs1(parse(key));
  if (algorithmOid === OID.ed25519) return { type: "ed25519", pub: key };
  return null;
}

export function publicOf(key: PrivateKey): PublicKey {
  return key.type === "rsa" ? { type: "rsa", n: key.rsa.n, e: key.rsa.e } : { type: "ed25519", pub: key.pub };
}

export function rsaPublicPkcs1(key: { n: bigint; e: bigint }): Uint8Array {
  return seq(int(key.n), int(key.e));
}

export function spki(key: PublicKey): Uint8Array {
  if (key.type === "rsa") return seq(seq(oid(OID.rsaEncryption), nul()), bitString(rsaPublicPkcs1(key)));
  return seq(seq(oid(OID.ed25519)), bitString(key.pub));
}

export function pkcs8(key: PrivateKey): Uint8Array {
  if (key.type === "ed25519") return concat(ED25519_PKCS8_PREFIX, key.seed);
  const r = key.rsa;
  return seq(int(0), seq(oid(OID.rsaEncryption), nul()), octet(seq(int(0), int(r.n), int(r.e), int(r.d!), int(r.p!), int(r.q!), int(r.dp!), int(r.dq!), int(r.qi!))));
}

export const privatePem = (key: PrivateKey): string => pemEncode("PRIVATE KEY", pkcs8(key));
export const publicPem = (key: PublicKey): string => pemEncode("PUBLIC KEY", spki(key));

const base64Url = (value: bigint): string => toBase64(bytesFromBig(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string): bigint => bigFromBytes(fromBase64(text.replace(/-/g, "+").replace(/_/g, "/"))!);

export async function generateRsa(bits: number): Promise<RsaKey> {
  const pair = (await globalThis.crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: bits, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", pair.privateKey);
  const value = (field: string | undefined): bigint => fromBase64Url(field!);
  return { n: value(jwk.n), e: value(jwk.e), d: value(jwk.d), p: value(jwk.p), q: value(jwk.q), dp: value(jwk.dp), dq: value(jwk.dq), qi: value(jwk.qi) };
}

export async function generateEd25519(): Promise<PrivateKey | null> {
  try {
    const pair = (await globalThis.crypto.subtle.generateKey({ name: "Ed25519" } as never, true, ["sign", "verify"])) as CryptoKeyPair;
    const seed = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey)).slice(ED25519_PKCS8_PREFIX.length);
    const pub = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", pair.publicKey));
    return { type: "ed25519", seed, pub };
  } catch {
    return null;
  }
}

async function ed25519Public(seed: Uint8Array): Promise<Uint8Array> {
  try {
    const key = await globalThis.crypto.subtle.importKey("pkcs8", concat(ED25519_PKCS8_PREFIX, seed) as BufferSource, { name: "Ed25519" } as never, true, ["sign"]);
    const jwk = await globalThis.crypto.subtle.exportKey("jwk", key);
    return fromBase64(jwk.x!.replace(/-/g, "+").replace(/_/g, "/"))!;
  } catch {
    return new Uint8Array(32);
  }
}

export async function ed25519Sign(key: Extract<PrivateKey, { type: "ed25519" }>, message: Uint8Array): Promise<Uint8Array> {
  const imported = await globalThis.crypto.subtle.importKey("pkcs8", pkcs8(key) as BufferSource, { name: "Ed25519" } as never, false, ["sign"]);
  return new Uint8Array(await globalThis.crypto.subtle.sign({ name: "Ed25519" } as never, imported, message as BufferSource));
}

export async function ed25519Verify(pub: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const imported = await globalThis.crypto.subtle.importKey("raw", pub as BufferSource, { name: "Ed25519" } as never, false, ["verify"]);
  return globalThis.crypto.subtle.verify({ name: "Ed25519" } as never, imported, signature as BufferSource, message as BufferSource);
}

// RSA with PKCS#1 v1.5 and OAEP.

const DIGEST_INFO: Record<HashName, string> = {
  md5: "3020300c06082a864886f70d020505000410",
  sha1: "3021300906052b0e03021a05000414",
  sha224: "302d300d06096086480165030402040500041c",
  sha256: "3031300d060960864801650304020105000420",
  sha384: "3041300d060960864801650304020205000430",
  sha512: "3051300d060960864801650304020305000440",
};

export const modulusBytes = (n: bigint): number => Math.ceil(n.toString(2).length / 8);

function rsaPublicOp(m: bigint, key: { n: bigint; e: bigint }): bigint {
  return modPow(m, key.e, key.n);
}

function rsaPrivateOp(c: bigint, key: RsaKey): bigint {
  if (key.p && key.q && key.dp && key.dq && key.qi) {
    const m1 = modPow(c % key.p, key.dp, key.p);
    const m2 = modPow(c % key.q, key.dq, key.q);
    const h = (((key.qi * (m1 - m2)) % key.p) + key.p) % key.p;
    return m2 + h * key.q;
  }
  return modPow(c, key.d!, key.n);
}

function emsa(hash: HashName, hashed: Uint8Array, length: number): Uint8Array {
  const info = concat(fromHex(DIGEST_INFO[hash])!, hashed);
  return concat(Uint8Array.of(0, 1), new Uint8Array(length - info.length - 3).fill(0xff), Uint8Array.of(0), info);
}

/** The signature RSASSA-PKCS1-v1_5 of an already computed digest. */
export function rsaSignDigest(key: RsaKey, hash: HashName, hashed: Uint8Array): Uint8Array {
  const length = modulusBytes(key.n);
  return bytesFromBig(rsaPrivateOp(bigFromBytes(emsa(hash, hashed, length)), key), length);
}

export function rsaVerifyDigest(key: { n: bigint; e: bigint }, hash: HashName, hashed: Uint8Array, signature: Uint8Array): boolean {
  const length = modulusBytes(key.n);
  if (signature.length !== length) return false;
  const recovered = bytesFromBig(rsaPublicOp(bigFromBytes(signature), key), length);
  const expected = emsa(hash, hashed, length);
  return recovered.length === expected.length && recovered.every((byte, index) => byte === expected[index]);
}

export async function rsaSign(key: RsaKey, hash: HashName, message: Uint8Array): Promise<Uint8Array> {
  return rsaSignDigest(key, hash, await digest(hash, message));
}

export async function rsaVerify(key: { n: bigint; e: bigint }, hash: HashName, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  return rsaVerifyDigest(key, hash, await digest(hash, message), signature);
}

export function rsaEncryptV15(key: { n: bigint; e: bigint }, message: Uint8Array): Uint8Array | null {
  const length = modulusBytes(key.n);
  if (message.length > length - 11) return null;
  const padding = randomBytes(length - message.length - 3).map((byte) => byte || 1);
  return bytesFromBig(rsaPublicOp(bigFromBytes(concat(Uint8Array.of(0, 2), padding, Uint8Array.of(0), message)), key), length);
}

export function rsaDecryptV15(key: RsaKey, cipher: Uint8Array): Uint8Array | null {
  const length = modulusBytes(key.n);
  if (cipher.length !== length) return null;
  const block = bytesFromBig(rsaPrivateOp(bigFromBytes(cipher), key), length);
  if (block[0] !== 0 || block[1] !== 2) return null;
  const end = block.indexOf(0, 2);
  return end < 10 ? null : block.slice(end + 1);
}

const OAEP_HASH: Partial<Record<HashName, string>> = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" };

async function oaepKey(key: RsaKey | { n: bigint; e: bigint }, hash: HashName, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const name = OAEP_HASH[hash]!;
  const rsa = key as RsaKey;
  const jwk: JsonWebKey =
    usage === "decrypt"
      ? { kty: "RSA", n: base64Url(rsa.n), e: base64Url(rsa.e), d: base64Url(rsa.d!), p: base64Url(rsa.p!), q: base64Url(rsa.q!), dp: base64Url(rsa.dp!), dq: base64Url(rsa.dq!), qi: base64Url(rsa.qi!), ext: true }
      : { kty: "RSA", n: base64Url(key.n), e: base64Url(key.e), ext: true };
  return globalThis.crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: name }, false, [usage]);
}

export async function rsaEncryptOaep(key: { n: bigint; e: bigint }, hash: HashName, message: Uint8Array): Promise<Uint8Array | null> {
  if (!OAEP_HASH[hash]) return null;
  try {
    return new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "RSA-OAEP" }, await oaepKey(key, hash, "encrypt"), message as BufferSource));
  } catch {
    return null;
  }
}

export async function rsaDecryptOaep(key: RsaKey, hash: HashName, cipher: Uint8Array): Promise<Uint8Array | null> {
  if (!OAEP_HASH[hash]) return null;
  try {
    return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "RSA-OAEP" }, await oaepKey(key, hash, "decrypt"), cipher as BufferSource));
  } catch {
    return null;
  }
}
