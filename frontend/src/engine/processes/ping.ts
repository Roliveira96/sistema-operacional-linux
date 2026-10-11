import { addresses, resolve } from "../commands/network";
import type { EngineContext as CommandContext } from "../commands/types";
import { messages } from "./messages";
import { printsOnTerminal, printsToNothing } from "./output";
import type { EngineCommand, EngineContext } from "./types";

// SPEC-033 RN-02 and SPEC-029 CA-01: ping stays running until Ctrl+C or a kill, and then prints its summary.

/** In a pipe or a file the output is collected before anyone reads it, so ping stops after this many packets. */
const PIPE_PACKETS = 4;
/** The root may go faster than this (seconds), as on Linux. */
const MIN_USER_INTERVAL = 0.2;

const seedOf = (text: string): number => [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The time of each packet: fixed for an address, a little different from one packet to the next, so the summary has a spread. */
const timeOf = (ip: string, local: boolean, sequence: number): number => {
  const base = ip === "127.0.0.1" ? 0.04 : local ? 0.3 + (seedOf(ip) % 4) / 10 : 8 + (seedOf(ip) % 25);
  const step = ip === "127.0.0.1" ? 0.005 : local ? 0.04 : 0.4;
  return base + ((sequence * 7) % 5) * step;
};

export const pingCommand: EngineCommand = {
  nome: "ping",
  resumo: "testa se uma máquina responde: ping -c 4 google.com",
  ajuda: {
    uso: "ping [-c N] [-q] [-i SEGUNDOS] [-W SEGUNDOS] DESTINO",
    descricao: "Envia pacotes a uma máquina e mostra o tempo de cada resposta. Sem -c fica rodando até Ctrl+C, que imprime as estatísticas. O simulador responde só pelos nomes conhecidos.",
    h: "ajuda",
    opcoes: [
      ["-c N", "envia N pacotes e termina"],
      ["-i SEGUNDOS", "intervalo entre os pacotes (padrão 1; abaixo de 0,2 só o root)"],
      ["-W SEGUNDOS", "quanto espera cada resposta"],
      ["-q", "mostra só o resumo"],
    ],
    exemplos: [
      ["ping -c 4 google.com", "envia 4 pacotes e mostra o resumo"],
      ["ping localhost", "fica rodando até Ctrl+C"],
      ["ping 8.8.8.8 > /dev/null &", "roda em segundo plano, para encerrar com kill"],
    ],
  },
  async executar(args: string[], context: EngineContext): Promise<number> {
    let count: number | null = null;
    let interval = 1;
    let quiet = false;
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const takes = (letter: string): string | undefined => (arg === `-${letter}` ? args[++i] : arg.startsWith(`-${letter}`) ? arg.slice(2) : undefined);
      if (arg === "-q") quiet = true;
      else if (/^-c/.test(arg)) {
        const value = takes("c") ?? "";
        const parsed = Number(value);
        if (!/^\d+$/.test(value) || parsed < 1) {
          context.falhar(messages.ping.invalidCount(value));
          return 2;
        }
        count = parsed;
      } else if (/^-i/.test(arg)) {
        const value = takes("i") ?? "";
        const parsed = Number(value.replace(",", "."));
        if (!Number.isFinite(parsed) || value === "" || parsed < 0) {
          context.falhar(messages.ping.invalidInterval(value));
          return 2;
        }
        if (parsed < MIN_USER_INTERVAL && !context.ehRoot()) {
          context.falhar(messages.ping.tooFast);
          return 2;
        }
        interval = parsed;
      } else if (/^-W/.test(arg)) takes("W");
      else if (arg.startsWith("-") && arg !== "-") {
        context.falhar(`ping: opção inválida -- '${arg.replace(/^-+/, "")}'`);
        context.falhar("Uso: ping [-c N] [-q] [-i SEGUNDOS] [-W SEGUNDOS] DESTINO");
        return 2;
      } else operands.push(arg);
    }
    const name = operands[0];
    if (name === undefined) {
      context.falhar(messages.ping.missingDestination);
      return 2;
    }
    const known = resolve(name, context as unknown as CommandContext);
    // An address the engine does not know is a valid one that nobody answers; a name it does not know cannot be resolved.
    if (known === null && !IPV4.test(name)) {
      context.falhar(messages.ping.unknownHost(name));
      return 2;
    }
    const ip = known?.ip ?? name;
    const local = known?.local ?? false;
    const gateway = addresses(context as unknown as CommandContext).gateway;
    const ttl = ip === "127.0.0.1" || local ? 64 : 117;
    const decimals = local ? 3 : 1;
    const answered = known !== null;

    // A pipe or a file gets a few packets; a terminal, and /dev/null, run until the end (SPEC-029 CA-01).
    const limit = count ?? (printsOnTerminal(context) || printsToNothing(context) ? Infinity : PIPE_PACKETS);
    context.linha(`PING ${name} (${ip}) 56(84) bytes of data.`);
    const times: number[] = [];
    let sent = 0;
    while (sent < limit && !context.interrompido()) {
      sent++;
      if (answered) {
        const time = timeOf(ip, local, sent);
        times.push(time);
        if (!quiet) context.linha(`64 bytes from ${ip}: icmp_seq=${sent} ttl=${ttl} time=${time.toFixed(decimals)} ms`);
      } else if (!quiet) {
        context.linha(`From ${gateway} icmp_seq=${sent} Destination Host Unreachable`);
      }
      if (sent < limit && !(await context.dormir(interval * 1000))) break;
    }
    const lost = sent - times.length;
    context.linha();
    context.linha(`--- ${name} ping statistics ---`);
    context.linha(`${sent} packets transmitted, ${times.length} received,${answered ? "" : ` +${lost} errors,`} ${Math.round((lost / Math.max(sent, 1)) * 100)}% packet loss, time ${Math.round((sent - 1) * interval * 1000)}ms`);
    if (times.length > 0) {
      const min = Math.min(...times);
      const max = Math.max(...times);
      const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
      const mdev = Math.sqrt(times.reduce((sum, time) => sum + (time - avg) ** 2, 0) / times.length);
      context.linha(`rtt min/avg/max/mdev = ${[min, avg, max, mdev].map((value) => value.toFixed(3)).join("/")} ms`);
    }
    return times.length > 0 ? 0 : 1;
  },
};
