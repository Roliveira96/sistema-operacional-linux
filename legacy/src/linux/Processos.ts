import type { Sessao } from './Sessao';

/** Sinais mais usados: 1 HUP, 2 INT (Ctrl+C), 9 KILL, 15 TERM (padrão do kill), 18 CONT, 19 STOP, 20 TSTP (Ctrl+Z). */
export const SINAIS: Array<[number, string]> = [
  [1, 'HUP'], [2, 'INT'], [3, 'QUIT'], [9, 'KILL'], [15, 'TERM'], [18, 'CONT'], [19, 'STOP'], [20, 'TSTP'],
];

export function numeroDoSinal(texto: string): number | null {
  const limpo: string = texto.replace(/^-/, '').replace(/^SIG/i, '').toUpperCase();
  if (/^\d+$/.test(limpo)) return Number(limpo);
  const achado: [number, string] | undefined = SINAIS.find(([, nome]) => nome === limpo);
  return achado !== undefined ? achado[0] : null;
}

/** Um processo do usuário (um comando rodando agora, em primeiro ou segundo plano). */
export class Processo {
  public readonly pid: number;
  public readonly uid: number;
  public readonly comando: string;
  public readonly tty: string;
  public readonly inicio: Date = new Date();
  public readonly sessao: Sessao | null;
  /** Processo pai (o script ou o job que o chamou): se o pai morre, o filho para junto. */
  public readonly pai: Processo | null;
  /** Job recém-criado cujo PID ainda pode ser usado pelo primeiro comando ("[1] 2451" = PID do sleep). */
  public reutilizavel: boolean = false;
  /** Sinal que encerrou o processo (15, 9, 2, 1) ou null se continua vivo. */
  public sinal: number | null = null;
  public pausado: boolean = false;
  public nohup: boolean = false;
  private aoSuspender: Array<() => void> = [];

  constructor(pid: number, uid: number, comando: string, tty: string, sessao: Sessao | null, pai: Processo | null = null) {
    this.pai = pai;
    this.pid = pid;
    this.uid = uid;
    this.comando = comando;
    this.tty = tty;
    this.sessao = sessao;
  }

  public get encerrado(): boolean {
    return this.sinal !== null || (this.pai?.encerrado ?? false);
  }

  public estaPausado(): boolean {
    return this.pausado || (this.pai?.estaPausado() ?? false);
  }

  public estado(): string {
    return this.estaPausado() ? 'T' : 'S';
  }

  /** Entrega um sinal. HUP é ignorado por quem rodou com nohup. */
  public receber(sinal: number): void {
    if (sinal === 19 || sinal === 20) {
      this.pausado = true;
      const ouvintes = this.aoSuspender;
      this.aoSuspender = [];
      for (const ouvinte of ouvintes) ouvinte();
      return;
    }
    if (sinal === 18) {
      this.pausado = false;
      return;
    }
    if (sinal === 1 && this.nohup) {
      return;
    }
    if (sinal === 0) {
      return;
    }
    this.sinal = sinal;
    this.pausado = false;
  }

  /** Promessa que resolve quando o processo for suspenso (Ctrl+Z). */
  public suspensao(): Promise<'suspenso'> {
    return new Promise((resolver) => this.aoSuspender.push(() => resolver('suspenso')));
  }
}

/** Todos os processos de usuário em execução na máquina (não é salvo: some ao recarregar, como num reboot). */
export class TabelaDeProcessos {
  private proximo: number = 2400;
  private readonly processos: Processo[] = [];

  public criar(uid: number, comando: string, tty: string, sessao: Sessao | null, pai: Processo | null = null): Processo {
    this.proximo += 1 + Math.floor(Math.random() * 3);
    const processo: Processo = new Processo(this.proximo, uid, comando, tty, sessao, pai);
    this.processos.push(processo);
    return processo;
  }

  public novoPid(): number {
    this.proximo += 1 + Math.floor(Math.random() * 3);
    return this.proximo;
  }

  public remover(processo: Processo): void {
    const i: number = this.processos.indexOf(processo);
    if (i >= 0) this.processos.splice(i, 1);
  }

  public porPid(pid: number): Processo | undefined {
    return this.processos.find((p: Processo) => p.pid === pid);
  }

  public listar(): Processo[] {
    return this.processos.slice();
  }
}
