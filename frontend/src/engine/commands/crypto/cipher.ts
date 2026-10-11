import { concat } from "./bytes";
import { digest, type HashName } from "./hashing";

// AES as `openssl enc` uses it: CBC with PKCS#7 padding and CTR, with keys from PBKDF2 or from EVP_BytesToKey (SPEC-031).

export interface CipherSpec {
  name: string;
  keyLength: number;
  ivLength: number;
  mode: "cbc" | "ctr";
}

const spec = (bits: number, mode: "cbc" | "ctr"): CipherSpec => ({ name: `aes-${bits}-${mode}`, keyLength: bits / 8, ivLength: 16, mode });

export const CIPHERS: Record<string, CipherSpec> = Object.fromEntries(
  [128, 192, 256].flatMap((bits) => (["cbc", "ctr"] as const).map((mode) => [`aes-${bits}-${mode}`, spec(bits, mode)])),
);

const PBKDF2_HASH: Partial<Record<HashName, string>> = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" };

export async function pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number, hash: HashName, length: number): Promise<Uint8Array | null> {
  const name = PBKDF2_HASH[hash];
  if (!name) return null;
  const base = await globalThis.crypto.subtle.importKey("raw", password as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: name }, base, length * 8);
  return new Uint8Array(bits);
}

/** EVP_BytesToKey with one round: the old way of `openssl enc` to turn a password into a key and a vector. */
export async function bytesToKey(hash: HashName, password: Uint8Array, salt: Uint8Array | null, length: number): Promise<Uint8Array> {
  let output: Uint8Array = new Uint8Array(0);
  let previous: Uint8Array = new Uint8Array(0);
  while (output.length < length) {
    previous = await digest(hash, concat(previous, password, salt ?? new Uint8Array(0)));
    output = concat(output, previous);
  }
  return output.slice(0, length);
}

async function importKey(cipher: CipherSpec, key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("raw", key as BufferSource, { name: cipher.mode === "cbc" ? "AES-CBC" : "AES-CTR" }, false, [usage]);
}

export async function aesEncrypt(cipher: CipherSpec, key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await importKey(cipher, key, "encrypt");
  const algorithm = cipher.mode === "cbc" ? { name: "AES-CBC", iv: iv as BufferSource } : { name: "AES-CTR", counter: iv as BufferSource, length: 128 };
  return new Uint8Array(await globalThis.crypto.subtle.encrypt(algorithm, imported, data as BufferSource));
}

/** The plain bytes, or null when the key is wrong (the padding does not fit). */
export async function aesDecrypt(cipher: CipherSpec, key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const imported = await importKey(cipher, key, "decrypt");
    const algorithm = cipher.mode === "cbc" ? { name: "AES-CBC", iv: iv as BufferSource } : { name: "AES-CTR", counter: iv as BufferSource, length: 128 };
    return new Uint8Array(await globalThis.crypto.subtle.decrypt(algorithm, imported, data as BufferSource));
  } catch {
    return null;
  }
}
