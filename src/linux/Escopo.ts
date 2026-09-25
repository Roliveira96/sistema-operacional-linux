import type { Usuario } from './Contas';

/**
 * Variáveis, variáveis exportadas (ambiente) e apelidos de um shell.
 * Cada login tem o seu; um script roda num escopo filho que só herda o que foi exportado.
 */
export class Escopo {
  public readonly variaveis: Map<string, string> = new Map();
  public readonly exportadas: Set<string> = new Set();
  public readonly aliases: Map<string, string> = new Map();
  public posicionais: string[] = [];
  public nome: string = '-bash';
  public emScript: boolean = false;
  public ultimoStatus: number = 0;
  public ultimoFundo: number | null = null;

  public static paraLogin(usuario: Usuario): Escopo {
    const escopo: Escopo = new Escopo();
    const padrao: Array<[string, string]> = [
      ['HOME', usuario.home], ['USER', usuario.nome], ['LOGNAME', usuario.nome], ['SHELL', usuario.shell],
      ['PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      ['LANG', 'pt_BR.UTF-8'], ['TERM', 'xterm-256color'], ['EDITOR', 'nano'],
    ];
    for (const [nome, valor] of padrao) escopo.exportar(nome, valor);
    return escopo;
  }

  /** Escopo de um script: herda só o ambiente exportado (e os apelidos não passam para scripts). */
  public filho(nome: string, argumentos: string[]): Escopo {
    const filho: Escopo = new Escopo();
    for (const nomeVar of this.exportadas) {
      filho.exportar(nomeVar, this.variaveis.get(nomeVar) ?? '');
    }
    filho.nome = nome;
    filho.posicionais = argumentos;
    filho.emScript = true;
    return filho;
  }

  public definir(nome: string, valor: string): void {
    this.variaveis.set(nome, valor);
  }

  public exportar(nome: string, valor?: string): void {
    if (valor !== undefined) this.variaveis.set(nome, valor);
    else if (!this.variaveis.has(nome)) this.variaveis.set(nome, '');
    this.exportadas.add(nome);
  }

  public remover(nome: string): void {
    this.variaveis.delete(nome);
    this.exportadas.delete(nome);
  }

  public obter(nome: string): string | undefined {
    return this.variaveis.get(nome);
  }

  public caminhos(): string[] {
    return (this.variaveis.get('PATH') ?? '').split(':').filter((p: string) => p !== '');
  }

  /**
   * Aplica as linhas simples de um ~/.bashrc: alias x='y', export X=Y e X=Y.
   * (O bash real executa o arquivo inteiro; aqui lemos só o que importa para o estudo.)
   */
  public aplicarPerfil(texto: string): void {
    for (const bruta of texto.split('\n')) {
      const linha: string = bruta.trim();
      const apelido: RegExpMatchArray | null = linha.match(/^alias\s+([\w.-]+)=(['"])(.*)\2\s*$/);
      if (apelido !== null) {
        this.aliases.set(apelido[1], apelido[3]);
        continue;
      }
      const variavel: RegExpMatchArray | null = linha.match(/^(export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (variavel !== null) {
        const valor: string = variavel[3].replace(/^(['"])(.*)\1$/, '$2')
          .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_t: string, v: string) => this.variaveis.get(v) ?? '');
        if (variavel[1] !== undefined) this.exportar(variavel[2], valor);
        else this.definir(variavel[2], valor);
      }
    }
  }
}
