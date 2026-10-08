/** Uma palavra já sem aspas; "coringas" marca quais * e ? vieram fora de aspas (e podem expandir). */
export interface Palavra {
  texto: string;
  coringas: boolean[];
  /** Começa com NOME= fora de aspas: é uma atribuição de variável (VAR=valor). */
  atribuicao: boolean;
  /** Tinha { } fora de aspas: pode ter expansão de chaves ({a,b} ou {1..5}). */
  chaves: boolean;
}

export type TipoRedirecionamento = '>' | '>>' | '2>' | '2>>' | '&>' | '<' | '2>&1' | '>&2';

export interface Redirecionamento {
  tipo: TipoRedirecionamento;
  alvo: Palavra | null;
}

export interface ComandoSimples {
  palavras: Palavra[];
  redirecionamentos: Redirecionamento[];
}

/** Comandos ligados por |, e como esta pipeline se liga à anterior (;, && ou ||). */
export interface Pipeline {
  conector: ';' | '&&' | '||';
  comandos: ComandoSimples[];
  /** Terminou com &: roda em segundo plano. */
  fundo: boolean;
  /** Texto original (para o "jobs" e o "ps" mostrarem). */
  texto: string;
}

/** De onde o analisador tira $HOME, $1, ~maria etc. */
export interface Ambiente {
  variavel(nome: string): string | undefined;
  homeDe(usuario: string | null): string | undefined;
}

export class ErroDeSintaxe extends Error {}

type Token = { tipo: 'palavra'; palavra: Palavra; inicio: number } | { tipo: 'op'; op: string; inicio: number };

const REDIRECIONAMENTOS: string[] = ['>', '>>', '2>', '2>>', '&>', '<'];
const SEM_ALVO: string[] = ['2>&1', '>&2'];

/**
 * Transforma a linha digitada em pipelines, como o bash faz antes de executar:
 * aspas, escapes, variáveis, ~, operadores ; & && || | e redirecionamentos.
 */
export class Analisador {
  private readonly ambiente: Ambiente;

  constructor(ambiente: Ambiente) {
    this.ambiente = ambiente;
  }

  public analisar(linha: string): Pipeline[] {
    const tokens: Token[] = this.tokenizar(linha);
    const pipelines: Pipeline[] = [];
    let conector: ';' | '&&' | '||' = ';';
    let comandos: ComandoSimples[] = [];
    let atual: ComandoSimples = { palavras: [], redirecionamentos: [] };
    let inicioPipeline: number = 0;

    const vazio = (c: ComandoSimples): boolean => c.palavras.length === 0 && c.redirecionamentos.length === 0;
    const inesperado = (op: string): ErroDeSintaxe =>
      new ErroDeSintaxe('bash: erro de sintaxe próximo ao token inesperado `' + op + "'");

    for (let i: number = 0; i < tokens.length; i++) {
      const token: Token = tokens[i];
      if (token.tipo === 'palavra') {
        atual.palavras.push(token.palavra);
        continue;
      }
      if (SEM_ALVO.includes(token.op)) {
        atual.redirecionamentos.push({ tipo: token.op as TipoRedirecionamento, alvo: null });
        continue;
      }
      if (REDIRECIONAMENTOS.includes(token.op)) {
        const alvo: Token | undefined = tokens[i + 1];
        if (alvo === undefined || alvo.tipo !== 'palavra') {
          throw inesperado(alvo === undefined ? 'newline' : alvo.op);
        }
        atual.redirecionamentos.push({ tipo: token.op as TipoRedirecionamento, alvo: alvo.palavra });
        i++;
        continue;
      }
      if (vazio(atual)) {
        throw inesperado(token.op);
      }
      comandos.push(atual);
      atual = { palavras: [], redirecionamentos: [] };
      if (token.op !== '|') {
        pipelines.push({ conector, comandos, fundo: token.op === '&', texto: linha.substring(inicioPipeline, token.inicio).trim() });
        comandos = [];
        conector = token.op === '&&' || token.op === '||' ? token.op : ';';
        inicioPipeline = token.inicio + token.op.length;
      }
    }
    if (!vazio(atual)) {
      comandos.push(atual);
    } else if (comandos.length > 0 || conector !== ';') {
      throw inesperado('newline');
    }
    if (comandos.length > 0) {
      pipelines.push({ conector, comandos, fundo: false, texto: linha.substring(inicioPipeline).trim() });
    }
    return pipelines;
  }

  private tokenizar(linha: string): Token[] {
    const tokens: Token[] = [];
    let texto: string = '';
    let coringas: boolean[] = [];
    let emPalavra: boolean = false;
    let entreAspas: boolean = false;
    let chaves: boolean = false;
    let inicio: number = 0;

    const acrescentar = (trecho: string, livre: boolean): void => {
      if (!emPalavra) inicio = posicao;
      for (const letra of trecho) {
        texto += letra;
        coringas.push(livre && (letra === '*' || letra === '?'));
        if (livre && (letra === '{' || letra === '}')) chaves = true;
      }
      emPalavra = true;
    };
    const fechar = (): void => {
      if (emPalavra) {
        const bruto: string = linha.substring(inicio);
        tokens.push({ tipo: 'palavra', inicio, palavra: { texto, coringas, chaves, atribuicao: /^[A-Za-z_][A-Za-z0-9_]*=/.test(bruto) } });
      }
      texto = '';
      coringas = [];
      emPalavra = false;
      entreAspas = false;
      chaves = false;
    };

    let posicao: number = 0;
    while (posicao < linha.length) {
      const c: string = linha.charAt(posicao);
      const proximo: string = linha.charAt(posicao + 1);

      if (c === ' ' || c === '\t' || c === '\n') {
        fechar();
        posicao++;
      } else if (c === '#' && !emPalavra) {
        break;
      } else if (c === ';' || c === '|' || c === '&' || c === '>' || c === '<') {
        let op: string = c;
        let inicioOp: number = posicao;
        if ((c === '|' && proximo === '|') || (c === '&' && proximo === '&') || (c === '>' && proximo === '>') ||
          (c === '&' && proximo === '>')) {
          op = c + proximo;
        }
        if (c === '>' && texto === '2' && !entreAspas && emPalavra && posicao === inicio + 1) {
          op = '2' + op;
          inicioOp = inicio;
          texto = '';
          coringas = [];
          emPalavra = false;
        }
        // 2>&1 e >&2 não têm arquivo de destino
        const fim: number = inicioOp + op.length;
        if ((op === '2>' && linha.substring(fim, fim + 2) === '&1') || (op === '>' && linha.substring(fim, fim + 2) === '&2')) {
          op += linha.substring(fim, fim + 2);
        }
        fechar();
        tokens.push({ tipo: 'op', op, inicio: inicioOp });
        posicao = inicioOp + op.length;
      } else if (c === "'") {
        const fim: number = linha.indexOf("'", posicao + 1);
        if (fim < 0) {
          throw new ErroDeSintaxe('bash: erro de sintaxe: aspas simples sem fechamento');
        }
        acrescentar(linha.substring(posicao + 1, fim), false);
        entreAspas = true;
        posicao = fim + 1;
      } else if (c === '"') {
        if (!emPalavra) inicio = posicao;
        emPalavra = true;
        posicao++;
        let fechou: boolean = false;
        while (posicao < linha.length) {
          const d: string = linha.charAt(posicao);
          if (d === '"') {
            fechou = true;
            posicao++;
            break;
          }
          if (d === '\\' && '"\\$`'.includes(linha.charAt(posicao + 1)) && posicao + 1 < linha.length) {
            acrescentar(linha.charAt(posicao + 1), false);
            posicao += 2;
          } else if (d === '$') {
            const [valor, tamanho] = this.expandirVariavel(linha, posicao);
            acrescentar(valor, false);
            posicao += tamanho;
          } else {
            acrescentar(d, false);
            posicao++;
          }
        }
        if (!fechou) {
          throw new ErroDeSintaxe('bash: erro de sintaxe: aspas duplas sem fechamento');
        }
        entreAspas = true;
      } else if (c === '\\') {
        if (posicao + 1 < linha.length) {
          acrescentar(proximo, false);
        }
        posicao += 2;
      } else if (c === '$') {
        const [valor, tamanho] = this.expandirVariavel(linha, posicao);
        acrescentar(valor, true);
        posicao += tamanho;
      } else if (c === '~' && !emPalavra) {
        const resto: RegExpMatchArray = linha.substring(posicao + 1).match(/^[a-z_][a-z0-9_-]*/) ?? [''];
        const depois: string = linha.charAt(posicao + 1 + resto[0].length);
        const home: string | undefined = depois === '' || depois === '/' || depois === ' ' || depois === ';'
          ? this.ambiente.homeDe(resto[0] === '' ? null : resto[0]) : undefined;
        if (home !== undefined) {
          acrescentar(home, false);
          posicao += 1 + resto[0].length;
        } else {
          acrescentar('~', false);
          posicao++;
        }
      } else {
        acrescentar(c, true);
        posicao++;
      }
    }
    fechar();
    return tokens;
  }

  /** $HOME, ${USER}, $1, $#, $@, $? → [valor, quantos caracteres foram consumidos]. */
  private expandirVariavel(linha: string, inicio: number): [string, number] {
    const resto: string = linha.substring(inicio + 1);
    const chaves: RegExpMatchArray | null = resto.match(/^\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[?#@*$!])\}/);
    if (chaves !== null) {
      return [this.ambiente.variavel(chaves[1]) ?? '', 1 + chaves[0].length];
    }
    const simples: RegExpMatchArray | null = resto.match(/^([A-Za-z_][A-Za-z0-9_]*|[0-9]|[?#@*$!])/);
    if (simples !== null) {
      return [this.ambiente.variavel(simples[1]) ?? '', 1 + simples[0].length];
    }
    return ['$', 1];
  }
}
