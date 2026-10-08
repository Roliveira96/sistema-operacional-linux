import type { Maquina } from '../linux/Maquina';
import type { Contas } from '../linux/Contas';
import type { Quadro, Sessao } from '../linux/Sessao';
import type { No, Diretorio } from '../linux/No';
import type { Credencial, SistemaDeArquivos } from '../linux/SistemaDeArquivos';
import type { Processo } from '../linux/Processos';
import type { Escopo } from '../linux/Escopo';
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

/** Quem sabe rodar comandos (usado pelo sudo, xargs, nohup, bash, source, find -exec...). */
export interface Executor {
  executarArgs(args: string[], contexto: Contexto): Promise<number>;
  executarTexto(texto: string, contexto: Contexto): Promise<number>;
  executarScript(caminho: string, argumentos: string[], contexto: Contexto, exigirExecucao: boolean): Promise<number>;
  ehEmbutido(nome: string): boolean;
  nomesDeComandos(): string[];
}

export interface OpcoesDeContexto {
  maquina: Maquina;
  sessao: Sessao;
  saida: Saida;
  erro: Saida;
  entrada: string | null;
  credencial: Credencial;
  interacao: Interacao;
  executor: Executor;
  escopo: Escopo;
  processo: Processo | null;
  emFundo: boolean;
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
  /** Variáveis do shell atual (ou do script que está rodando). */
  public readonly escopo: Escopo;
  /** O processo deste comando (null para comandos internos do bash). */
  public readonly processo: Processo | null;
  /** Rodando em segundo plano (&): o Ctrl+C do terminal não o atinge. */
  public readonly emFundo: boolean;

  constructor(opcoes: OpcoesDeContexto) {
    this.maquina = opcoes.maquina;
    this.sessao = opcoes.sessao;
    this.saida = opcoes.saida;
    this.erro = opcoes.erro;
    this.entrada = opcoes.entrada;
    this.credencial = opcoes.credencial;
    this.interacao = opcoes.interacao;
    this.executor = opcoes.executor;
    this.escopo = opcoes.escopo;
    this.processo = opcoes.processo;
    this.emFundo = opcoes.emFundo;
  }

  public opcoes(): OpcoesDeContexto {
    return {
      maquina: this.maquina, sessao: this.sessao, saida: this.saida, erro: this.erro, entrada: this.entrada,
      credencial: this.credencial, interacao: this.interacao, executor: this.executor, escopo: this.escopo,
      processo: this.processo, emFundo: this.emFundo,
    };
  }

  public com(mudancas: Partial<OpcoesDeContexto>): Contexto {
    return new Contexto({ ...this.opcoes(), ...mudancas });
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
    return this.com({ credencial });
  }

  /** O comando deve parar? (Ctrl+C no terminal, ou kill no processo dele.) */
  public interrompido(): boolean {
    return (this.processo?.encerrado ?? false) || (!this.emFundo && this.sessao.interrompido);
  }

  /** Espera ms milissegundos (parado enquanto suspenso com Ctrl+Z). Devolve false se foi interrompido. */
  public async dormir(ms: number): Promise<boolean> {
    let restante: number = ms;
    while (restante > 0) {
      if (this.interrompido()) return false;
      const passo: number = Math.min(100, restante);
      await new Promise((resolver) => setTimeout(resolver, passo));
      if (!(this.processo?.estaPausado() ?? false)) restante -= passo;
    }
    return !this.interrompido();
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
