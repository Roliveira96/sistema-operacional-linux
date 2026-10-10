import { ErroDeSintaxe } from './Analisador';

/** Um pedaço de script: um comando comum ou uma estrutura de controle. */
export type Instrucao =
  | { tipo: 'comando'; texto: string }
  | { tipo: 'se'; ramos: Array<{ condicao: Instrucao[]; corpo: Instrucao[] }>; senao: Instrucao[] | null }
  | { tipo: 'para'; variavel: string; lista: string | null; corpo: Instrucao[] }
  | { tipo: 'enquanto'; ate: boolean; condicao: Instrucao[]; corpo: Instrucao[] };

type Item = { palavraChave: string } | { comando: string };

/**
 * Os corpos dos heredocs (`cat << 'EOF' ... EOF`) de um script. Quem lê o script troca o `<<EOF` por `< chave` e guarda
 * aqui o texto das linhas seguintes; na hora de rodar, o `<` com essa chave entrega o corpo como a entrada do comando.
 */
export class Heredocs {
  private static readonly corpos: Map<string, { corpo: string; literal: boolean }> = new Map();
  private static contador: number = 0;
  private static readonly CHAVE: RegExp = /\u0001H\d+\u0001/;

  public static reservar(): string {
    return '\u0001H' + ++Heredocs.contador + '\u0001';
  }

  /** literal: o delimitador veio entre aspas ('EOF' ou "EOF"), então o corpo não expande variáveis. */
  public static definir(chave: string, corpo: string, literal: boolean): void {
    Heredocs.corpos.set(chave, { corpo, literal });
  }

  public static obter(chave: string): { corpo: string; literal: boolean } | undefined {
    return Heredocs.corpos.get(chave);
  }

  /** A chave de heredoc que o texto contém, ou null. */
  public static chaveEm(texto: string): string | null {
    return Heredocs.CHAVE.exec(texto)?.[0] ?? null;
  }
}

/** Um heredoc visto numa linha, ainda sem o corpo (que vem nas linhas seguintes). */
interface HeredocPendente {
  chave: string;
  delimitador: string;
  /** <<-: tira os TABs do começo de cada linha do corpo e do delimitador. */
  tirarTabs: boolean;
  literal: boolean;
}

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
    const pendentes: HeredocPendente[] = [];
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
      // cat << 'EOF' > arquivo: o operador vira "< chave" e o corpo (as linhas até o delimitador) fica guardado
      if (c === '<' && texto.charAt(i + 1) === '<' && texto.charAt(i + 2) !== '<' && profundidade === 0) {
        const lido: RegExpExecArray | null = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;&|<>()'"]+))/.exec(texto.substring(i));
        if (lido !== null) {
          const chave: string = Heredocs.reservar();
          pendentes.push({ chave, delimitador: lido[2] ?? lido[3] ?? lido[4] ?? '', tirarTabs: lido[1] === '-', literal: lido[2] !== undefined || lido[3] !== undefined });
          atual += '< ' + chave;
          i += lido[0].length - 1;
          continue;
        }
      }
      if (c === '#' && profundidade === 0 && (atual === '' || /\s$/.test(atual))) {
        while (i < texto.length && texto.charAt(i) !== '\n') i++;
        i--;
        continue;
      }
      if ((c === '\n' || (c === ';' && texto.charAt(i + 1) !== ';')) && profundidade === 0) {
        if (atual.trim() !== '') partes.push(atual.trim());
        atual = '';
        if (c === '\n' && pendentes.length > 0) {
          i = LeitorDeBlocos.lerCorpos(texto, i + 1, pendentes) - 1;
          pendentes.length = 0;
        }
        continue;
      }
      atual += c;
    }
    // heredoc na última linha, sem corpo: fica vazio
    LeitorDeBlocos.lerCorpos(texto, texto.length, pendentes);
    if (aspas !== null) {
      throw new ErroDeSintaxe('bash: erro de sintaxe: fim inesperado do arquivo (aspas ' + aspas + ' sem fechamento)');
    }
    if (atual.trim() !== '') partes.push(atual.trim());
    return partes;
  }

  /** Lê, a partir de `inicio`, o corpo de cada heredoc pendente (até a linha do delimitador) e devolve onde parou. */
  private static lerCorpos(texto: string, inicio: number, pendentes: HeredocPendente[]): number {
    let posicao: number = inicio;
    for (const pendente of pendentes) {
      const linhas: string[] = [];
      while (posicao < texto.length) {
        let fim: number = texto.indexOf('\n', posicao);
        if (fim < 0) fim = texto.length;
        const bruta: string = texto.substring(posicao, fim);
        posicao = fim + 1;
        const linha: string = pendente.tirarTabs ? bruta.replace(/^\t+/, '') : bruta;
        if (linha === pendente.delimitador) break;
        linhas.push(linha);
      }
      Heredocs.definir(pendente.chave, linhas.length > 0 ? linhas.join('\n') + '\n' : '', pendente.literal);
    }
    return Math.min(posicao, texto.length);
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
