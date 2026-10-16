import { fileBytes, textFromBytes } from "./crypto/bytes";
import { sumCommands } from "./crypto/sums";
import { defineCommand, linesOf, messageOf, parseOptions, readInputs, rejectOptions } from "./helpers";
import { msg } from "./messages";
import type { EngineCommand, EngineContext, EngineNode } from "./types";

/** The path of the typed argument without trailing slashes ("a/b//" is "a/b"). */
const trimSlashes = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, "") || "/" : path);

function unescapeDelimiter(text: string): string {
  return text.replace(/\\(t|n|\\|0)/g, (_, c: string) => (c === "t" ? "\t" : c === "n" ? "\n" : c === "0" ? "" : "\\"));
}

const tac = defineCommand(
  "tac",
  "mostra o arquivo de trás para frente: tac arquivo.txt",
  {
    uso: "tac [ARQUIVO]...",
    descricao: "Escreve as linhas de cada arquivo em ordem inversa, da última para a primeira. Sem arquivo, lê a entrada padrão.",
    exemplos: [["tac frutas.txt", "mostra a última linha primeiro"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "" });
    if (rejectOptions("tac", parsed, context)) return 1;
    const { inputs, failed } = readInputs("tac", parsed.operands, context);
    for (const input of inputs) for (const line of linesOf(input.text).reverse()) context.linha(line);
    return failed ? 1 : 0;
  },
);

const paste = defineCommand(
  "paste",
  "junta linhas de arquivos lado a lado: paste a.txt b.txt",
  {
    uso: "paste [-s] [-d DELIMITADORES] [ARQUIVO]...",
    descricao: "Junta as linhas correspondentes dos arquivos, separadas por tabulação. Com -s, junta todas as linhas de cada arquivo numa só.",
    opcoes: [
      ["-d LISTA", "usa os caracteres da lista no lugar da tabulação"],
      ["-s", "junta as linhas de cada arquivo em uma linha só"],
    ],
    exemplos: [["paste -d, nomes.txt idades.txt", "une os dois arquivos com vírgula"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "ds", withValue: "d" });
    if (rejectOptions("paste", parsed, context)) return 1;
    const delimiters = Array.from(unescapeDelimiter(parsed.values.get("d") ?? "\t"));
    const { inputs, failed } = readInputs("paste", parsed.operands, context);
    const columns = inputs.map((input) => linesOf(input.text));
    // Several "-" are the same standard input, and each one takes the next line in turn: "paste - -" joins the lines in pairs.
    const fromInput = inputs.flatMap((input, index) => (input.name === null ? [index] : []));
    if (fromInput.length > 1 && !parsed.flags.has("s")) {
      const all = linesOf(context.entrada ?? "");
      fromInput.forEach((column, position) => (columns[column] = all.filter((_, line) => line % fromInput.length === position)));
    }
    const pick = (index: number): string => delimiters[index % delimiters.length] ?? "\t";
    if (parsed.flags.has("s")) {
      for (const column of columns) context.linha(column.reduce((out, line, i) => (i === 0 ? line : out + pick(i - 1) + line), ""));
    } else {
      const rows = Math.max(0, ...columns.map((column) => column.length));
      for (let row = 0; row < rows; row++) context.linha(columns.map((column) => column[row] ?? "").reduce((out, cell, i) => (i === 0 ? cell : out + pick(i - 1) + cell), ""));
    }
    return failed ? 1 : 0;
  },
);

interface Hunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/** The differing ranges between two lists of lines, by the longest common subsequence. */
function diffHunks(a: string[], b: string[]): Hunk[] {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let current: Hunk | null = null;
  const close = () => {
    if (current) hunks.push(current);
    current = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      i++;
      j++;
      continue;
    }
    current ??= { aStart: i, aEnd: i, bStart: j, bEnd: j };
    if (j < m && (i >= n || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      j++;
      current.bEnd = j;
    } else {
      i++;
      current.aEnd = i;
    }
  }
  close();
  return hunks;
}

const range = (from: number, to: number): string => (from === to ? `${from}` : `${from},${to}`);

function normalDiff(a: string[], b: string[], hunks: Hunk[], context: EngineContext): void {
  for (const h of hunks) {
    const removed = h.aEnd - h.aStart;
    const added = h.bEnd - h.bStart;
    if (removed === 0) context.linha(`${h.aStart}a${range(h.bStart + 1, h.bEnd)}`);
    else if (added === 0) context.linha(`${range(h.aStart + 1, h.aEnd)}d${h.bStart}`);
    else context.linha(`${range(h.aStart + 1, h.aEnd)}c${range(h.bStart + 1, h.bEnd)}`);
    for (const line of a.slice(h.aStart, h.aEnd)) context.linha(`< ${line}`);
    if (removed > 0 && added > 0) context.linha("---");
    for (const line of b.slice(h.bStart, h.bEnd)) context.linha(`> ${line}`);
  }
}

function unifiedDiff(a: string[], b: string[], hunks: Hunk[], names: [string, string], nodes: [EngineNode, EngineNode], context: EngineContext): void {
  const stamp = (node: EngineNode) => `${node.modificadoEm.toISOString().replace("T", " ").replace("Z", "")}000000 +0000`;
  context.linha(`--- ${names[0]}\t${stamp(nodes[0])}`);
  context.linha(`+++ ${names[1]}\t${stamp(nodes[1])}`);
  const groups: Hunk[][] = [];
  for (const h of hunks) {
    const last = groups[groups.length - 1];
    if (last && h.aStart - last[last.length - 1]!.aEnd <= 6) last.push(h);
    else groups.push([h]);
  }
  const span = (start: number, count: number) => (count === 0 ? `${start}` : count === 1 ? `${start + 1}` : `${start + 1},${count}`);
  for (const group of groups) {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const aFrom = Math.max(0, first.aStart - 3);
    const aTo = Math.min(a.length, last.aEnd + 3);
    const bFrom = first.bStart - (first.aStart - aFrom);
    const bTo = last.bEnd + (aTo - last.aEnd);
    context.linha(`@@ -${span(aFrom, aTo - aFrom)} +${span(bFrom, bTo - bFrom)} @@`);
    let position = aFrom;
    for (const h of group) {
      for (; position < h.aStart; position++) context.linha(` ${a[position]}`);
      for (const line of a.slice(h.aStart, h.aEnd)) context.linha(`-${line}`);
      for (const line of b.slice(h.bStart, h.bEnd)) context.linha(`+${line}`);
      position = h.aEnd;
    }
    for (; position < aTo; position++) context.linha(` ${a[position]}`);
  }
}

const diff = defineCommand(
  "diff",
  "compara dois arquivos linha a linha: diff a.txt b.txt",
  {
    uso: "diff [-q] [-u] ARQUIVO1 ARQUIVO2",
    descricao: "Compara dois arquivos e mostra as linhas que mudam. Sai com 0 se são iguais, 1 se diferem e 2 se houve erro.",
    opcoes: [
      ["-u", "formato unificado, com 3 linhas de contexto"],
      ["-q", "só informa se os arquivos diferem"],
    ],
    exemplos: [["diff -u antigo.txt novo.txt", "mostra as mudanças no formato unificado"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "uq" });
    if (rejectOptions("diff", parsed, context)) return 2;
    if (parsed.operands.length !== 2) {
      context.falhar(parsed.operands.length < 2 ? msg.missingOperand("diff") : msg.extraOperand("diff", parsed.operands[2]!));
      context.falhar(msg.tryHelp("diff"));
      return 2;
    }
    const nodes: EngineNode[] = [];
    for (const path of parsed.operands) {
      try {
        const node = context.localizar(path);
        if (node.ehDiretorio()) {
          context.falhar(msg.isDirectory("diff", path));
          return 2;
        }
        nodes.push(node);
      } catch (error) {
        context.falhar(msg.fileError("diff", path, messageOf(error)));
        return 2;
      }
    }
    const a = linesOf(nodes[0]!.ler?.() ?? "");
    const b = linesOf(nodes[1]!.ler?.() ?? "");
    const hunks = diffHunks(a, b);
    if (hunks.length === 0) return 0;
    if (parsed.flags.has("q")) {
      context.linha(msg.filesDiffer(parsed.operands[0]!, parsed.operands[1]!));
      return 1;
    }
    if (parsed.flags.has("u")) unifiedDiff(a, b, hunks, [parsed.operands[0]!, parsed.operands[1]!], [nodes[0]!, nodes[1]!], context);
    else normalDiff(a, b, hunks, context);
    return 1;
  },
);

const nl = defineCommand(
  "nl",
  "numera as linhas de um arquivo: nl arquivo.txt",
  {
    uso: "nl [OPÇÃO]... [ARQUIVO]...",
    descricao: "Escreve os arquivos com as linhas numeradas. Por padrão numera só as linhas que não estão vazias.",
    opcoes: [
      ["-b ESTILO", "a numera todas as linhas, t só as não vazias (padrão), n nenhuma"],
      ["-w LARGURA", "largura do número (padrão 6)"],
      ["-s TEXTO", "texto entre o número e a linha (padrão tabulação)"],
      ["-v INÍCIO", "número da primeira linha (padrão 1)"],
    ],
    exemplos: [["nl -b a frutas.txt", "numera todas as linhas, inclusive as vazias"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "bwsv", withValue: "bwsv" });
    if (rejectOptions("nl", parsed, context)) return 1;
    const style = parsed.values.get("b") ?? "t";
    const width = Number(parsed.values.get("w") ?? "6");
    const separator = parsed.values.get("s") ?? "\t";
    let number = Number(parsed.values.get("v") ?? "1");
    if (!["a", "t", "n"].includes(style)) {
      context.falhar(msg.invalidStyle("nl", style));
      return 1;
    }
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(number)) {
      context.falhar(msg.invalidNumber("nl", parsed.values.get("w") ?? parsed.values.get("v") ?? ""));
      return 1;
    }
    const { inputs, failed } = readInputs("nl", parsed.operands, context);
    for (const input of inputs) {
      for (const line of linesOf(input.text)) {
        if (style === "a" || (style === "t" && line !== "")) context.linha(`${String(number++).padStart(width)}${separator}${line}`);
        else context.linha(`${" ".repeat(width + separator.length)}${line}`);
      }
    }
    return failed ? 1 : 0;
  },
);

const rev = defineCommand(
  "rev",
  "inverte cada linha, letra por letra: rev arquivo.txt",
  {
    uso: "rev [ARQUIVO]...",
    descricao: "Escreve cada linha do arquivo de trás para frente. Sem arquivo, lê a entrada padrão.",
    exemplos: [["echo linux | rev", "mostra xunil"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "" });
    if (rejectOptions("rev", parsed, context)) return 1;
    const { inputs, failed } = readInputs("rev", parsed.operands, context);
    for (const input of inputs) for (const line of linesOf(input.text)) context.linha(Array.from(line).reverse().join(""));
    return failed ? 1 : 0;
  },
);

const hexByte = (value: number): string => value.toString(16).padStart(2, "0");

const xxd = defineCommand(
  "xxd",
  "mostra um arquivo em hexadecimal: xxd arquivo",
  {
    uso: "xxd [-p] [-l TAMANHO] [-c COLUNAS] [ARQUIVO]",
    descricao: "Mostra os bytes do arquivo em hexadecimal, com o endereço à esquerda e o texto à direita.",
    h: "ajuda",
    opcoes: [
      ["-p", "só os bytes em hexadecimal, sem endereço nem texto"],
      ["-l TAMANHO", "mostra só os primeiros bytes"],
      ["-c COLUNAS", "bytes por linha (padrão 16, ou 30 com -p)"],
    ],
    exemplos: [["xxd a.txt", "despeja o arquivo em hexadecimal"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "plch", withValue: "lc" });
    if (rejectOptions("xxd", parsed, context)) return 1;
    const plain = parsed.flags.has("p");
    const cols = Number(parsed.values.get("c") ?? (plain ? "30" : "16"));
    if (!Number.isInteger(cols) || cols < 1 || cols > 256) {
      context.falhar(msg.invalidColumns("xxd", parsed.values.get("c") ?? ""));
      return 1;
    }
    const { inputs, failed } = readInputs("xxd", parsed.operands.slice(0, 1), context);
    if (failed) return 1;
    let bytes = fileBytes(inputs[0]?.text ?? "");
    const limit = parsed.values.get("l");
    if (limit !== undefined) bytes = bytes.slice(0, Number(limit));
    for (let offset = 0; offset < bytes.length; offset += cols) {
      const chunk = Array.from(bytes.slice(offset, offset + cols));
      if (plain) {
        context.linha(chunk.map(hexByte).join(""));
        continue;
      }
      const groups: string[] = [];
      for (let i = 0; i < chunk.length; i += 2) groups.push(chunk.slice(i, i + 2).map(hexByte).join(""));
      const width = cols * 2 + Math.ceil(cols / 2) - 1;
      const text = chunk.map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join("");
      context.linha(`${offset.toString(16).padStart(8, "0")}: ${groups.join(" ").padEnd(width)}  ${text}`);
    }
    return 0;
  },
);

const base64 = defineCommand(
  "base64",
  "codifica e decodifica em base64: base64 arquivo | base64 -d",
  {
    uso: "base64 [-d] [-w COLUNAS] [ARQUIVO]",
    descricao: "Codifica o arquivo (ou a entrada padrão) em base64. Com -d, decodifica.",
    opcoes: [
      ["-d", "decodifica em vez de codificar"],
      ["-w COLUNAS", "quebra a linha codificada a cada tantas colunas (padrão 76, 0 não quebra)"],
    ],
    exemplos: [["echo oi | base64", "codifica o texto"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "dw", withValue: "w", long: { decode: "d", wrap: "w" } });
    if (rejectOptions("base64", parsed, context)) return 1;
    const wrap = Number(parsed.values.get("w") ?? "76");
    if (!Number.isInteger(wrap) || wrap < 0) {
      context.falhar(msg.invalidWrap("base64", parsed.values.get("w") ?? ""));
      return 1;
    }
    const { inputs, failed } = readInputs("base64", parsed.operands.slice(0, 1), context);
    if (failed) return 1;
    const text = inputs[0]?.text ?? "";
    if (parsed.flags.has("d")) {
      try {
        const binary = atob(text.replace(/\s+/g, ""));
        context.escrever(textFromBytes(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
        return 0;
      } catch {
        context.falhar(msg.invalidInput("base64"));
        return 1;
      }
    }
    const encoded = btoa(Array.from(fileBytes(text), (byte) => String.fromCharCode(byte)).join(""));
    if (encoded === "") return 0;
    if (wrap === 0) context.escrever(encoded);
    else for (let i = 0; i < encoded.length; i += wrap) context.linha(encoded.slice(i, i + wrap));
    return 0;
  },
);

function parseNumber(text: string): number | null {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : null;
}

const decimalsOf = (text: string): number => (text.includes(".") ? text.split(".")[1]!.length : 0);

const seq = defineCommand(
  "seq",
  "gera uma sequência de números: seq 1 5",
  {
    uso: "seq [OPÇÃO]... ÚLTIMO | PRIMEIRO ÚLTIMO | PRIMEIRO PASSO ÚLTIMO",
    descricao: "Escreve os números do primeiro ao último, de um em um (ou do tamanho do passo dado).",
    opcoes: [
      ["-s TEXTO", "separa os números com o texto (padrão: uma linha por número)"],
      ["-w", "completa com zeros para todos terem a mesma largura"],
    ],
    exemplos: [["seq 1 2 9", "mostra 1 3 5 7 9, um por linha"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "sw", withValue: "s", numericOperands: true });
    if (rejectOptions("seq", parsed, context)) return 1;
    const operands = parsed.operands;
    if (operands.length === 0 || operands.length > 3) {
      context.falhar(operands.length === 0 ? msg.missingOperand("seq") : msg.extraOperand("seq", operands[3]!));
      context.falhar(msg.tryHelp("seq"));
      return 1;
    }
    const numbers: number[] = [];
    for (const operand of operands) {
      const value = parseNumber(operand);
      if (value === null) {
        context.falhar(msg.invalidFloat("seq", operand));
        context.falhar(msg.tryHelp("seq"));
        return 1;
      }
      numbers.push(value);
    }
    const first = operands.length === 1 ? 1 : numbers[0]!;
    const step = operands.length === 3 ? numbers[1]! : 1;
    const last = numbers[numbers.length - 1]!;
    if (step === 0) {
      context.falhar(msg.zeroIncrement("seq", operands[1]!));
      return 1;
    }
    const digits = Math.max(...operands.slice(0, operands.length === 1 ? 0 : operands.length === 3 ? 2 : 1).map(decimalsOf), operands.length === 3 ? decimalsOf(operands[1]!) : 0);
    const values: string[] = [];
    for (let i = 0, value = first; step > 0 ? value <= last + 1e-9 : value >= last - 1e-9; i++, value = first + i * step) {
      values.push(value.toFixed(digits));
      if (values.length > 100000) break;
    }
    const width = parsed.flags.has("w") ? Math.max(...values.map((v) => v.length), 0) : 0;
    const padded = values.map((value) => (width > 0 ? (value.startsWith("-") ? `-${value.slice(1).padStart(width - 1, "0")}` : value.padStart(width, "0")) : value));
    const separator = parsed.values.get("s");
    if (separator === undefined) for (const value of padded) context.linha(value);
    else if (padded.length > 0) context.linha(padded.join(unescapeDelimiter(separator)));
    return 0;
  },
);

const shuf = defineCommand(
  "shuf",
  "embaralha as linhas: shuf arquivo.txt",
  {
    uso: "shuf [-n QUANTAS] [-e ARGUMENTO...] [-i INÍCIO-FIM] [ARQUIVO]",
    descricao: "Escreve as linhas em ordem aleatória. É o único comando que dá uma resposta diferente a cada vez.",
    opcoes: [
      ["-n QUANTAS", "mostra no máximo essa quantidade de linhas"],
      ["-e", "trata os argumentos como as linhas a embaralhar"],
      ["-i INÍCIO-FIM", "embaralha os números do intervalo"],
    ],
    exemplos: [["shuf -n 1 frutas.txt", "sorteia uma linha do arquivo"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "nei", withValue: "ni" });
    if (rejectOptions("shuf", parsed, context)) return 1;
    let lines: string[];
    let failed = false;
    if (parsed.flags.has("e")) lines = parsed.operands;
    else if (parsed.values.has("i")) {
      const match = /^(\d+)-(\d+)$/.exec(parsed.values.get("i")!);
      if (!match) {
        context.falhar(msg.invalidRange("shuf", parsed.values.get("i")!));
        return 1;
      }
      lines = [];
      for (let value = Number(match[1]); value <= Number(match[2]); value++) lines.push(String(value));
    } else {
      const read = readInputs("shuf", parsed.operands.slice(0, 1), context);
      failed = read.failed;
      lines = read.inputs.flatMap((input) => linesOf(input.text));
    }
    for (let i = lines.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lines[i], lines[j]] = [lines[j]!, lines[i]!];
    }
    const count = parsed.values.has("n") ? Number(parsed.values.get("n")) : lines.length;
    for (const line of lines.slice(0, Number.isFinite(count) ? count : lines.length)) context.linha(line);
    return failed ? 1 : 0;
  },
);

class ExprError extends Error {}

/** Evaluates the words of expr: | & comparison + - * / % and length, substr, index, with parentheses. */
function evaluate(words: string[]): string {
  let position = 0;
  const peek = (): string | undefined => words[position];
  const isNumber = (value: string) => /^-?\d+$/.test(value);
  const truthy = (value: string) => value !== "" && value !== "0";
  const atom = (): string => {
    const word = words[position++];
    if (word === undefined) throw new ExprError(msg.exprSyntax);
    if (word === "(") {
      const value = or();
      if (words[position++] !== ")") throw new ExprError(msg.exprSyntax);
      return value;
    }
    if (word === "length") return String(Array.from(atom()).length);
    if (word === "substr") {
      const text = Array.from(atom());
      const from = Number(atom());
      const length = Number(atom());
      return text.slice(Math.max(0, from - 1), Math.max(0, from - 1) + Math.max(0, length)).join("");
    }
    if (word === "index") {
      const text = atom();
      const chars = atom();
      const found = Array.from(text).findIndex((char) => chars.includes(char));
      return String(found + 1);
    }
    return word;
  };
  const multiplicative = (): string => {
    let left = atom();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = words[position++]!;
      const right = atom();
      if (!isNumber(left) || !isNumber(right)) throw new ExprError(msg.exprNonInteger);
      if (operator !== "*" && Number(right) === 0) throw new ExprError(msg.exprDivisionByZero);
      const a = Number(left);
      const b = Number(right);
      left = String(operator === "*" ? a * b : operator === "/" ? Math.trunc(a / b) : a % b);
    }
    return left;
  };
  const additive = (): string => {
    let left = multiplicative();
    while (peek() === "+" || peek() === "-") {
      const operator = words[position++]!;
      const right = multiplicative();
      if (!isNumber(left) || !isNumber(right)) throw new ExprError(msg.exprNonInteger);
      left = String(operator === "+" ? Number(left) + Number(right) : Number(left) - Number(right));
    }
    return left;
  };
  const comparison = (): string => {
    let left = additive();
    while (["=", "==", "!=", "<", ">", "<=", ">="].includes(peek() ?? "")) {
      const operator = words[position++]!;
      const right = additive();
      const numeric = isNumber(left) && isNumber(right);
      const order = numeric ? Number(left) - Number(right) : left < right ? -1 : left > right ? 1 : 0;
      const result =
        operator === "=" || operator === "==" ? order === 0 : operator === "!=" ? order !== 0 : operator === "<" ? order < 0 : operator === ">" ? order > 0 : operator === "<=" ? order <= 0 : order >= 0;
      left = result ? "1" : "0";
    }
    return left;
  };
  const and = (): string => {
    let left = comparison();
    while (peek() === "&") {
      position++;
      const right = comparison();
      left = truthy(left) && truthy(right) ? left : "0";
    }
    return left;
  };
  const or = (): string => {
    let left = and();
    while (peek() === "|") {
      position++;
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const result = or();
  if (position < words.length) throw new ExprError(msg.exprSyntax);
  return result;
}

const expr = defineCommand(
  "expr",
  "faz contas e compara valores: expr 2 + 3",
  {
    uso: "expr EXPRESSÃO",
    descricao: "Calcula a expressão e escreve o resultado. Sai com 0 se o resultado não é zero nem vazio, 1 se é, e 2 se a expressão está errada.",
    opcoes: [
      ["+ - \\* / %", "soma, subtração, multiplicação, divisão e resto (escreva \\* para a multiplicação)"],
      ["= != < > <= >=", "comparações, que dão 1 ou 0"],
      ["length TEXTO", "quantidade de caracteres"],
      ["substr TEXTO POS TAM", "pedaço do texto"],
    ],
    exemplos: [["expr 7 % 3", "mostra 1"]],
  },
  (args, context) => {
    if (args.length === 0) {
      context.falhar(msg.exprMissing);
      context.falhar(msg.tryHelp("expr"));
      return 2;
    }
    try {
      const result = evaluate(args);
      context.linha(result);
      return result === "" || result === "0" ? 1 : 0;
    } catch (error) {
      if (!(error instanceof ExprError)) throw error;
      context.falhar(`expr: ${error.message}`);
      return 2;
    }
  },
);

const basename = defineCommand(
  "basename",
  "mostra só o nome do arquivo, sem a pasta: basename /etc/passwd",
  {
    uso: "basename NOME [SUFIXO]",
    descricao: "Tira a parte da pasta do caminho e, se pedido, o sufixo final.",
    opcoes: [
      ["-a", "aceita vários nomes"],
      ["-s SUFIXO", "tira o sufixo de cada nome (e liga o -a)"],
    ],
    exemplos: [["basename /tmp/lab/a.txt .txt", "mostra a"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "as", withValue: "s", long: { multiple: "a", suffix: "s" } });
    if (rejectOptions("basename", parsed, context)) return 1;
    const operands = parsed.operands;
    if (operands.length === 0) {
      context.falhar(msg.missingOperand("basename"));
      context.falhar(msg.tryHelp("basename"));
      return 1;
    }
    const multiple = parsed.flags.has("a") || parsed.flags.has("s");
    let suffix = parsed.values.get("s") ?? "";
    let names = operands;
    if (!multiple) {
      if (operands.length > 2) {
        context.falhar(msg.extraOperand("basename", operands[2]!));
        context.falhar(msg.tryHelp("basename"));
        return 1;
      }
      suffix = operands[1] ?? "";
      names = [operands[0]!];
    }
    for (const name of names) {
      const trimmed = trimSlashes(name);
      let base = trimmed === "/" ? "/" : trimmed.slice(trimmed.lastIndexOf("/") + 1);
      if (suffix !== "" && base !== suffix && base.endsWith(suffix)) base = base.slice(0, -suffix.length);
      context.linha(base);
    }
    return 0;
  },
);

const dirname = defineCommand(
  "dirname",
  "mostra só a pasta de um caminho: dirname /etc/passwd",
  {
    uso: "dirname CAMINHO...",
    descricao: "Tira o último componente do caminho e mostra a pasta que sobra (ou . se não houver).",
    exemplos: [["dirname /tmp/lab/a.txt", "mostra /tmp/lab"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "" });
    if (rejectOptions("dirname", parsed, context)) return 1;
    if (parsed.operands.length === 0) {
      context.falhar(msg.missingOperand("dirname"));
      context.falhar(msg.tryHelp("dirname"));
      return 1;
    }
    for (const path of parsed.operands) {
      const trimmed = trimSlashes(path);
      const slash = trimmed.lastIndexOf("/");
      if (slash === -1) context.linha(".");
      else context.linha(trimSlashes(trimmed.slice(0, slash)) === "" ? "/" : trimSlashes(trimmed.slice(0, slash)));
    }
    return 0;
  },
);

function describeFile(node: EngineNode, text: string): string {
  if (node.ehDiretorio()) return "directory";
  if (node.alvo !== undefined) return `symbolic link to ${node.alvo}`;
  if (node.letra !== undefined) return node.letra === "b" ? "block special" : "character special";
  if (node.formato === "tar.gz" || node.formato === "gz") return "gzip compressed data";
  if (node.formato === "zip") return "Zip archive data";
  if (node.formato === "tar") return "POSIX tar archive";
  return describeText(text, (node.modo & 0o111) !== 0);
}

/** What a text is: all that is known of the standard input, and what is left to say of a file once the node told what it is. */
function describeText(text: string, executable: boolean): string {
  if (text === "") return "empty";
  const ascii = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(text);
  const kind = ascii ? "ASCII text" : "Unicode text, UTF-8 text";
  if (text.startsWith("#!")) {
    const words = (text.split("\n")[0] ?? "").slice(2).trim().split(/\s+/);
    const program = (words[0] ?? "").slice((words[0] ?? "").lastIndexOf("/") + 1);
    const interpreter = program === "env" ? (words[1] ?? "sh") : program || "sh";
    const label = interpreter === "bash" ? "Bourne-Again shell script" : interpreter === "python3" || interpreter === "python" ? "Python script" : "POSIX shell script";
    return `${label}, ${kind}${executable ? " executable" : ""}`;
  }
  return kind;
}

const file = defineCommand(
  "file",
  "descobre o tipo de um arquivo: file arquivo",
  {
    uso: "file [-b] ARQUIVO...",
    descricao: "Diz que tipo de conteúdo o arquivo tem: texto, script, pasta, link, arquivo compactado ou dados. A resposta vem em inglês, como no Ubuntu.",
    opcoes: [["-b", "mostra só o tipo, sem o nome do arquivo"]],
    exemplos: [["file script.sh", "mostra, por exemplo, Bourne-Again shell script"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "b" });
    if (rejectOptions("file", parsed, context)) return 1;
    if (parsed.operands.length === 0) {
      context.falhar(msg.fileUsage);
      return 1;
    }
    for (const path of parsed.operands) {
      if (path === "-") {
        const kind = describeText(context.entrada ?? "", false);
        context.linha(parsed.flags.has("b") ? kind : `/dev/stdin: ${kind}`);
        continue;
      }
      const label = (text: string) => (parsed.flags.has("b") ? text : `${path}: ${text}`);
      try {
        const node = context.localizarSemSeguir(path);
        let text = "";
        try {
          text = node.ehDiretorio() || node.alvo !== undefined ? "" : (node.ler?.() ?? "");
        } catch {
          text = "";
        }
        context.linha(label(describeFile(node, text)));
      } catch (error) {
        context.linha(label(msg.cannotOpen(path, messageOf(error))));
      }
    }
    return 0;
  },
);

export const textCommands: EngineCommand[] = [tac, paste, diff, nl, rev, xxd, base64, ...sumCommands, seq, shuf, expr, basename, dirname, file];

