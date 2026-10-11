import { messages } from "./messages";
import { defaultAction, signalName, signalNumber, signalTable } from "./signals";
import type { EngineCommand, EngineContext } from "./types";

/** The signals the engine already delivers by itself; everything about them is left to its own kill. */
const KNOWN_TO_THE_ENGINE = new Set([0, 1, 2, 3, 9, 15, 18, 19, 20]);

/** `kill -l`: the table, or the name of each signal given by number and the number of each given by name. */
function list(args: string[], context: EngineContext): number {
  if (args.length === 0) {
    for (const row of signalTable()) context.linha(row);
    return 0;
  }
  let status = 0;
  for (const arg of args) {
    // A status above 128 is a signal that ended a process: 137 is 128 + 9.
    const asNumber = /^\d+$/.test(arg) ? (Number(arg) > 128 ? Number(arg) - 128 : Number(arg)) : null;
    if (asNumber !== null) {
      const name = signalName(asNumber);
      if (name === null) {
        context.falhar(messages.kill.invalidSpec(arg));
        status = 1;
      } else {
        context.linha(name);
      }
      continue;
    }
    const number = signalNumber(arg);
    if (number === null || number === 0) {
      context.falhar(messages.kill.invalidSpec(arg));
      status = 1;
    } else {
      context.linha(String(number));
    }
  }
  return status;
}

/** Reads the signal asked for: `-s NAME`, `-n NUMBER` or `-NAME`/`-NUMBER`. `rest` are the targets; `bad` is what was not a signal. */
function parseSignal(args: string[]): { signal: number | null; rest: string[]; bad?: string } {
  const first = args[0] ?? "";
  if ((first === "-s" || first === "-n") && args[1] !== undefined) {
    const signal = signalNumber(args[1]);
    return signal === null ? { signal: null, rest: args.slice(2), bad: args[1] } : { signal, rest: args.slice(2) };
  }
  if (/^-[A-Za-z0-9]/.test(first) && first !== "-l" && first !== "-L") {
    const signal = signalNumber(first.slice(1));
    return signal === null ? { signal: null, rest: args.slice(1), bad: first.slice(1) } : { signal, rest: args.slice(1) };
  }
  return { signal: null, rest: args };
}

/**
 * kill, complete: `kill -l` with the 64 signals, and every signal by name or number. The engine's own kill keeps what it already does
 * (the eight signals it delivers, jobs, services); the ones it does not know are delivered here to the processes of the user.
 */
export function makeKill(original: EngineCommand): EngineCommand {
  return {
    nome: "kill",
    resumo: original.resumo,
    embutido: original.embutido,
    ajuda: {
      ...(original.ajuda ?? { uso: "kill", descricao: original.resumo }),
      uso: "kill [-s SINAL | -n NÚMERO | -SINAL] PID|%JOB...",
      descricao: "Envia um sinal a um processo ou job. Sem indicar o sinal, envia o 15 (TERM), que pede educadamente para encerrar. Os sinais de 1 a 31 e de 34 a 64 existem (kill -l lista).",
      opcoes: [
        ["-s SINAL", "envia esse sinal (nome ou número)"],
        ["-n NÚMERO", "envia esse sinal, pelo número"],
        ["-SINAL", "o mesmo, na forma curta: -9, -KILL, -SIGKILL, -USR1"],
        ["-l [SINAL]", "lista os sinais; com um número dá o nome, com um nome dá o número"],
      ],
      exemplos: [
        ["kill 2451", "pede ao processo 2451 que encerre"],
        ["kill -9 2451", "força o processo 2451 a encerrar"],
        ["kill -STOP 2451", "para o processo, que depois continua com kill -CONT"],
        ["kill -l", "lista os 64 sinais"],
        ["kill -l 15", "mostra o nome do sinal 15 (TERM)"],
      ],
    },
    async executar(args: string[], context: EngineContext): Promise<number> {
      if (args[0] === "-l" || args[0] === "-L" || args[0] === "--list") return list(args.slice(1), context);
      const parsed = parseSignal(args);
      if (parsed.bad !== undefined) {
        context.falhar(messages.kill.invalidSpec(parsed.bad));
        return 1;
      }
      if (parsed.signal === null || KNOWN_TO_THE_ENGINE.has(parsed.signal)) return original.executar(args, context);
      const signal = parsed.signal;
      if (parsed.rest.length === 0) {
        context.falhar(messages.kill.usage);
        return 2;
      }

      let status = 0;
      for (const target of parsed.rest) {
        if (!/^\d+$/.test(target)) {
          context.falhar(messages.kill.jobsUnsupported(target));
          status = 1;
          continue;
        }
        const pid = Number(target);
        const process = context.maquina.processos.porPid(pid);
        if (process === undefined) {
          // Not a command of the user (a service, the system): the engine's kill decides, with the signal that ends it when this one would.
          if (defaultAction(signal) === "terminate") status = (await original.executar(["-15", target], context)) || status;
          continue;
        }
        if (!context.ehRoot() && process.uid !== context.credencial.uid) {
          context.falhar(messages.kill.notPermitted(pid));
          status = 1;
          continue;
        }
        const action = defaultAction(signal);
        if (action === "stop") process.receber(19);
        else if (action === "terminate") process.receber(signal);
        // Ignored by default (CHLD, URG, WINCH): nothing happens, as on Linux.
      }
      return status;
    },
  };
}
