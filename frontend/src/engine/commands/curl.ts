import { msg } from "./messages";
import type { EngineCommand } from "./types";

/** Wraps the curl of the engine: it answers --version and -V, and hands every other call to the original (RN-03). */
export function withVersion(original: EngineCommand): EngineCommand {
  return {
    nome: original.nome,
    resumo: original.resumo,
    embutido: original.embutido,
    ajuda: original.ajuda,
    executar: async (args, context) => {
      if (args[0] === "--version" || args[0] === "-V") {
        for (const line of msg.curlVersion) context.linha(line);
        return 0;
      }
      return original.executar(args, context);
    },
  };
}
