import type { Maquina } from './Maquina';
import { Arquivo, Diretorio, Dispositivo, type No } from './No';
import { SistemaDeArquivos } from './SistemaDeArquivos';

/** Uma partição (sdb1): tamanho, sistema de arquivos e o conteúdo dele. */
export class Particao {
  public nome: string;
  public tamanhoGb: number;
  public fs: 'ext4' | null = null;
  public uuid: string | null = null;
  public formatadaEm: Date | null = null;
  /** A raiz do sistema de arquivos (o que aparece na pasta onde ela for montada). */
  public raiz: Diretorio | null = null;

  constructor(nome: string, tamanhoGb: number) {
    this.nome = nome;
    this.tamanhoGb = tamanhoGb;
  }

  /** mkfs.ext4: sistema de arquivos novo e vazio (só com lost+found). */
  public formatar(): void {
    this.fs = 'ext4';
    this.uuid = Particao.novoUuid();
    this.formatadaEm = new Date();
    this.raiz = new Diretorio(this.nome, 0, 0, 0o755);
    this.raiz.adicionar(new Diretorio('lost+found', 0, 0, 0o700));
  }

  private static novoUuid(): string {
    const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return hex(8) + '-' + hex(4) + '-4' + hex(3) + '-a' + hex(3) + '-' + hex(12);
  }
}

/** Um disco inteiro (sdb) com suas partições. */
export class Disco {
  public readonly nome: string;
  public readonly tamanhoGb: number;
  public particoes: Particao[] = [];
  /** Segundo do boot em que o kernel "viu" o disco (para o dmesg). */
  public readonly detectadoEm: number;
  public identificador: string | null = null;

  constructor(nome: string, tamanhoGb: number, detectadoEm: number) {
    this.nome = nome;
    this.tamanhoGb = tamanhoGb;
    this.detectadoEm = detectadoEm;
  }
}

export interface Montagem {
  dispositivo: string;
  ponto: string;
  particao: Particao;
  /** A pasta que estava no lugar antes do mount (volta no umount). */
  original: Diretorio;
}

/** Discos extras do servidor e o que está montado agora. */
export class GerenciadorDeDiscos {
  private readonly maquina: Maquina;
  private readonly discos: Disco[] = [];
  private readonly montagens: Montagem[] = [];

  constructor(maquina: Maquina) {
    this.maquina = maquina;
  }

  public adicionarDisco(disco: Disco): void {
    this.discos.push(disco);
    this.garantirDispositivo(disco.nome);
    for (const p of disco.particoes) this.garantirDispositivo(p.nome);
  }

  public listar(): Disco[] {
    return this.discos.slice();
  }

  public disco(nome: string): Disco | undefined {
    return this.discos.find((d: Disco) => d.nome === nome.replace(/^\/dev\//, ''));
  }

  public particao(dispositivo: string): Particao | undefined {
    const nome: string = this.resolverDispositivo(dispositivo) ?? '';
    for (const disco of this.discos) {
      const achada: Particao | undefined = disco.particoes.find((p: Particao) => p.nome === nome);
      if (achada !== undefined) return achada;
    }
    return undefined;
  }

  /** "/dev/sdb1" ou "UUID=3f2a..." → "sdb1". */
  public resolverDispositivo(texto: string): string | null {
    if (texto.startsWith('UUID=')) {
      const uuid: string = texto.substring(5).replace(/"/g, '');
      for (const disco of this.discos) {
        for (const p of disco.particoes) if (p.uuid === uuid) return p.nome;
      }
      return null;
    }
    return texto.replace(/^\/dev\//, '');
  }

  public listarMontagens(): Montagem[] {
    return this.montagens.slice();
  }

  public montagemDe(particao: Particao): Montagem | undefined {
    return this.montagens.find((m: Montagem) => m.particao === particao);
  }

  public montagemEm(ponto: string): Montagem | undefined {
    return this.montagens.find((m: Montagem) => m.ponto === ponto);
  }

  /** A raiz de partição montada neste nó? (para o JSON salvar a pasta original no lugar) */
  public originalDe(no: No): Diretorio | null {
    return this.montagens.find((m: Montagem) => m.particao.raiz === no)?.original ?? null;
  }

  /** Troca a pasta do ponto de montagem pela raiz da partição. */
  public montar(particao: Particao, ponto: string): void {
    const original: No | null = this.maquina.fs.obter(ponto);
    if (!(original instanceof Diretorio) || original.pai === null || particao.raiz === null) return;
    const raiz: Diretorio = particao.raiz;
    const pai: Diretorio = original.pai;
    raiz.nome = original.nome;
    pai.filhos.set(original.nome, raiz);
    raiz.pai = pai;
    this.montagens.push({ dispositivo: '/dev/' + particao.nome, ponto, particao, original });
  }

  public desmontar(montagem: Montagem): void {
    const raiz: Diretorio = montagem.particao.raiz as Diretorio;
    const pai: Diretorio | null = raiz.pai;
    if (pai !== null) {
      pai.filhos.set(montagem.original.nome, montagem.original);
      montagem.original.pai = pai;
    }
    raiz.pai = null;
    this.montagens.splice(this.montagens.indexOf(montagem), 1);
  }

  /** Linhas do /etc/fstab: [dispositivo, ponto, tipo, opções]. */
  public fstab(): Array<[string, string, string, string]> {
    const no: No | null = this.maquina.fs.obter('/etc/fstab');
    const texto: string = no instanceof Arquivo ? no.ler() : '';
    return texto.split('\n').map((l: string) => l.trim()).filter((l: string) => l !== '' && !l.startsWith('#'))
      .map((l: string) => l.split(/\s+/)).filter((c: string[]) => c.length >= 3).map((c: string[]) => [c[0], c[1], c[2], c[3] ?? 'defaults']);
  }

  /** "Boot": monta o que o /etc/fstab manda (ignorando o disco principal e o swap, que já estão). Devolve os erros. */
  public montarFstab(): string[] {
    const erros: string[] = [];
    for (const [dispositivo, ponto, tipo, opcoes] of this.fstab()) {
      if (ponto === '/' || ponto === '/boot/efi' || tipo === 'swap' || ponto === 'none' || opcoes.includes('noauto')) continue;
      if (this.montagemEm(ponto) !== undefined) continue;
      const particao: Particao | undefined = this.particao(dispositivo);
      if (particao === undefined) {
        erros.push('mount: ' + ponto + ': dispositivo especial ' + dispositivo + ' não existe.');
        continue;
      }
      if (particao.fs === null) {
        erros.push('mount: ' + ponto + ': tipo errado de sistema de arquivos, opção inválida, superbloco inválido em /dev/' + particao.nome + '.');
        continue;
      }
      if (!(this.maquina.fs.obter(ponto) instanceof Diretorio)) {
        erros.push('mount: ' + ponto + ': o ponto de montagem não existe.');
        continue;
      }
      if (this.montagemDe(particao) === undefined) this.montar(particao, ponto);
    }
    return erros;
  }

  /** Espaço usado (KB) de uma partição, somando os arquivos dela. */
  public usadoKb(particao: Particao): number {
    const medir = (no: No): number => no instanceof Diretorio
      ? 4 + Array.from(no.filhos.values()).reduce((t: number, f: No) => t + medir(f), 0)
      : Math.ceil(no.tamanho() / 4096) * 4;
    return particao.raiz !== null ? medir(particao.raiz) + 24576 : 0;
  }

  public garantirDispositivo(nome: string): void {
    const dev: No | null = this.maquina.fs.obter('/dev');
    if (dev instanceof Diretorio && dev.obter(nome) === undefined) dev.adicionar(new Dispositivo(nome, 'b', 0, 6, 0o660));
  }

  public removerDispositivo(nome: string): void {
    const dev: No | null = this.maquina.fs.obter('/dev');
    if (dev instanceof Diretorio) dev.remover(nome);
  }

  public static absoluto(ponto: string, cwd: string): string {
    return SistemaDeArquivos.absoluto(ponto, cwd);
  }
}
