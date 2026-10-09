// What an author types inside an editor while recording a snapshot is not a command, so it would be lost
// when the snapshot is replayed. These helpers turn a session of `nano`, `vim`, `vi` or `tee` into the
// `printf` commands that write the same text to the same file (SPEC-021).

import type { SetupStep } from "./setup";

/** The longest command a snapshot step can hold is 500; chunks stay well below it. */
const CHUNK = 400;

const OPTION = String.raw`(?:-\S+\s+)*`;
const EDITOR = new RegExp(String.raw`^\s*(?:nano|vim|vi|pico)\s+${OPTION}(\S+)\s*$`);
const TEE = new RegExp(String.raw`^\s*tee\s+${OPTION}(\S+)\s*$`);
const CAT = /^\s*cat\s*>\s*(\S+)\s*$/;

/** The file an editor-like command writes, or undefined when the command is something else. */
export function writtenFile(command: string): string | undefined {
  return (EDITOR.exec(command) ?? TEE.exec(command) ?? CAT.exec(command))?.[1];
}

/** Shell single quotes around a text. */
export const shellQuote = (text: string) => `'${text.replace(/'/g, String.raw`'\''`)}'`;

/** The commands that write `text` to `path`: a `printf` per chunk of lines, the first one creating the file. */
export function printfSteps(path: string, text: string): SetupStep[] {
  if (text === "") return [{ command: `touch ${shellQuote(path)}` }];
  const steps: SetupStep[] = [];
  let lines: string[] = [];
  let size = 0;
  const flush = () => {
    if (lines.length === 0) return;
    const arguments_ = lines.map(shellQuote).join(" ");
    steps.push({ command: `printf '%s\\n' ${arguments_} ${steps.length === 0 ? ">" : ">>"} ${shellQuote(path)}` });
    lines = [];
    size = 0;
  };
  for (const line of text.split("\n")) {
    if (size + line.length > CHUNK) flush();
    lines.push(line);
    size += line.length + 3;
  }
  flush();
  return steps;
}

/** A text the `printf` above reproduces exactly: the engine reads a backslash in an argument as an escape. */
export const isPlainText = (text: string) => !text.includes("\\");
