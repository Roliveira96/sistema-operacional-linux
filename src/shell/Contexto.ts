import type { Maquina } from '../linux/Maquina';
import type { Contas } from '../linux/Contas';
import type { Quadro, Sessao } from '../linux/Sessao';
import type { No, Diretorio } from '../linux/No';
import type { Credencial, SistemaDeArquivos } from '../linux/SistemaDeArquivos';
import type { Saida } from './Saida';

/** Um arquivo aberto no nano ou no vim. gravar() devolve a mensagem de erro, ou null se deu certo. */
export interface PedidoDeEdicao {
  editor: 'nano' | 'vim';
  caminho: string;
  conteudo: string;
  novo: boolean;
  somenteLeitura: boolean;
  /** Mensagem mostrada ao abrir (ex.: sem permissão de leitura). */
  aviso: string | null;
  gravar(texto: string): string | null;
}

/** O que só o terminal sabe fazer: pedir algo ao usuário, limpar a tela e abrir editores em tela cheia. */
export interface Interacao {
  perguntar(pergunta: string, oculto: boolean): Promise<string>;
  limparTela(): void;
  editar(pedido: PedidoDeEdicao): Promise<void>;
  /** exit no último shell: a "conexão SSH" cai. */
  desconectar(): void;
}

/** Quem sabe rodar um comando a partir de argumentos já prontos (usado pelo sudo). */
export interface Executor {
  executarArgs(args: string[], contexto: Contexto): Promise<number>;
  ehEmbutido(nome: string): boolean;
}

/** Tudo que um comando recebe para trabalhar. */
export class Contexto {
  public readonly maquina: Maquina;
  public readonly sessao: Sessao;
  public readonly saida: Saida;
  public readonly erro: Saida;
  public readonly entrada: string | null;
  public readonly credencial: Credencial;
  public readonly interacao: Interacao;
  public readonly executor: Executor;

  constructor(maquina: Maquina, sessao: Sessao, saida: Saida, erro: Saida, entrada: string | null, credencial: Credencial,
    interacao: Interacao, executor: Executor) {
    this.maquina = maquina;
    this.sessao = sessao;
    this.saida = saida;
    this.erro = erro;
    this.entrada = entrada;
    this.credencial = credencial;
    this.interacao = interacao;
    this.executor = executor;
  }

  public get fs(): SistemaDeArquivos {
    return this.maquina.fs;
  }

  public get contas(): Contas {
    return this.maquina.contas;
  }

  public get quadro(): Quadro {
    return this.sessao.atual();
  }

  public ehRoot(): boolean {
    return this.credencial.uid === 0;
  }

  /** Mesmo contexto, com outra identidade (sudo). */
  public comCredencial(credencial: Credencial): Contexto {
    return new Contexto(this.maquina, this.sessao, this.saida, this.erro, this.entrada, credencial, this.interacao, this.executor);
  }

  public escrever(texto: string, classe?: string): void {
    this.saida.escrever(texto, classe);
  }

  public linha(texto: string = '', classe?: string): void {
    this.saida.escrever(texto + '\n', classe);
  }

  public falhar(texto: string): void {
    this.erro.escrever(texto + '\n');
  }

  public localizar(caminho: string): No {
    return this.fs.localizar(caminho, this.quadro.cwd, this.credencial);
  }

  /** Como localizar, mas se o último item for um link devolve o próprio link (lstat). */
  public localizarSemSeguir(caminho: string): No {
    return this.fs.localizar(caminho, this.quadro.cwd, this.credencial, false);
  }

  public localizarPai(caminho: string): { pai: Diretorio; nome: string } {
    return this.fs.localizarPai(caminho, this.quadro.cwd, this.credencial);
  }

  public tentarLocalizar(caminho: string): No | null {
    try {
      return this.localizar(caminho);
    } catch {
      return null;
    }
  }
}
