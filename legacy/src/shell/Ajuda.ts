import type { Comando } from './Comando';
import type { Contexto } from './Contexto';

/**
 * A ajuda de um comando (SPEC-027): o que `COMANDO --help`, `help COMANDO` e `man COMANDO` mostram.
 * Só vale o que o simulador realmente faz: uma opção que o comando não lê não entra na lista.
 */
export interface AjudaDoComando {
  /** O uso, sem o "Uso: " e já com o nome do comando: "ls [OPÇÃO]... [ARQUIVO]...". */
  uso: string;
  /** O que o comando faz, em uma ou duas frases. */
  descricao: string;
  /** As opções que o comando lê: ["-l", "formato longo: permissões, dono, tamanho e data"]. */
  opcoes?: Array<[string, string]>;
  /** Exemplos de uso: ["ls -la /etc", "lista tudo de /etc, inclusive os ocultos"]. */
  exemplos?: Array<[string, string]>;
  /**
   * O que o "-h" é neste comando no Linux de verdade: "ajuda" (mostra esta ajuda) ou "outra" (uma opção que o
   * comando trata, como o tamanho legível do ls -h). Ausente: o comando não tem -h, e ele segue como opção inválida.
   */
  h?: 'ajuda' | 'outra';
  /**
   * O comando passa o resto dos argumentos a outro programa ou script (sudo, xargs, bash...): "--help" só é dele
   * quando é o primeiro argumento; depois, pertence a quem recebe.
   */
  soPrimeiro?: boolean;
  /** O comando do bash que trata "--help" como texto comum (echo, printf, test, true...): a ajuda só aparece em help e man. */
  semOpcaoDeAjuda?: boolean;
}

/** Se os argumentos (sem o nome do comando) pedem a ajuda: "--help", ou "-h" onde ele é a ajuda. "--" encerra a procura. */
export function pedeAjuda(comando: Comando, args: string[]): boolean {
  const ajuda: AjudaDoComando | undefined = comando.ajuda;
  if (ajuda === undefined || ajuda.semOpcaoDeAjuda === true) {
    return false;
  }
  const ehPedido = (arg: string): boolean => arg === '--help' || (arg === '-h' && ajuda.h === 'ajuda');
  if (ajuda.soPrimeiro === true) {
    return args.length > 0 && ehPedido(args[0]);
  }
  for (const arg of args) {
    if (arg === '--') {
      return false;
    }
    if (ehPedido(arg)) {
      return true;
    }
  }
  return false;
}

/** A frase da descrição começa com maiúscula, como num manual, qualquer que seja o jeito de quem a escreveu. */
function frase(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase('pt-BR') + texto.substring(1);
}

/** Linhas em duas colunas: o que vem antes alinhado, e a explicação depois. */
function duasColunas(pares: Array<[string, string]>, recuo: string): string[] {
  const largura: number = Math.min(28, Math.max(...pares.map(([esquerda]: [string, string]) => esquerda.length)));
  return pares.map(([esquerda, direita]: [string, string]): string => {
    // Uma coluna muito comprida não empurra a explicação para longe: ela vai para a linha de baixo.
    if (esquerda.length > largura) {
      return recuo + esquerda + '\n' + recuo + ' '.repeat(largura + 2) + direita;
    }
    return recuo + esquerda.padEnd(largura + 2) + direita;
  });
}

/** `COMANDO --help`: o uso, a descrição, as opções e os exemplos. */
export function mostrarAjuda(comando: Comando, contexto: Contexto): void {
  const ajuda: AjudaDoComando | undefined = comando.ajuda;
  if (ajuda === undefined) {
    contexto.linha(comando.nome + ' - ' + comando.resumo);
    return;
  }
  contexto.linha('Uso: ' + ajuda.uso);
  contexto.linha(frase(ajuda.descricao));
  if (ajuda.opcoes !== undefined && ajuda.opcoes.length > 0) {
    contexto.linha();
    contexto.linha('Opções:', 'c-negrito');
    for (const linha of duasColunas(ajuda.opcoes, '  ')) {
      contexto.linha(linha);
    }
  }
  if (ajuda.exemplos !== undefined && ajuda.exemplos.length > 0) {
    contexto.linha();
    contexto.linha('Exemplos:', 'c-negrito');
    for (const linha of duasColunas(ajuda.exemplos, '  ')) {
      contexto.linha(linha);
    }
  }
}

/** `man COMANDO`: as mesmas informações, no formato de página de manual. */
export function mostrarManual(comando: Comando, contexto: Contexto): void {
  const ajuda: AjudaDoComando | undefined = comando.ajuda;
  contexto.linha(comando.nome.toUpperCase() + '(1)', 'c-negrito');
  contexto.linha();
  contexto.linha('NOME', 'c-negrito');
  contexto.linha('       ' + comando.nome + ' - ' + comando.resumo);
  if (ajuda !== undefined) {
    contexto.linha();
    contexto.linha('SINOPSE', 'c-negrito');
    contexto.linha('       ' + ajuda.uso);
    contexto.linha();
    contexto.linha('DESCRIÇÃO', 'c-negrito');
    contexto.linha('       ' + frase(ajuda.descricao));
    if (ajuda.opcoes !== undefined && ajuda.opcoes.length > 0) {
      contexto.linha();
      contexto.linha('OPÇÕES', 'c-negrito');
      for (const linha of duasColunas(ajuda.opcoes, '       ')) {
        contexto.linha(linha);
      }
    }
    if (ajuda.exemplos !== undefined && ajuda.exemplos.length > 0) {
      contexto.linha();
      contexto.linha('EXEMPLOS', 'c-negrito');
      for (const linha of duasColunas(ajuda.exemplos, '       ')) {
        contexto.linha(linha);
      }
    }
  }
  contexto.linha();
  contexto.linha('(Resumo do simulador. No Ubuntu real, o man abre o manual completo: setas rolam, / pesquisa e q sai.)', 'c-info');
}
