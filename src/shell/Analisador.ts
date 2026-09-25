/** Uma palavra já sem aspas; "coringas" marca quais * e ? vieram fora de aspas (e podem expandir). */
export interface Palavra {
  texto: string;
  coringas: boolean[];
}

export type TipoRedirecionamento = '>' | '>>' | '2>' | '2>>' | '&>' | '<';

export interface Redirecionamento {
  tipo: TipoRedirecionamento;
  alvo: Palavra;
}

export interface ComandoSimples {
  palavras: Palavra[];
  redirecionamentos: Redirecionamento[];
}

/** Comandos ligados por |, e como esta pipeline se liga à anterior (;, && ou ||). */
export interface Pipeline {
  conector: ';' | '&&' | '||';
  comandos: ComandoSimples[];
}

/** De onde o analisador tira $HOME, $USER, ~maria etc. */
export interface Ambiente {
  variavel(nome: string): string | undefined;
  homeDe(usuario: string | null): string | undefined;
}

export class ErroDeSintaxe extends Error {}

type Token = { tipo: 'palavra'; palavra: Palavra } | { tipo: 'op'; op: string };

const OPERADORES_DE_REDIRECIONAMENTO: string[] = ['>', '>>', '2>', '2>>', '&>', '<'];

/**
 * Transforma a linha digitada em pipelines, como o bash faz antes de executar:
 * aspas, escapes, variáveis, ~, operadores ; && || | e redirecionamentos.
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

    const vazio = (c: ComandoSimples): boolean => c.palavras.length === 0 && c.redirecionamentos.length === 0;
    const inesperado = (op: string): ErroDeSintaxe =>
      new ErroDeSintaxe('bash: erro de sintaxe próximo ao token inesperado `' + op + "'");

    for (let i: number = 0; i < tokens.length; i++) {
      const token: Token = tokens[i];
      if (token.tipo === 'palavra') {
        atual.palavras.push(token.palavra);
        continue;
      }
      if (OPERADORES_DE_REDIRECIONAMENTO.includes(token.op)) {
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
        pipelines.push({ conector, comandos });
        comandos = [];
        conector = token.op === '&&' || token.op === '||' ? token.op : ';';
      }
    }
    if (!vazio(atual)) {
      comandos.push(atual);
    } else if (comandos.length > 0 || conector !== ';') {
      throw inesperado('newline');
    }
    if (comandos.length > 0) {
      pipelines.push({ conector, comandos });
    }
    return pipelines;
  }

  private tokenizar(linha: string): Token[] {
    const tokens: Token[] = [];
    let texto: string = '';
    let coringas: boolean[] = [];
    let emPalavra: boolean = false;
    let entreAspas: boolean = false;

    const acrescentar = (trecho: string, coringa: boolean): void => {
      for (const letra of trecho) {
        texto += letra;
        coringas.push(coringa && (letra === '*' || letra === '?'));
      }
      emPalavra = true;
    };
    const fechar = (): void => {
      if (emPalavra) {
        tokens.push({ tipo: 'palavra', palavra: { texto, coringas } });
      }
      texto = '';
      coringas = [];
      emPalavra = false;
      entreAspas = false;
    };

    let i: number = 0;
    while (i < linha.length) {
      const c: string = linha.charAt(i);
      const proximo: string = linha.charAt(i + 1);

      if (c === ' ' || c === '\t') {
        fechar();
        i++;
      } else if (c === '#' && !emPalavra) {
        break;
      } else if (c === ';' || c === '|' || c === '&' || c === '>' || c === '<') {
        let op: string = c;
        if ((c === '|' && proximo === '|') || (c === '&' && proximo === '&') || (c === '>' && proximo === '>') ||
          (c === '&' && proximo === '>')) {
          op = c + proximo;
        }
        if (c === '>' && texto === '2' && !entreAspas && emPalavra) {
          op = '2' + op;
          texto = '';
          coringas = [];
          emPalavra = false;
        }
        fechar();
        tokens.push({ tipo: 'op', op: op === '&' ? ';' : op });
        i += op.length - (op.startsWith('2') ? 1 : 0);
      } else if (c === "'") {
        const fim: number = linha.indexOf("'", i + 1);
        if (fim < 0) {
          throw new ErroDeSintaxe('bash: erro de sintaxe: aspas simples sem fechamento');
        }
        acrescentar(linha.substring(i + 1, fim), false);
        entreAspas = true;
        i = fim + 1;
      } else if (c === '"') {
        i++;
        let fechou: boolean = false;
        while (i < linha.length) {
          const d: string = linha.charAt(i);
          if (d === '"') {
            fechou = true;
            i++;
            break;
          }
          if (d === '\\' && '"\\$`'.includes(linha.charAt(i + 1)) && i + 1 < linha.length) {
            acrescentar(linha.charAt(i + 1), false);
            i += 2;
          } else if (d === '$') {
            const [valor, tamanho] = this.expandirVariavel(linha, i);
            acrescentar(valor, false);
            i += tamanho;
          } else {
            acrescentar(d, false);
            i++;
          }
        }
        if (!fechou) {
          throw new ErroDeSintaxe('bash: erro de sintaxe: aspas duplas sem fechamento');
        }
        emPalavra = true;
        entreAspas = true;
      } else if (c === '\\') {
        if (i + 1 < linha.length) {
          acrescentar(proximo, false);
        }
        i += 2;
      } else if (c === '$') {
        const [valor, tamanho] = this.expandirVariavel(linha, i);
        acrescentar(valor, false);
        i += tamanho;
      } else if (c === '~' && !emPalavra) {
        const resto: RegExpMatchArray = linha.substring(i + 1).match(/^[a-z_][a-z0-9_-]*/) ?? [''];
        const depois: string = linha.charAt(i + 1 + resto[0].length);
        const home: string | undefined = depois === '' || depois === '/' || depois === ' ' || depois === ';'
          ? this.ambiente.homeDe(resto[0] === '' ? null : resto[0]) : undefined;
        if (home !== undefined) {
          acrescentar(home, false);
          i += 1 + resto[0].length;
        } else {
          acrescentar('~', false);
          i++;
        }
      } else {
        acrescentar(c, true);
        i++;
      }
    }
    fechar();
    return tokens;
  }

  /** $HOME, ${USER}, $? → [valor, quantos caracteres foram consumidos]. */
  private expandirVariavel(linha: string, inicio: number): [string, number] {
    const resto: string = linha.substring(inicio + 1);
    const chaves: RegExpMatchArray | null = resto.match(/^\{([A-Za-z_][A-Za-z0-9_]*|\?)\}/);
    if (chaves !== null) {
      return [this.ambiente.variavel(chaves[1]) ?? '', 1 + chaves[0].length];
    }
    const simples: RegExpMatchArray | null = resto.match(/^([A-Za-z_][A-Za-z0-9_]*|\?)/);
    if (simples !== null) {
      return [this.ambiente.variavel(simples[1]) ?? '', 1 + simples[0].length];
    }
    return ['$', 1];
  }
}
