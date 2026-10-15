import { messages } from "./messages";
import { printsOnTerminal } from "./output";
import { niceOfLine, processLines, programOf, type ProcessLine } from "./ps";
import type { EngineCommand, EngineContext } from "./types";

/** The PR of `top` is 20 plus the nice, unlike the PRI of `ps -l`, which is 80 plus it. */
const priorityOf = (line: ProcessLine) => 20 + niceOfLine(line);

const clock = (date: Date) => date.toTimeString().slice(0, 8);

/** One screen of `top`: the summary, with the tasks counted by state, and the table with the processes that use the most memory first. */
function screen(context: EngineContext, lines: ProcessLine[], full: boolean): string[] {
  const count = (state: string) => lines.filter((l) => l.estado.charAt(0) === state).length;
  const stopped = count("T");
  const zombie = count("Z");
  const running = Math.max(1, count("R"));
  const total = lines.length + 90; // the machine has more tasks than the ones the engine lists, as the snapshot of the engine always said
  const users = new Set(context.maquina.usuariosNasConexoes?.() ?? []).size;
  const rows = lines
    .slice()
    .sort((a, b) => b.mem - a.mem)
    .map((l) => {
      const virt = String(12000 + ((l.pid * 13) % 90000)).padStart(7);
      const res = String(4000 + (l.pid % 9000)).padStart(6);
      const shr = String(3000 + (l.pid % 5000)).padStart(6);
      return `${String(l.pid).padStart(7)} ${l.usuario.padEnd(8).substring(0, 8)}${String(priorityOf(l)).padStart(4)}${String(niceOfLine(l)).padStart(4)} ${virt} ${res} ${shr} ${l.estado.charAt(0)}   ${l.cpu.toFixed(1).padStart(4)}  ${l.mem.toFixed(1).padStart(4)}    0:00.${String(l.pid % 100).padStart(2, "0")} ${full ? l.comando.replace(/^-/, "") : programOf(l.comando)}`;
    });
  return [
    `top - ${clock(new Date())} up  1:27,  ${users} users,  load average: 0,08, 0,03, 0,01`,
    `Tarefas: ${total} total,   ${running} executando, ${total - running - stopped - zombie} dormindo,   ${stopped} parado,   ${zombie} zumbi`,
    "%CPU(s):  1,3 us,  0,7 sis,  0,0 ni, 97,9 oc,  0,1 ag,  0,0 ih,  0,0 is,  0,0 tr",
    "MiB Mem :   3921,5 total,   1940,8 livre,   1128,4 usados,   1055,6 buff/cache",
    "MiB Swap:   2048,0 total,   2048,0 livre,      0,0 usados.   2776,5 mem dispon.",
    "",
    "    PID USUARIO   PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TEMPO+ COMANDO",
    ...rows,
  ];
}

/**
 * top, alive (SPEC-029 entrega A): the engine only took a photo; this one takes it again every 3 seconds until Ctrl+C, with the PR and the NI of
 * each process, so the student sees the effect of `kill`, `renice` and `nice` from another terminal. In a pipe or a file, or with -b, it writes the
 * screens one after the other. The keys of the real top (k, r, q) are not there: the engine reads a line, not a key.
 */
export function makeTop(original: EngineCommand): EngineCommand {
  return {
    nome: "top",
    resumo: "monitor de processos ao vivo (CPU, memória, carga); Ctrl+C para sair",
    embutido: original.embutido,
    ajuda: {
      uso: "top [-b] [-c] [-n ITERAÇÕES] [-d SEGUNDOS]",
      descricao:
        "Mostra um resumo do sistema e os processos que mais usam memória, com a prioridade (PR) e o nice (NI) de cada um, e se atualiza sozinho até Ctrl+C. Num pipe ou arquivo mostra uma tela só. Aqui as teclas do top de verdade (k, r, q) não existem: para matar ou mudar a prioridade use kill e renice em outro terminal e veja o efeito.",
      opcoes: [
        ["-b", "modo em lote: escreve as telas uma depois da outra, sem limpar o terminal"],
        ["-c", "mostra a linha de comando inteira de cada processo, e não só o nome do programa"],
        ["-d SEGUNDOS", "intervalo entre as telas (padrão 3; mínimo 0,1)"],
        ["-n ITERAÇÕES", "mostra esse número de telas e termina"],
      ],
      exemplos: [
        ["top", "acompanha os processos ao vivo (Ctrl+C sai)"],
        ["top -b -n 1", "mostra uma tela e termina"],
        ["top -d 1", "atualiza a cada segundo"],
      ],
    },
    async executar(args: string[], context: EngineContext): Promise<number> {
      let batch = false;
      let full = false;
      let iterations = Infinity;
      let delay = 3;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "-b") batch = true;
        else if (arg === "-c") full = true;
        else if (arg === "-n" || arg === "-d") {
          const value = args[++i];
          if (value === undefined) {
            context.falhar(messages.top.missingArgument(arg.slice(1)));
            return 1;
          }
          const number = Number(value.replace(",", "."));
          if (arg === "-n") {
            if (!Number.isInteger(number) || number < 1) {
              context.falhar(messages.top.invalidIterations(value));
              return 1;
            }
            iterations = number;
          } else {
            if (!Number.isFinite(number) || number < 0) {
              context.falhar(messages.top.invalidDelay(value));
              return 1;
            }
            delay = Math.max(0.1, number);
          }
        } else {
          context.falhar(messages.top.invalidOption(arg.replace(/^-+/, "").charAt(0) || arg));
          return 1;
        }
      }
      const live = printsOnTerminal(context) && !batch;
      if (!printsOnTerminal(context) && iterations === Infinity) iterations = 1;
      if (batch && iterations === Infinity) iterations = 1;
      let shown = 0;
      do {
        if (live) context.interacao.limparTela();
        for (const text of screen(context, processLines(context.maquina), full)) context.linha(text);
        if (live) context.linha(messages.top.howToLeave, "c-info");
        else context.linha();
        shown++;
      } while (shown < iterations && (await context.dormir(delay * 1000)));
      return 0;
    },
  };
}
