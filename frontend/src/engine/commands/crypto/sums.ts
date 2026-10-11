import { defineCommand, linesOf, messageOf, parseOptions, readInputs, rejectOptions } from "../helpers";
import { msg } from "../messages";
import type { EngineCommand, EngineContext } from "../types";
import { fileBytes } from "./bytes";
import { digestHex, type HashName } from "./hashing";

const SUMMARY = {
  md5: "soma MD5 de um arquivo: md5sum arquivo",
  sha1: "soma SHA-1 de um arquivo (não serve para segurança): sha1sum arquivo",
  sha224: "soma SHA-224 de um arquivo: sha224sum arquivo",
  sha256: "soma SHA-256 de um arquivo: sha256sum arquivo",
  sha384: "soma SHA-384 de um arquivo: sha384sum arquivo",
  sha512: "soma SHA-512 de um arquivo: sha512sum arquivo",
} satisfies Record<HashName, string>;

async function checkSums(name: string, algorithm: HashName, lists: string[], ignoreMissing: boolean, context: EngineContext): Promise<number> {
  const { inputs, failed } = readInputs(name, lists, context);
  let mismatches = 0;
  let unreadable = 0;
  let checked = 0;
  for (const input of inputs) {
    for (const line of linesOf(input.text)) {
      const match = /^([0-9a-fA-F]+) [ *](.+)$/.exec(line);
      if (!match) continue;
      const [, expected, path] = match as unknown as [string, string, string];
      try {
        const node = context.localizar(path);
        checked++;
        if ((await digestHex(algorithm, fileBytes(node.ler?.() ?? ""))) === expected.toLowerCase()) context.linha(`${path}: OK`);
        else {
          context.linha(`${path}: ${msg.failedCheck}`);
          mismatches++;
        }
      } catch (error) {
        if (ignoreMissing) continue;
        context.falhar(msg.fileError(name, path, messageOf(error)));
        context.linha(`${path}: ${msg.failedToRead}`);
        unreadable++;
      }
    }
  }
  if (checked === 0 && unreadable === 0 && !failed) context.falhar(msg.noFileVerified(name));
  if (unreadable > 0) context.falhar(msg.unreadableFiles(name, unreadable));
  if (mismatches > 0) context.falhar(msg.mismatchedSums(name, mismatches));
  return failed || mismatches > 0 || unreadable > 0 || checked === 0 ? 1 : 0;
}

function sumCommand(name: string, algorithm: HashName): EngineCommand {
  const weak = algorithm === "md5" || algorithm === "sha1";
  return defineCommand(
    name,
    SUMMARY[algorithm],
    {
      uso: `${name} [-c] [ARQUIVO]...`,
      descricao: `Calcula a soma de verificação do conteúdo de cada arquivo. Com -c, confere as somas listadas em um arquivo.${weak ? " Este resumo está quebrado: serve para conferir arquivos, não para segurança." : ""}`,
      opcoes: [
        ["-c, --check", "lê as somas de um arquivo e confere se os arquivos ainda batem"],
        ["--ignore-missing", "com -c, não reclama dos arquivos que não existem"],
      ],
      exemplos: [
        [`${name} a.txt`, "mostra a soma e o nome do arquivo"],
        [`${name} -c SOMAS.txt`, "confere uma lista de somas publicada"],
      ],
    },
    async (args, context) => {
      const parsed = parseOptions(args, { known: "c", long: { check: "c" }, knownLong: ["ignore-missing"] });
      if (rejectOptions(name, parsed, context)) return 1;
      if (parsed.flags.has("c")) return checkSums(name, algorithm, parsed.operands, parsed.flags.has("--ignore-missing"), context);
      const { inputs, failed } = readInputs(name, parsed.operands, context);
      for (const input of inputs) context.linha(`${await digestHex(algorithm, fileBytes(input.text))}  ${input.name ?? "-"}`);
      return failed ? 1 : 0;
    },
  );
}

export const sumCommands: EngineCommand[] = [sumCommand("md5sum", "md5"), sumCommand("sha1sum", "sha1"), sumCommand("sha224sum", "sha224"), sumCommand("sha256sum", "sha256"), sumCommand("sha384sum", "sha384"), sumCommand("sha512sum", "sha512")];
