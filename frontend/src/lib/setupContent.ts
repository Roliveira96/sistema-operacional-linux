// Helpers for what an author types while recording a snapshot (SPEC-021).

const OPTION = String.raw`(?:-\S+\s+)*`;
const EDITOR = new RegExp(String.raw`^\s*(?:nano|vim|vi|pico)\s+${OPTION}(\S+)\s*$`);
const TEE = new RegExp(String.raw`^\s*tee\s+${OPTION}(\S+)\s*$`);
const CAT = /^\s*cat\s*>\s*(\S+)\s*$/;

/**
 * The file an editor-like command writes (`nano`, `vim`, `vi`, `tee`, `cat >`), or undefined for any other command.
 * What is typed inside them is not a command: the text reaches the snapshot as the file it ends up in.
 */
export function writtenFile(command: string): string | undefined {
  return (EDITOR.exec(command) ?? TEE.exec(command) ?? CAT.exec(command))?.[1];
}

/** Shell single quotes around a text. */
export const shellQuote = (text: string) => `'${text.replace(/'/g, String.raw`'\''`)}'`;
