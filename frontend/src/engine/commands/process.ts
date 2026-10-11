import { decimal, defineCommand } from "./helpers";
import type { EngineCommand } from "./types";

const clock = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

const formatElapsed = (milliseconds: number): string => {
  const seconds = milliseconds / 1000;
  return `${Math.floor(seconds / 60)}m${decimal(seconds % 60, 3)}s`;
};

const time = defineCommand(
  "time",
  "mede quanto tempo um comando demora: time ls",
  {
    uso: "time COMANDO [ARGUMENTO]...",
    descricao: "Executa o comando e, no fim, mostra quanto tempo ele levou (real) e quanto foi de processador (user e sys).",
    soPrimeiro: true,
    exemplos: [["time sleep 1", "mostra que levou cerca de 1 segundo"]],
  },
  async (args, context) => {
    const started = clock();
    const status = args.length === 0 ? 0 : await context.executor.executarArgs(args, context);
    const elapsed = args.length === 0 ? 0 : clock() - started;
    context.falhar("");
    context.falhar(`real\t${formatElapsed(elapsed)}`);
    context.falhar(`user\t${formatElapsed(0)}`);
    context.falhar(`sys\t${formatElapsed(0)}`);
    return status;
  },
);

export const processCommands: EngineCommand[] = [time];
