import { fileBytes, textFromBytes, wrap } from "./crypto/bytes";
import { defineCommand, parseOptions, readInputs, rejectOptions } from "./helpers";
import { msg } from "./messages";
import type { EngineCommand } from "./types";

// cksum, base32, od and hexdump (SPEC-031, entrega A).

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let crc = i << 24;
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  return crc >>> 0;
});

/** The POSIX checksum of cksum: CRC with the polynomial 0x04C11DB7, then the length, then the complement. */
export function posixCksum(bytes: Uint8Array): number {
  let crc = 0;
  const feed = (byte: number) => {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  };
  for (const byte of bytes) feed(byte);
  for (let length = bytes.length; length > 0; length = Math.floor(length / 256)) feed(length & 0xff);
  return ~crc >>> 0;
}

const cksum = defineCommand(
  "cksum",
  "CRC e tamanho de um arquivo: cksum arquivo",
  {
    uso: "cksum [ARQUIVO]...",
    descricao: "Calcula o CRC e o tamanho em bytes de cada arquivo (ou da entrada padrão). Serve para achar arquivos corrompidos, não para segurança.",
    exemplos: [["cksum a.txt", "mostra o CRC, o tamanho e o nome"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "" });
    if (rejectOptions("cksum", parsed, context)) return 1;
    const { inputs, failed } = readInputs("cksum", parsed.operands, context);
    for (const input of inputs) {
      const bytes = fileBytes(input.text);
      context.linha(`${posixCksum(bytes)} ${bytes.length}${input.name === null ? "" : ` ${input.name}`}`);
    }
    return failed ? 1 : 0;
  },
);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

const base32 = defineCommand(
  "base32",
  "codifica e decodifica em base32: base32 arquivo | base32 -d",
  {
    uso: "base32 [-d] [-w COLUNAS] [ARQUIVO]",
    descricao: "Codifica o arquivo (ou a entrada padrão) em base32, que usa só letras maiúsculas e os números 2 a 7. Com -d, decodifica. Codificar não é cifrar: qualquer pessoa decodifica.",
    opcoes: [
      ["-d", "decodifica em vez de codificar"],
      ["-w COLUNAS", "quebra a linha codificada a cada tantas colunas (padrão 76, 0 não quebra)"],
    ],
    exemplos: [["echo oi | base32", "codifica o texto"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "dw", withValue: "w", long: { decode: "d", wrap: "w" } });
    if (rejectOptions("base32", parsed, context)) return 1;
    const columns = Number(parsed.values.get("w") ?? "76");
    if (!Number.isInteger(columns) || columns < 0) {
      context.falhar(msg.invalidWrap("base32", parsed.values.get("w") ?? ""));
      return 1;
    }
    const { inputs, failed } = readInputs("base32", parsed.operands.slice(0, 1), context);
    if (failed) return 1;
    const text = inputs[0]?.text ?? "";
    if (parsed.flags.has("d")) {
      const bytes = base32Decode(text);
      if (!bytes) {
        context.falhar(msg.invalidInput("base32"));
        return 1;
      }
      context.escrever(textFromBytes(bytes));
      return 0;
    }
    const encoded = base32Encode(fileBytes(text));
    if (encoded === "") return 0;
    if (columns === 0) context.escrever(encoded);
    else for (const line of wrap(encoded, columns)) context.linha(line);
    return 0;
  },
);

const offsetOf = (value: number, radix: string): string => {
  if (radix === "n") return "";
  const base = radix === "x" ? 16 : radix === "d" ? 10 : 8;
  return value.toString(base).padStart(radix === "x" ? 6 : 7, "0");
};

const CHAR_NAMES: Record<number, string> = { 0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };

/** One element of od in the format asked: x1, o1, d1, u1, c or the default octal words. */
function odCell(bytes: Uint8Array, index: number, format: string): { text: string; size: number } {
  const byte = bytes[index]!;
  switch (format) {
    case "x1":
      return { text: ` ${byte.toString(16).padStart(2, "0")}`, size: 1 };
    case "o1":
      return { text: ` ${byte.toString(8).padStart(3, "0")}`, size: 1 };
    case "u1":
      return { text: ` ${byte.toString().padStart(3)}`, size: 1 };
    case "d1":
      return { text: ` ${(byte > 127 ? byte - 256 : byte).toString().padStart(4)}`, size: 1 };
    case "c": {
      const named = CHAR_NAMES[byte];
      const text = named ?? (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : byte.toString(8).padStart(3, "0"));
      return { text: text.padStart(4), size: 1 };
    }
    default: {
      const word = byte | ((bytes[index + 1] ?? 0) << 8);
      return { text: ` ${word.toString(8).padStart(6, "0")}`, size: 2 };
    }
  }
}

const od = defineCommand(
  "od",
  "despeja o conteúdo de um arquivo em octal ou hexadecimal: od -A x -t x1 arquivo",
  {
    uso: "od [-A BASE] [-t FORMATO] [-N BYTES] [ARQUIVO]",
    descricao: "Mostra os bytes do arquivo, 16 por linha, com o endereço à esquerda. Por padrão mostra palavras de 2 bytes em octal.",
    opcoes: [
      ["-A BASE", "base do endereço: o (octal), d (decimal), x (hexadecimal) ou n (sem endereço)"],
      ["-t FORMATO", "x1 (hexa), o1 (octal), d1 e u1 (decimal) ou c (caracteres)"],
      ["-N BYTES", "mostra só os primeiros bytes"],
    ],
    exemplos: [["od -A x -t x1 a.txt", "bytes em hexadecimal com endereço em hexadecimal"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "AtN", withValue: "AtN" });
    if (rejectOptions("od", parsed, context)) return 1;
    const radix = parsed.values.get("A") ?? "o";
    const format = parsed.values.get("t") ?? "o2";
    if (!["o", "d", "x", "n"].includes(radix) || !["x1", "o1", "d1", "u1", "c", "o2"].includes(format)) {
      context.falhar(msg.odInvalid(parsed.values.get("t") ?? radix));
      return 1;
    }
    const { inputs, failed } = readInputs("od", parsed.operands.slice(0, 1), context);
    if (failed) return 1;
    let bytes = fileBytes(inputs[0]?.text ?? "");
    const limit = parsed.values.get("N");
    if (limit !== undefined) bytes = bytes.slice(0, Number(limit));
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const line = bytes.slice(offset, offset + 16);
      let text = "";
      for (let i = 0; i < line.length; ) {
        const cell = odCell(line, i, format);
        text += cell.text;
        i += cell.size;
      }
      context.linha(`${offsetOf(offset, radix)}${text}`);
    }
    if (bytes.length > 0 && radix !== "n") context.linha(offsetOf(bytes.length, radix));
    return 0;
  },
);

const hexByte = (value: number): string => value.toString(16).padStart(2, "0");

const hexdump = defineCommand(
  "hexdump",
  "despeja o conteúdo de um arquivo em hexadecimal: hexdump -C arquivo",
  {
    uso: "hexdump [-C] [ARQUIVO]",
    descricao: "Mostra os bytes do arquivo em hexadecimal. Com -C, no formato canônico: endereço, 16 bytes em hexadecimal e o texto entre barras.",
    opcoes: [["-C", "formato canônico, com o texto ao lado"]],
    exemplos: [["hexdump -C a.txt", "despejo canônico do arquivo"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "C" });
    if (rejectOptions("hexdump", parsed, context)) return 1;
    const { inputs, failed } = readInputs("hexdump", parsed.operands.slice(0, 1), context);
    if (failed) return 1;
    const bytes = fileBytes(inputs[0]?.text ?? "");
    if (bytes.length === 0) return 0;
    const canonical = parsed.flags.has("C");
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const line = bytes.slice(offset, offset + 16);
      if (canonical) {
        const cells = Array.from(line, hexByte);
        const left = cells.slice(0, 8).join(" ");
        const right = cells.slice(8).join(" ");
        const ascii = Array.from(line, (byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join("");
        context.linha(`${offset.toString(16).padStart(8, "0")}  ${left.padEnd(23)}  ${right.padEnd(23)}  |${ascii}|`);
      } else {
        const words: string[] = [];
        for (let i = 0; i < line.length; i += 2) words.push(`${hexByte(line[i + 1] ?? 0)}${hexByte(line[i]!)}`);
        context.linha(`${offset.toString(16).padStart(7, "0")} ${words.join(" ")}`);
      }
    }
    context.linha((canonical ? bytes.length.toString(16).padStart(8, "0") : bytes.length.toString(16).padStart(7, "0")).trimEnd());
    return 0;
  },
);

export const encodingCommands: EngineCommand[] = [cksum, base32, od, hexdump];

