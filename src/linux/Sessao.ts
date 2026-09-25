import type { Usuario } from './Contas';
import type { Credencial } from './SistemaDeArquivos';
import type { Processo } from './Processos';
import { Escopo } from './Escopo';

/** Um shell aberto: quem está logado, onde está, com quais grupos entrou e suas variáveis. */
export class Quadro {
  public readonly usuario: Usuario;
  /** Grupos lidos NO LOGIN: um usermod -aG só vale depois de logar de novo. */
  public readonly gids: number[];
  public cwd: string;
  public anterior: string;
  public umask: number;
  public readonly escopo: Escopo;
  /** PID do bash deste shell (preenchido pela sessão). */
  public pid: number = 0;

  constructor(usuario: Usuario, gids: number[], cwd: string, escopo?: Escopo) {
    this.usuario = usuario;
    this.gids = gids;
    this.cwd = cwd;
    this.anterior = cwd;
    this.umask = usuario.uid === 0 ? 0o022 : 0o002;
    this.escopo = escopo ?? Escopo.paraLogin(usuario);
  }
}

/** Um comando mandado para o segundo plano (&) ou suspenso (Ctrl+Z). */
export class Job {
  public readonly numero: number;
  public readonly processo: Processo;
  public readonly comando: string;
  public promessa: Promise<number> | null = null;
  public terminou: boolean = false;
  /** Trazido com fg: quando terminar, não precisa de aviso "[1]+ Concluído". */
  public emPrimeiroPlano: boolean = false;
  public status: number = 0;

  constructor(numero: number, processo: Processo, comando: string) {
    this.numero = numero;
    this.processo = processo;
    this.comando = comando;
  }

  /** Texto da coluna de estado do "jobs". */
  public estado(): string {
    if (!this.terminou) return this.processo.pausado ? 'Parado' : 'Executando';
    const sinal: number | null = this.processo.sinal;
    if (sinal === 9) return 'Morto';
    if (sinal === 15 || sinal === 1) return 'Terminado';
    if (sinal === 2) return 'Interrompido';
    return this.status === 0 ? 'Concluído' : 'Saída ' + this.status;
  }
}

/** Uma conexão (um terminal): pilha de shells, jobs e o que está em primeiro plano. */
export class Sessao {
  private readonly quadros: Quadro[] = [];
  public readonly historico: string[] = [];
  /** Usuários que já digitaram a senha do sudo (o Ubuntu lembra por 15 minutos). */
  public readonly sudoValidado: Set<string> = new Set();
  public readonly tty: string;
  public readonly pidSshd: number;
  public readonly jobs: Job[] = [];
  /** Jobs que terminaram e ainda não foram anunciados no prompt ("[1]+ Concluído"). */
  public readonly avisos: Job[] = [];
  /** Processos em primeiro plano agora (recebem o Ctrl+C / Ctrl+Z). */
  public readonly primeiroPlano: Processo[] = [];
  /** Ctrl+C foi apertado durante o comando atual. */
  public interrompido: boolean = false;
  /** Chamado quando a conexão é derrubada de fora (kill no bash/sshd, pkill -u). */
  public aoEncerrar: (() => void) | null = null;
  private readonly novoPid: () => number;

  constructor(inicial: Quadro, tty: string, novoPid: () => number) {
    this.tty = tty;
    this.novoPid = novoPid;
    this.pidSshd = novoPid();
    inicial.pid = novoPid();
    this.quadros.push(inicial);
  }

  public atual(): Quadro {
    return this.quadros[this.quadros.length - 1];
  }

  public listarQuadros(): Quadro[] {
    return this.quadros.slice();
  }

  public credencial(): Credencial {
    const quadro: Quadro = this.atual();
    return { uid: quadro.usuario.uid, gids: quadro.gids };
  }

  public entrar(quadro: Quadro): void {
    quadro.pid = this.novoPid();
    this.quadros.push(quadro);
  }

  /** Fecha o shell atual. Retorna false se já estava no primeiro. */
  public sair(): boolean {
    if (this.quadros.length === 1) {
      return false;
    }
    this.quadros.pop();
    return true;
  }

  /** "~" quando estiver dentro da home de quem está logado. */
  public caminhoCurto(): string {
    const quadro: Quadro = this.atual();
    const home: string = quadro.usuario.home;
    if (quadro.cwd === home) {
      return '~';
    }
    if (home !== '/' && quadro.cwd.startsWith(home + '/')) {
      return '~' + quadro.cwd.substring(home.length);
    }
    return quadro.cwd;
  }

  public profundidade(): number {
    return this.quadros.length;
  }

  /** Quem fez o login SSH (o primeiro quadro), independente de su posteriores. */
  public usuarioDaConexao(): string {
    return this.quadros[0].usuario.nome;
  }

  public usuariosLogados(): string[] {
    return this.quadros.map((q: Quadro) => q.usuario.nome);
  }

  public novoNumeroDeJob(): number {
    let numero: number = 1;
    while (this.jobs.some((j: Job) => j.numero === numero)) numero++;
    return numero;
  }

  /** Ctrl+C: avisa o comando em primeiro plano. */
  public interromper(): void {
    this.interrompido = true;
    for (const processo of this.primeiroPlano) processo.receber(2);
  }

  /** Ctrl+Z: suspende o comando em primeiro plano. */
  public suspender(): void {
    for (const processo of this.primeiroPlano) processo.receber(20);
  }
}
