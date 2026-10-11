/**
 * ACL: permissões extras para usuários e grupos específicos (setfacl -m u:maria:rw).
 * Com ACL, os bits de "grupo" do ls viram a MÁSCARA (o máximo que usuários/grupos nomeados podem ter).
 */
export class Acl {
  public readonly usuarios: Map<number, number> = new Map();
  public readonly grupos: Map<number, number> = new Map();
  /** Permissão do grupo dono do arquivo (entrada group:: do getfacl). */
  public grupoDono: number;

  constructor(grupoDono: number) {
    this.grupoDono = grupoDono;
  }

  public vazia(): boolean {
    return this.usuarios.size === 0 && this.grupos.size === 0;
  }

  /** Máscara automática: a união de tudo que não é dono nem "outros". */
  public mascaraCalculada(): number {
    let mascara: number = this.grupoDono;
    for (const p of this.usuarios.values()) mascara |= p;
    for (const p of this.grupos.values()) mascara |= p;
    return mascara;
  }
}

/** Qualquer coisa que mora no sistema de arquivos: tem nome, dono, grupo e permissões. */
export abstract class No {
  public nome: string;
  public dono: number;
  public grupo: number;
  public modo: number;
  public modificadoEm: Date;
  public pai: Diretorio | null = null;
  /** Lista de controle de acesso (setfacl). null = só as permissões tradicionais. */
  public acl: Acl | null = null;

  constructor(nome: string, dono: number, grupo: number, modo: number) {
    this.nome = nome;
    this.dono = dono;
    this.grupo = grupo;
    this.modo = modo;
    this.modificadoEm = new Date();
  }

  public abstract ehDiretorio(): boolean;

  /** Primeira letra do ls -l: d diretório, l link, c/b dispositivo, - arquivo. */
  public tipoLs(): string {
    return this.ehDiretorio() ? 'd' : '-';
  }
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

/** Programa compilado (ELF): não dá para ler como texto; o tamanho é o do binário real. */
export class Binario extends Arquivo {
  public readonly bytes: number;

  constructor(nome: string, bytes: number, dono: number = 0, grupo: number = 0, modo: number = 0o755) {
    super(nome, dono, grupo, modo);
    this.bytes = bytes;
  }

  public ler(): string {
    return '\u007fELF\u0002\u0001\u0001 (programa compilado: binário, não é texto) \u0000\u0000\n';
  }

  public escrever(_texto: string): void {
    // binários do sistema não são alterados no simulador
  }

  public tamanho(): number {
    return this.bytes;
  }

  public clonar(): No {
    const copia: Binario = new Binario(this.nome, this.bytes, this.dono, this.grupo, this.modo);
    this.copiarMetadadosPara(copia);
    return copia;
  }
}

/** Arquivo compactado (.tar, .tar.gz, .gz, .zip): guarda o conteúdo original e ocupa menos espaço. */
export class Compactado extends Arquivo {
  public formato: 'tar' | 'tar.gz' | 'gz' | 'zip';
  /** O conteúdo "de dentro" (texto original, ou JSON com as entradas do tar/zip). */
  public dados: string;

  constructor(nome: string, formato: 'tar' | 'tar.gz' | 'gz' | 'zip', dados: string, dono: number, grupo: number, modo: number) {
    super(nome, dono, grupo, modo);
    this.formato = formato;
    this.dados = dados;
  }

  public ler(): string {
    const assinatura: string = this.formato === 'zip' ? 'PK\u0003\u0004' : this.formato === 'tar' ? this.nome + '\u0000\u0000ustar  ' : '\u001f\u008b\u0008';
    return assinatura + '\u0000\u0000 (arquivo compactado: use tar, gunzip ou unzip para ver o conteúdo) \u0000\n';
  }

  public escrever(_texto: string): void {
    // um compactado é substituído inteiro pelo tar/gzip/zip, não editado
  }

  /** gzip real reduz texto para uns 25–35%; o tar arredonda em blocos de 10 KB. */
  public tamanho(): number {
    const bruto: number = new TextEncoder().encode(this.dados).length;
    if (this.formato === 'tar') return Math.max(10240, Math.ceil(bruto / 10240) * 10240);
    return Math.max(60, Math.round(bruto * 0.3));
  }

  public clonar(): No {
    const copia: Compactado = new Compactado(this.nome, this.formato, this.dados, this.dono, this.grupo, this.modo);
    this.copiarMetadadosPara(copia);
    return copia;
  }
}

/** Link simbólico: um "atalho" que aponta para outro caminho (ex.: /bin -> usr/bin). */
export class Link extends No {
  public alvo: string;

  constructor(nome: string, alvo: string, dono: number = 0, grupo: number = 0) {
    super(nome, dono, grupo, 0o777);
    this.alvo = alvo;
  }

  public ehDiretorio(): boolean {
    return false;
  }

  public tipoLs(): string {
    return 'l';
  }

  public tamanho(): number {
    return new TextEncoder().encode(this.alvo).length;
  }

  public clonar(): No {
    const copia: Link = new Link(this.nome, this.alvo, this.dono, this.grupo);
    this.copiarMetadadosPara(copia);
    return copia;
  }
}

/** Arquivo de dispositivo em /dev: c = caractere (terminal, /dev/null), b = bloco (disco). */
export class Dispositivo extends Arquivo {
  public readonly letra: 'c' | 'b';

  constructor(nome: string, letra: 'c' | 'b', dono: number, grupo: number, modo: number) {
    super(nome, dono, grupo, modo);
    this.letra = letra;
  }

  public tipoLs(): string {
    return this.letra;
  }

  public tamanho(): number {
    return 0;
  }

  public ler(): string {
    return '';
  }

  public escrever(_texto: string): void {
    // escrever num dispositivo não guarda nada no simulador
  }

  public clonar(): No {
    return new Dispositivo(this.nome, this.letra, this.dono, this.grupo, this.modo);
  }
}

/** /dev/null: aceita tudo e devolve nada. */
export class Buraco extends Dispositivo {
  constructor(nome: string, dono: number, grupo: number, modo: number) {
    super(nome, 'c', dono, grupo, modo);
  }

  public clonar(): No {
    return new Buraco(this.nome, this.dono, this.grupo, this.modo);
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
