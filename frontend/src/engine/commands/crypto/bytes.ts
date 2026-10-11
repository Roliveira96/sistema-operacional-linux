// Bytes, text and encodings shared by the cryptography commands (SPEC-031).

const encoder = new TextEncoder();

export const utf8 = (text: string): Uint8Array => encoder.encode(text);

export const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function fromHex(text: string): Uint8Array | null {
  const clean = text.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const randomBytes = (length: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(length));

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text.replace(/\s+/g, "")), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function wrap(text: string, columns: number): string[] {
  if (columns <= 0) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += columns) lines.push(text.slice(i, i + columns));
  return lines;
}

const CONTROL = /[\x00-\x08\x0e-\x1f\x7f-\x9f]/;

/**
 * The bytes of a file of the simulated machine. Text is stored as text (UTF-8), and binary data written by the
 * cryptography commands is stored one byte per character: a file whose characters are all below 256 and that has a
 * control character is read as binary, anything else as UTF-8.
 */
export function fileBytes(text: string): Uint8Array {
  if (CONTROL.test(text) && Array.from(text).every((char) => char.charCodeAt(0) <= 0xff)) return Uint8Array.from(text, (char) => char.charCodeAt(0));
  return utf8(text);
}

/** The text to store for some bytes: UTF-8 text when they are text, one character per byte when they are binary. */
export function textFromBytes(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!CONTROL.test(text.replace(/[\t\n\r]/g, ""))) return text;
  } catch {
    // not UTF-8: stored as binary below
  }
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

export function pemEncode(label: string, der: Uint8Array): string {
  return `-----BEGIN ${label}-----\n${wrap(toBase64(der), 64).join("\n")}\n-----END ${label}-----\n`;
}

/** The DER inside the first PEM block of the text (with its label), or null. */
export function pemDecode(text: string): { label: string; der: Uint8Array } | null {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!match) return null;
  const der = fromBase64(match[2]!);
  return der ? { label: match[1]!, der } : null;
}

export function bigFromBytes(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

export function bytesFromBig(value: bigint, length?: number): Uint8Array {
  let text = value.toString(16);
  if (text.length % 2 !== 0) text = `0${text}`;
  const bytes = fromHex(text)!;
  return length === undefined ? bytes : concat(new Uint8Array(Math.max(0, length - bytes.length)), bytes);
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}
