import { messages } from "./messages";
import { printsOnTerminal, printsToNothing } from "./output";
import type { EngineCommand, EngineContext } from "./types";

/** In a pipe or a file the output is collected before anyone reads it, so a command that never ends stops after this many lines. */
const PIPE_LINE_LIMIT = 10_000;

/** On the terminal, lines per beat: a flood the page can follow, since the real yes prints faster than any screen shows. */
const LINES_PER_BEAT = 10;
const BEAT_MS = 100;

/** yes: repeats a line until it is interrupted (Ctrl+C) or killed from another terminal. */
export const yesCommand: EngineCommand = {
  nome: "yes",
  resumo: "repete uma linha sem parar (yes, yes texto); Ctrl+C para",
  ajuda: {
    uso: "yes [TEXTO]...",
    descricao: "Imprime o texto (ou y) várias vezes por segundo, sem parar. Termina com Ctrl+C, ou quando outro terminal o encerra com kill. Num pipe ou arquivo, para depois de 10000 linhas; em /dev/null continua vivo até ser encerrado.",
    exemplos: [
      ["yes", "imprime y sem parar"],
      ["yes ola | head -n 3", "imprime ola três vezes"],
      ["yes > /dev/null &", "roda em segundo plano, sem mostrar nada (encerre com kill)"],
    ],
  },
  async executar(args: string[], context: EngineContext): Promise<number> {
    const line = args.length > 0 ? args.join(" ") : "y";
    if (printsToNothing(context)) {
      // Nothing is kept: it only stays alive, writing, until it is ended.
      while (await context.dormir(BEAT_MS)) context.linha(line);
      return 130;
    }
    if (!printsOnTerminal(context)) {
      for (let i = 0; i < PIPE_LINE_LIMIT; i++) context.linha(line);
      return 0;
    }
    while (!context.interrompido()) {
      for (let i = 0; i < LINES_PER_BEAT; i++) context.linha(line);
      if (!(await context.dormir(BEAT_MS))) break;
    }
    return 130;
  },
};

const formatTime = (date: Date) => date.toLocaleString("pt-BR", { weekday: "short", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", year: "numeric" }).replace(/,/g, "");

/** watch: runs a command again and again, clearing the screen between the runs, until Ctrl+C. */
export const watchCommand: EngineCommand = {
  nome: "watch",
  resumo: "repete um comando a cada 2 segundos (watch -n 1 date); Ctrl+C para",
  ajuda: {
    uso: "watch [-n SEGUNDOS] [-t] COMANDO [ARGUMENTO]...",
    descricao: "Executa o comando de tempos em tempos e mostra a saída na tela limpa, para acompanhar o que muda. Termina com Ctrl+C. Num pipe ou arquivo, executa só uma vez.",
    opcoes: [
      ["-n, --interval SEGUNDOS", "intervalo entre as execuções (padrão 2; mínimo 0,1)"],
      ["-t, --no-title", "não mostra o cabeçalho"],
    ],
    exemplos: [
      ["watch date", "mostra a data, atualizando a cada 2 segundos"],
      ["watch -n 1 ls /tmp", "acompanha o conteúdo de /tmp a cada segundo"],
      ["watch -n 5 'ps aux | wc -l'", "conta os processos a cada 5 segundos"],
    ],
    soPrimeiro: true,
  },
  async executar(args: string[], context: EngineContext): Promise<number> {
    let interval = 2;
    let title = true;
    let rest = [...args];
    while (rest.length > 0) {
      const arg = rest[0]!;
      if (arg === "-t" || arg === "--no-title") {
        title = false;
        rest = rest.slice(1);
      } else if (arg === "-n" || arg === "--interval") {
        const value = rest[1] ?? "";
        const parsed = Number(value.replace(",", "."));
        if (!Number.isFinite(parsed) || value === "") {
          context.falhar(messages.watch.invalidInterval(value));
          return 1;
        }
        interval = Math.max(0.1, parsed);
        rest = rest.slice(2);
      } else if (arg.startsWith("--interval=")) {
        const value = arg.slice("--interval=".length);
        const parsed = Number(value.replace(",", "."));
        if (!Number.isFinite(parsed)) {
          context.falhar(messages.watch.invalidInterval(value));
          return 1;
        }
        interval = Math.max(0.1, parsed);
        rest = rest.slice(1);
      } else {
        break;
      }
    }
    if (rest.length === 0) {
      context.falhar(messages.watch.missingCommand);
      return 1;
    }
    const text = rest.join(" ");
    const onTerminal = printsOnTerminal(context);

    do {
      if (onTerminal) context.interacao.limparTela();
      if (title) {
        const left = messages.watch.header(interval, text);
        const right = `${context.maquina.hostname}: ${formatTime(new Date())}`;
        context.linha(left + " ".repeat(Math.max(2, 80 - left.length - right.length)) + right);
        context.linha();
      }
      await context.executor.executarTexto(text, context);
    } while (onTerminal && (await context.dormir(interval * 1000)));
    return 0;
  },
};
