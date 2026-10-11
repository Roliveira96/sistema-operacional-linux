import { writeFile, messageOf } from "../helpers";
import type { EngineContext } from "../types";
import { fileBytes, textFromBytes } from "./bytes";

// Reading and writing the files of the cryptography commands, and the options in the style of openssl (-in, -out, -sha256).

export interface OpenSslOptions {
  values: Map<string, string[]>;
  flags: Set<string>;
  positional: string[];
  unknown: string | null;
}

/** Reads the arguments: `valued` options take the next argument, `flags` do not; anything else with a dash is unknown. */
export function openOptions(args: string[], valued: string[], flags: string[]): OpenSslOptions {
  const result: OpenSslOptions = { values: new Map(), flags: new Set(), positional: [], unknown: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("-") || arg === "-") {
      result.positional.push(arg);
      continue;
    }
    const name = arg.slice(1);
    if (valued.includes(name)) {
      const value = args[++i];
      if (value === undefined) result.unknown ??= arg;
      else result.values.set(name, [...(result.values.get(name) ?? []), value]);
    } else if (flags.includes(name)) result.flags.add(name);
    else result.unknown ??= arg;
  }
  return result;
}

export const first = (options: OpenSslOptions, name: string): string | undefined => options.values.get(name)?.[0];

/** The bytes of a file of the machine, or of the standard input when no path was given. Prints the error and gives null. */
export function readBytes(context: EngineContext, command: string, path: string | undefined): Uint8Array | null {
  if (path === undefined) return fileBytes(context.entrada ?? "");
  try {
    const node = context.localizar(path);
    if (node.ehDiretorio()) {
      context.falhar(`${command}: ${path}: É um diretório`);
      return null;
    }
    return fileBytes(node.ler?.() ?? "");
  } catch (error) {
    context.falhar(`${command}: não foi possível abrir '${path}': ${messageOf(error)}`);
    return null;
  }
}

export function readText(context: EngineContext, command: string, path: string | undefined): string | null {
  const bytes = readBytes(context, command, path);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/** Writes bytes to the file, or to the screen when there is no path. Gives false (after printing the error) when it could not. */
export function writeBytes(context: EngineContext, command: string, path: string | undefined, content: Uint8Array | string, mode = 0o644): boolean {
  const text = typeof content === "string" ? content : textFromBytes(content);
  if (path === undefined) {
    context.escrever(text);
    return true;
  }
  const failure = writeFile(context, path, text, mode);
  if (failure !== null) {
    context.falhar(`${command}: não foi possível gravar '${path}': ${failure}`);
    return false;
  }
  return true;
}

/** The password of -pass pass:X, file:F, env:V or stdin, or of -k. Null when none was given. */
export function passwordFromOption(context: EngineContext, command: string, spec: string | undefined): { password: string | null; failed: boolean } {
  if (spec === undefined) return { password: null, failed: false };
  if (spec.startsWith("pass:")) return { password: spec.slice(5), failed: false };
  if (spec === "stdin") return { password: (context.entrada ?? "").split("\n")[0] ?? "", failed: false };
  if (spec.startsWith("env:")) return { password: null, failed: true };
  if (spec.startsWith("file:")) {
    const text = readText(context, command, spec.slice(5));
    return text === null ? { password: null, failed: true } : { password: text.split("\n")[0] ?? "", failed: false };
  }
  context.falhar(`${command}: argumento de senha inválido: '${spec}' (use pass:SENHA, file:ARQUIVO ou stdin)`);
  return { password: null, failed: true };
}

export const mode600 = 0o600;
