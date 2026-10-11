import { md5, sha224, sha256 } from "../digest";
import { concat, fromHex } from "./bytes";

export type HashName = "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512";

export const HASH_BLOCK: Record<HashName, number> = { md5: 64, sha1: 64, sha224: 64, sha256: 64, sha384: 128, sha512: 128 };

const SUBTLE: Partial<Record<HashName, string>> = { sha1: "SHA-1", sha384: "SHA-384", sha512: "SHA-512" };

/** The digest of some bytes, as bytes. MD5, SHA-224 and SHA-256 are computed here; the others by the browser. */
export async function digest(name: HashName, bytes: Uint8Array): Promise<Uint8Array> {
  if (name === "md5") return fromHex(md5(bytes))!;
  if (name === "sha224") return fromHex(sha224(bytes))!;
  if (name === "sha256") return fromHex(sha256(bytes))!;
  return new Uint8Array(await globalThis.crypto.subtle.digest(SUBTLE[name]!, bytes as BufferSource));
}

export async function digestHex(name: HashName, bytes: Uint8Array): Promise<string> {
  return Array.from(await digest(name, bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** HMAC (RFC 2104) over any of the digests. */
export async function hmac(name: HashName, key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const block = HASH_BLOCK[name];
  const shortKey = key.length > block ? await digest(name, key) : key;
  const padded = concat(shortKey, new Uint8Array(block - shortKey.length));
  const inner = await digest(name, concat(padded.map((byte) => byte ^ 0x36), message));
  return digest(name, concat(padded.map((byte) => byte ^ 0x5c), inner));
}

/** The names the commands accept ("sha256", "SHA2-256", "sha-256") as a digest, or null. */
export function hashFromName(text: string): HashName | null {
  const clean = text.toLowerCase().replace(/^-/, "").replace(/-/g, "").replace(/^sha2(?=\d{3}$)/, "sha");
  return (["md5", "sha1", "sha224", "sha256", "sha384", "sha512"] as const).find((name) => name === clean) ?? null;
}

/** The label OpenSSL 3 prints for each digest. */
export const HASH_LABEL: Record<HashName, string> = { md5: "MD5", sha1: "SHA1", sha224: "SHA2-224", sha256: "SHA2-256", sha384: "SHA2-384", sha512: "SHA2-512" };
