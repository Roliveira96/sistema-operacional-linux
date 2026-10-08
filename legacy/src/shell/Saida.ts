import type { Arquivo } from '../linux/No';

/** Para onde vai o que um comando imprime: o terminal, um arquivo (>) ou o próximo comando (|). */
export interface Saida {
  /** A classe só tem efeito no terminal (ex.: diretórios em azul no ls). */
  escrever(texto: string, classe?: string): void;
}

/** Guarda o texto em memória: usada nos pipes. */
export class SaidaEmTexto implements Saida {
  public texto: string = '';

  public escrever(texto: string): void {
    this.texto += texto;
  }
}

/** Redirecionamento > e >>: o arquivo já foi aberto (e truncado) antes do comando rodar. */
export class SaidaParaArquivo implements Saida {
  private readonly arquivo: Arquivo;

  constructor(arquivo: Arquivo) {
    this.arquivo = arquivo;
  }

  public escrever(texto: string): void {
    this.arquivo.acrescentar(texto);
  }
}
