import { ErroDeSintaxe } from './Analisador';

/** Um pedaço de script: um comando comum ou uma estrutura de controle. */
export type Instrucao =
  | { tipo: 'comando'; texto: string }
  | { tipo: 'se'; ramos: Array<{ condicao: Instrucao[]; corpo: Instrucao[] }>; senao: Instrucao[] | null }
  | { tipo: 'para'; variavel: string; lista: string | null; corpo: Instrucao[] }
  | { tipo: 'enquanto'; ate: boolean; condicao: Instrucao[]; corpo: Instrucao[] };

type Item = { palavraChave: string } | { comando: string };

const CHAVES: string[] = ['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done'];
/** Palavras-chave que podem vir seguidas de um comando na mesma instrução ("then echo oi"). */
const COM_COMANDO: string[] = ['then', 'else', 'do'];

/**
 * Lê um texto (uma linha digitada ou um script inteiro) e monta as estruturas de controle
 * do bash: if/elif/else/fi, for/do/done, while/until.
 */
export class LeitorDeBlocos {
  private itens: Item[] = [];
  private posicao: number = 0;

  public ler(texto: string): Instrucao[] {
    this.itens = [];
    this.posicao = 0;
    for (const instrucao of LeitorDeBlocos.separar(texto)) {
      this.classificar(instrucao);
    }
    const lista: Instrucao[] = this.lista([]);
    if (this.posicao < this.itens.length) {
      const item: Item = this.itens[this.posicao];
      throw new ErroDeSintaxe('bash: erro de sintaxe próximo ao token inesperado `' + ('palavraChave' in item ? item.palavraChave : item.comando) + "'");
    }
    return lista;
  }

  /** Quebra em instruções por ; e quebra de linha, respeitando aspas, $( ) e comentários. */
  public static separar(texto: string): string[] {
    const partes: string[] = [];
    let atual: string = '';
    let aspas: string | null = null;
    let profundidade: number = 0;
    for (let i: number = 0; i < texto.length; i++) {
      const c: string = texto.charAt(i);
      if (aspas !== null) {
        atual += c;
        if (c === '\\' && aspas === '"' && i + 1 < texto.length) {
          atual += texto.charAt(++i);
        } else if (c === aspas) {
          aspas = null;
        }
        continue;
      }
      if (c === '\\' && texto.charAt(i + 1) === '\n') {
        i++;
        continue;
      }
      if (c === '\\' && i + 1 < texto.length) {
        atual += c + texto.charAt(++i);
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        aspas = c;
        atual += c;
        continue;
      }
      if (c === '$' && texto.charAt(i + 1) === '(') {
        profundidade++;
        atual += '$(';
        i++;
        continue;
      }
      if (c === '(' && profundidade > 0) {
        profundidade++;
      } else if (c === ')' && profundidade > 0) {
        profundidade--;
      }
      if (c === '#' && profundidade === 0 && (atual === '' || /\s$/.test(atual))) {
        while (i < texto.length && texto.charAt(i) !== '\n') i++;
        i--;
        continue;
      }
      if ((c === '\n' || (c === ';' && texto.charAt(i + 1) !== ';')) && profundidade === 0) {
        if (atual.trim() !== '') partes.push(atual.trim());
        atual = '';
        continue;
      }
      atual += c;
    }
    if (aspas !== null) {
      throw new ErroDeSintaxe('bash: erro de sintaxe: fim inesperado do arquivo (aspas ' + aspas + ' sem fechamento)');
    }
    if (atual.trim() !== '') partes.push(atual.trim());
    return partes;
  }

  private classificar(instrucao: string): void {
    const primeira: string = instrucao.split(/\s+/)[0];
    if (!CHAVES.includes(primeira)) {
      this.itens.push({ comando: instrucao });
      return;
    }
    const resto: string = instrucao.substring(primeira.length).trim();
    if (primeira === 'for' || primeira === 'while' || primeira === 'until' || primeira === 'if' || primeira === 'elif') {
      this.itens.push({ palavraChave: primeira });
      if (resto !== '') this.itens.push({ comando: resto });
      return;
    }
    this.itens.push({ palavraChave: primeira });
    if (resto !== '') {
      if (!COM_COMANDO.includes(primeira)) {
        throw new ErroDeSintaxe('bash: erro de sintaxe próximo ao token inesperado `' + resto.split(/\s+/)[0] + "'");
      }
      this.classificar(resto);
    }
  }

  private lista(terminadores: string[]): Instrucao[] {
    const instrucoes: Instrucao[] = [];
    while (this.posicao < this.itens.length) {
      const item: Item = this.itens[this.posicao];
      if ('palavraChave' in item) {
        if (terminadores.includes(item.palavraChave)) return instrucoes;
        this.posicao++;
        switch (item.palavraChave) {
          case 'if': instrucoes.push(this.se()); break;
          case 'for': instrucoes.push(this.para()); break;
          case 'while':
          case 'until': instrucoes.push(this.enquanto(item.palavraChave === 'until')); break;
          default:
            throw new ErroDeSintaxe('bash: erro de sintaxe próximo ao token inesperado `' + item.palavraChave + "'");
        }
      } else {
        instrucoes.push({ tipo: 'comando', texto: item.comando });
        this.posicao++;
      }
    }
    if (terminadores.length > 0) {
      throw new ErroDeSintaxe('bash: erro de sintaxe: fim inesperado do arquivo (faltou `' + terminadores[terminadores.length - 1] + "')");
    }
    return instrucoes;
  }

  private esperar(palavra: string): void {
    const item: Item | undefined = this.itens[this.posicao];
    if (item === undefined || !('palavraChave' in item) || item.palavraChave !== palavra) {
      throw new ErroDeSintaxe('bash: erro de sintaxe: esperava `' + palavra + "'");
    }
    this.posicao++;
  }

  private se(): Instrucao {
    const ramos: Array<{ condicao: Instrucao[]; corpo: Instrucao[] }> = [];
    let condicao: Instrucao[] = this.lista(['then']);
    this.esperar('then');
    let corpo: Instrucao[] = this.lista(['elif', 'else', 'fi']);
    ramos.push({ condicao, corpo });
    let senao: Instrucao[] | null = null;
    for (;;) {
      const item: Item = this.itens[this.posicao] as Item;
      const chave: string = 'palavraChave' in item ? item.palavraChave : '';
      this.posicao++;
      if (chave === 'elif') {
        condicao = this.lista(['then']);
        this.esperar('then');
        corpo = this.lista(['elif', 'else', 'fi']);
        ramos.push({ condicao, corpo });
      } else if (chave === 'else') {
        senao = this.lista(['fi']);
        this.esperar('fi');
        break;
      } else {
        break;
      }
    }
    return { tipo: 'se', ramos, senao };
  }

  private para(): Instrucao {
    const cabecalho: Item | undefined = this.itens[this.posicao];
    if (cabecalho === undefined || !('comando' in cabecalho)) {
      throw new ErroDeSintaxe('bash: erro de sintaxe: esperava o nome da variável depois de `for\'');
    }
    this.posicao++;
    const partes: RegExpMatchArray | null = cabecalho.comando.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+in(?:\s+(.*))?)?$/s);
    if (partes === null) {
      throw new ErroDeSintaxe('bash: `' + cabecalho.comando + '\': não é um identificador válido');
    }
    this.esperar('do');
    const corpo: Instrucao[] = this.lista(['done']);
    this.esperar('done');
    const temIn: boolean = /\s+in\b/.test(cabecalho.comando);
    return { tipo: 'para', variavel: partes[1], lista: temIn ? (partes[2] ?? '') : null, corpo };
  }

  private enquanto(ate: boolean): Instrucao {
    const condicao: Instrucao[] = this.lista(['do']);
    this.esperar('do');
    const corpo: Instrucao[] = this.lista(['done']);
    this.esperar('done');
    return { tipo: 'enquanto', ate, condicao, corpo };
  }
}
