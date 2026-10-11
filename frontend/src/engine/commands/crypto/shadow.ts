import { concat, utf8 } from "./bytes";
import { digest, type HashName } from "./hashing";

// The password hashes of /etc/shadow: $1$ (MD5-crypt), $5$ (SHA-256-crypt) and $6$ (SHA-512-crypt).

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function to64(value: number, count: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < count; i++) {
    out += ITOA64[rest & 0x3f];
    rest >>>= 6;
  }
  return out;
}

const repeatTo = (block: Uint8Array, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = block[i % block.length]!;
  return out;
};

const SHA256_ORDER = [[0, 10, 20], [21, 1, 11], [12, 22, 2], [3, 13, 23], [24, 4, 14], [15, 25, 5], [6, 16, 26], [27, 7, 17], [18, 28, 8], [9, 19, 29]];
const SHA512_ORDER = [
  [0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48], [28, 49, 7], [50, 8, 29], [9, 30, 51],
  [31, 52, 10], [53, 11, 32], [12, 33, 54], [34, 55, 13], [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41],
];

/** SHA-crypt, by Ulrich Drepper: $5$ with SHA-256 and $6$ with SHA-512, 5000 rounds. */
async function shaCrypt(kind: "5" | "6", password: string, salt: string): Promise<string> {
  const hash: HashName = kind === "5" ? "sha256" : "sha512";
  const hashLength = kind === "5" ? 32 : 64;
  const pw = utf8(password);
  const slt = utf8(salt);
  const b = await digest(hash, concat(pw, slt, pw));
  let context = concat(pw, slt);
  for (let count = pw.length; count > 0; count -= hashLength) context = concat(context, b.slice(0, Math.min(hashLength, count)));
  for (let count = pw.length; count > 0; count >>= 1) context = concat(context, count & 1 ? b : pw);
  let a = await digest(hash, context);
  let dp: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < pw.length; i++) dp = concat(dp, pw);
  const p = repeatTo(await digest(hash, dp), pw.length);
  let ds: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < 16 + a[0]!; i++) ds = concat(ds, slt);
  const s = repeatTo(await digest(hash, ds), slt.length);
  for (let i = 0; i < 5000; i++) {
    let round = i & 1 ? p : a;
    if (i % 3 !== 0) round = concat(round, s);
    if (i % 7 !== 0) round = concat(round, p);
    round = concat(round, i & 1 ? a : p);
    a = await digest(hash, round);
  }
  let out = "";
  for (const [x, y, z] of kind === "5" ? SHA256_ORDER : SHA512_ORDER) out += to64((a[x!]! << 16) | (a[y!]! << 8) | a[z!]!, 4);
  out += kind === "5" ? to64((a[31]! << 8) | a[30]!, 3) : to64(a[63]!, 2);
  return `$${kind}$${salt}$${out}`;
}

/** MD5-crypt ($1$), the old FreeBSD scheme. */
async function md5Crypt(password: string, salt: string): Promise<string> {
  const pw = utf8(password);
  const slt = utf8(salt);
  const alt = await digest("md5", concat(pw, slt, pw));
  let context = concat(pw, utf8("$1$"), slt);
  for (let length = pw.length; length > 0; length -= 16) context = concat(context, alt.slice(0, Math.min(16, length)));
  for (let i = pw.length; i > 0; i >>= 1) context = concat(context, i & 1 ? new Uint8Array(1) : pw.slice(0, 1));
  let final = await digest("md5", context);
  for (let i = 0; i < 1000; i++) {
    let round = i & 1 ? pw : final;
    if (i % 3 !== 0) round = concat(round, slt);
    if (i % 7 !== 0) round = concat(round, pw);
    round = concat(round, i & 1 ? final : pw);
    final = await digest("md5", round);
  }
  const f = final;
  const out =
    to64((f[0]! << 16) | (f[6]! << 8) | f[12]!, 4) +
    to64((f[1]! << 16) | (f[7]! << 8) | f[13]!, 4) +
    to64((f[2]! << 16) | (f[8]! << 8) | f[14]!, 4) +
    to64((f[3]! << 16) | (f[9]! << 8) | f[15]!, 4) +
    to64((f[4]! << 16) | (f[10]! << 8) | f[5]!, 4) +
    to64(f[11]!, 2);
  return `$1$${salt}$${out}`;
}

/** A random salt of the alphabet of the hashes: 8 characters for $1$ and 16 for the others. */
export function randomSalt(kind: "1" | "5" | "6"): string {
  const length = kind === "1" ? 8 : 16;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ITOA64[byte & 0x3f]).join("");
}

/** The /etc/shadow hash of a password for the scheme ("1", "5" or "6") and the salt. */
export async function passwordHash(kind: "1" | "5" | "6", password: string, salt: string): Promise<string> {
  const clean = salt.slice(0, kind === "1" ? 8 : 16);
  if (kind === "1") return md5Crypt(password, clean);
  return shaCrypt(kind, password, clean);
}
