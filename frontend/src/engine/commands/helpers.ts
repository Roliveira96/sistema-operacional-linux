import { msg } from "./messages";
import type { EngineCommand, EngineContext, EngineHelp, EngineNode, EngineProcess, Output } from "./types";

/** Builds an engine command from its name, one-line summary, help and body. */
export function defineCommand(
  name: string,
  summary: string,
  help: EngineHelp,
  run: (args: string[], context: EngineContext) => Promise<number> | number,
): EngineCommand {
  return {
    nome: name,
    resumo: summary,
    ajuda: help,
    executar: async (args, context) => run(args, context),
  };
}

export interface ParsedOptions {
  flags: Set<string>;
  values: Map<string, string>;
  operands: string[];
  /** Options the command does not know, as typed ("-z" or "--zzz"). */
  unknown: string[];
  /** The option that needed a value and had none. */
  missingValue: string | null;
}

export interface ParseConfig {
  /** Short options that take a value ("n" for -n 5 and -n5). */
  withValue?: string;
  /** Long option name to the short letter it stands for ("max-depth" to "d"). */
  long?: Record<string, string>;
  /** Every short option the command accepts; a letter outside it is unknown. */
  known: string;
  /** Long options with no short form, accepted as flags ("apparent-size"). */
  knownLong?: string[];
  /** Treat "-5" and "-.5" as operands (seq, expr). */
  numericOperands?: boolean;
}

/** getopt-like reading of the arguments: "-la" is l plus a, "-n 5" and "-n5" give n its value, "--" ends the options. */
export function parseOptions(args: string[], config: ParseConfig): ParsedOptions {
  const result: ParsedOptions = { flags: new Set(), values: new Map(), operands: [], unknown: [], missingValue: null };
  const withValue = config.withValue ?? "";
  const long = config.long ?? {};
  const knownLong = config.knownLong ?? [];
  let ended = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (ended || arg === "-" || !arg.startsWith("-") || (config.numericOperands && /^-[\d.]/.test(arg))) {
      result.operands.push(arg);
      continue;
    }
    if (arg === "--") {
      ended = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const short = long[name];
      if (short !== undefined) {
        result.flags.add(short);
        if (withValue.includes(short)) {
          const value = inline ?? args[++i];
          if (value === undefined) result.missingValue = `--${name}`;
          else result.values.set(short, value);
        }
      } else if (knownLong.includes(name)) {
        result.flags.add(`--${name}`);
        if (inline !== undefined) result.values.set(`--${name}`, inline);
      } else {
        result.unknown.push(arg);
      }
      continue;
    }
    for (let j = 1; j < arg.length; j++) {
      const letter = arg.charAt(j);
      if (!config.known.includes(letter)) {
        result.unknown.push(`-${letter}`);
        continue;
      }
      result.flags.add(letter);
      if (withValue.includes(letter)) {
        const rest = arg.slice(j + 1);
        const value = rest !== "" ? rest : args[++i];
        if (value === undefined) result.missingValue = `-${letter}`;
        else result.values.set(letter, value);
        break;
      }
    }
  }
  return result;
}

/** Prints the error of an unknown option or a missing value, as the commands of Ubuntu do. Returns true when it did. */
export function rejectOptions(name: string, parsed: ParsedOptions, context: EngineContext): boolean {
  const unknown = parsed.unknown[0];
  if (unknown !== undefined) {
    context.falhar(unknown.startsWith("--") ? msg.unrecognizedOption(name, unknown) : msg.invalidOption(name, unknown.slice(1)));
    context.falhar(msg.tryHelp(name));
    return true;
  }
  if (parsed.missingValue !== null) {
    context.falhar(msg.optionNeedsValue(name, parsed.missingValue));
    context.falhar(msg.tryHelp(name));
    return true;
  }
  return false;
}

/** The text of an error thrown by the engine (its messages are already in Portuguese). */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isDirectory(node: EngineNode): boolean {
  return node.ehDiretorio();
}

export interface Input {
  /** The path as typed, or null for the standard input. */
  name: string | null;
  text: string;
}

/** Reads the files named in the arguments, or the standard input when there are none ("-" also means the input). */
export function readInputs(command: string, files: string[], context: EngineContext): { inputs: Input[]; failed: boolean } {
  if (files.length === 0) return { inputs: [{ name: null, text: context.entrada ?? "" }], failed: false };
  const inputs: Input[] = [];
  let failed = false;
  for (const path of files) {
    if (path === "-") {
      inputs.push({ name: null, text: context.entrada ?? "" });
      continue;
    }
    try {
      const node = context.localizar(path);
      if (node.ehDiretorio()) {
        context.falhar(msg.isDirectory(command, path));
        failed = true;
        continue;
      }
      inputs.push({ name: path, text: node.ler ? node.ler() : "" });
    } catch (error) {
      context.falhar(msg.fileError(command, path, messageOf(error)));
      failed = true;
    }
  }
  return { inputs, failed };
}

/** "a\nb\n" is ["a", "b"] (no empty last line). */
export function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A sink that drops what is written to it, to run a command without showing its output. */
export const silent: Output = { escrever: () => {} };

/** Runs a command line silently and gives its exit status. */
export async function statusOf(line: string, context: EngineContext): Promise<number> {
  return context.executor.executarTexto(line, context.com({ saida: silent, erro: silent }));
}

/** Runs a command line and gives what it printed. */
export async function outputOf(line: string, context: EngineContext): Promise<{ status: number; text: string }> {
  let text = "";
  const collector: Output = { escrever: (chunk) => void (text += chunk) };
  const status = await context.executor.executarTexto(line, context.com({ saida: collector, erro: silent }));
  return { status, text };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromBytes(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** The absolute path of a path typed in the current folder, with "." and ".." resolved. */
export function absolutePath(path: string, cwd: string): string {
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Writes text to a file path of the machine, creating the file (and its folder) when missing. Returns an error text or null. */
export function writeFile(context: EngineContext, path: string, text: string, mode = 0o644): string | null {
  const absolute = absolutePath(path, context.quadro.cwd);
  try {
    const existing = context.tentarLocalizar(absolute);
    if (existing) {
      if (existing.ehDiretorio()) return msg.isDirectoryShort;
      existing.escrever?.(text);
      return null;
    }
    const folder = absolute.slice(0, absolute.lastIndexOf("/")) || "/";
    const parent = context.tentarLocalizar(folder);
    if (!parent || !parent.ehDiretorio()) return msg.noSuchFile;
    context.maquina.criarArquivo(absolute, text, context.credencial.uid, context.credencial.gids[0] ?? 0, mode);
    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/** Decimal number in the Brazilian format (comma). */
export function decimal(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

/** The processes of the machine, read from `ps -ef` so the system ones are there too (the ps itself is left out). */
export async function listProcesses(context: EngineContext): Promise<EngineProcess[]> {
  const { text } = await outputOf("ps -ef", context);
  const processes: EngineProcess[] = [];
  for (const line of linesOf(text).slice(1)) {
    const match = /^\S+\s+(\d+)\s+(\d+)\s+\d+\s+\S+\s+\S+\s+\S+\s+(.*)$/.exec(line);
    if (match && match[3] !== "ps -ef") processes.push({ pid: Number(match[1]), ppid: Number(match[2]), comando: match[3]!.trim() });
  }
  return processes;
}
