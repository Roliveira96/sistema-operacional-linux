// Fakes for the tests of the commands of the process control: a context with what they use, and processes that keep the signal they got.

import type { EngineContext, EngineProcess } from "./types";

export class Pipe {
  texto = "";
  escrever(text: string) {
    this.texto += text;
  }
}

export function makeProcess(pid: number, uid: number, pai: EngineProcess | null = null): EngineProcess {
  return {
    pid,
    uid,
    comando: `cmd${pid}`,
    tty: "pts/0",
    pai,
    sinal: null,
    pausado: false,
    reutilizavel: false,
    get encerrado() {
      return this.sinal !== null;
    },
    estaPausado() {
      return this.pausado;
    },
    receber(signal: number) {
      if (signal === 19 || signal === 20) this.pausado = true;
      else if (signal === 18) this.pausado = false;
      else if (signal !== 0) this.sinal = signal;
    },
  };
}

export interface Fake {
  context: EngineContext;
  out: string[];
  err: string[];
  ran: string[];
  cleared: () => number;
  table: EngineProcess[];
  setBeats: (n: number) => void;
}

/** A context with what a command of the process control uses; the clock is replaced by a count of beats. */
export function fake(options: { uid?: number; process?: EngineProcess | null; table?: EngineProcess[]; out?: object } = {}): Fake {
  const out: string[] = [];
  const err: string[] = [];
  const ran: string[] = [];
  let cleared = 0;
  let beats = 2;
  const table = options.table ?? [];
  const process = options.process === undefined ? makeProcess(900, options.uid ?? 0) : options.process;
  const terminal = options.out ?? { escrever: (t: string) => void out.push(t) };
  const build = (saida: object): EngineContext => ({
    maquina: {
      hostname: "ubuntu",
      processos: { listar: () => table, porPid: (pid: number) => table.find((p) => p.pid === pid) },
      contas: {
        nomeDoUsuario: (uid: number) => (uid === 0 ? "root" : uid === 1000 ? "ana" : `u${uid}`),
        usuario: (name: string) => (name === "root" ? { uid: 0 } : name === "ana" || name === "ricardo" ? { uid: 1000 } : undefined),
      },
    },
    saida,
    erro: { escrever: (t: string) => void err.push(t) },
    entrada: null,
    processo: process,
    emFundo: false,
    credencial: { uid: options.uid ?? 0, gids: [] },
    sessao: { tty: "pts/0", jobs: [] },
    interacao: { limparTela: () => void cleared++ },
    executor: {
      executarArgs: async (args: string[]) => (ran.push(args.join(" ")), 0),
      executarTexto: async (text: string) => (ran.push(text), 0),
    },
    linha: (t = "") => (saida as { escrever(t: string): void }).escrever(t + "\n"),
    escrever: (t: string) => (saida as { escrever(t: string): void }).escrever(t),
    falhar: (t: string) => void err.push(t + "\n"),
    ehRoot: () => (options.uid ?? 0) === 0,
    interrompido: () => beats <= 0,
    dormir: async () => {
      beats -= 1;
      return beats > 0;
    },
    // The same context printing where the command was told to: a command that captures what another one prints uses it.
    com: (changes: { saida?: object }) => build(changes.saida ?? saida),
  }) as unknown as EngineContext;
  const context = build(terminal);
  return { context, out, err, ran, cleared: () => cleared, table, setBeats: (n) => (beats = n) };
}
