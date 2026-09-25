/** Qualquer coisa que mora no sistema de arquivos: tem nome, dono, grupo e permissões. */
export abstract class No {
  public nome: string;
  public dono: number;
  public grupo: number;
  public modo: number;
  public modificadoEm: Date;
  public pai: Diretorio | null = null;

  constructor(nome: string, dono: number, grupo: number, modo: number) {
    this.nome = nome;
    this.dono = dono;
    this.grupo = grupo;
    this.modo = modo;
    this.modificadoEm = new Date();
  }

  public abstract ehDiretorio(): boolean;
  public abstract tamanho(): number;
  public abstract clonar(): No;

  public tocar(): void {
    this.modificadoEm = new Date();
  }

  protected copiarMetadadosPara(copia: No): void {
    copia.modificadoEm = new Date(this.modificadoEm.getTime());
  }
}

export class Arquivo extends No {
  private conteudo: string;

  constructor(nome: string, dono: number, grupo: number, modo: number, conteudo: string = '') {
    super(nome, dono, grupo, modo);
    this.conteudo = conteudo;
  }

  public ehDiretorio(): boolean {
    return false;
  }

  public ler(): string {
    return this.conteudo;
  }

  public escrever(texto: string): void {
    this.conteudo = texto;
    this.tocar();
  }

  public acrescentar(texto: string): void {
    this.escrever(this.ler() + texto);
  }

  public tamanho(): number {
    return new TextEncoder().encode(this.ler()).length;
  }

  public clonar(): No {
    const copia: Arquivo = new Arquivo(this.nome, this.dono, this.grupo, this.modo, this.ler());
    this.copiarMetadadosPara(copia);
    return copia;
  }
}

/** Arquivo cujo conteúdo é gerado na hora (ex.: /etc/passwd reflete as contas atuais). */
export class ArquivoGerado extends Arquivo {
  private readonly gerador: () => string;

  constructor(nome: string, dono: number, grupo: number, modo: number, gerador: () => string) {
    super(nome, dono, grupo, modo);
    this.gerador = gerador;
  }

  public ler(): string {
    return this.gerador();
  }

  public escrever(_texto: string): void {
    // o conteúdo vem das contas do sistema: use useradd, usermod, groupadd...
    this.tocar();
  }
}

/** /dev/null: aceita tudo e devolve nada. */
export class Buraco extends Arquivo {
  public ler(): string {
    return '';
  }

  public escrever(_texto: string): void {
    // descarta
  }
}

export class Diretorio extends No {
  public readonly filhos: Map<string, No> = new Map();

  public ehDiretorio(): boolean {
    return true;
  }

  public tamanho(): number {
    return 4096;
  }

  public adicionar(filho: No): void {
    filho.pai = this;
    this.filhos.set(filho.nome, filho);
    this.tocar();
  }

  public remover(nome: string): void {
    this.filhos.delete(nome);
    this.tocar();
  }

  public obter(nome: string): No | undefined {
    return this.filhos.get(nome);
  }

  /** Nomes em ordem alfabética, como o ls do Ubuntu em pt_BR (ignora maiúsculas e o ponto inicial). */
  public nomesOrdenados(): string[] {
    return Array.from(this.filhos.keys()).sort((a: string, b: string) =>
      a.replace(/^\./, '').localeCompare(b.replace(/^\./, ''), 'pt-BR', { sensitivity: 'base' }));
  }

  public clonar(): No {
    const copia: Diretorio = new Diretorio(this.nome, this.dono, this.grupo, this.modo);
    for (const filho of this.filhos.values()) {
      copia.adicionar(filho.clonar());
    }
    this.copiarMetadadosPara(copia);
    return copia;
  }
}
