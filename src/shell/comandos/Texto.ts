import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { lerEntradas, linhasDe, mensagemDe, saidaEhTerminal } from './util';
import { Arquivo, Binario, Diretorio, Dispositivo, type No } from '../../linux/No';

/** "-5" vira "-n 5", como head e tail aceitam. */
function normalizarNumero(args: string[]): string[] {
  return args.flatMap((arg: string) => /^-\d+$/.test(arg) ? ['-n', arg.substring(1)] : [arg]);
}

abstract class Fatiador extends Comando {
  protected abstract fatiar(linhas: string[], quantidade: number): string[];

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(normalizarNumero(args), 'n', { lines: 'n' });
    const quantidade: number = Number(opcoes.valor('n') ?? '10');
    const entradas = lerEntradas(this.nome, opcoes.operandos, contexto);
    if (entradas === null) {
      return 1;
    }
    entradas.forEach((entrada, indice: number) => {
      if (entradas.length > 1) {
        contexto.linha((indice > 0 ? '\n' : '') + '==> ' + entrada.nome + ' <==');
      }
      for (const linha of this.fatiar(linhasDe(entrada.texto), quantidade)) {
        contexto.linha(linha);
      }
    });
    return 0;
  }
}

export class Head extends Fatiador {
  public readonly nome: string = 'head';
  public readonly resumo: string = 'mostra as primeiras linhas (padrão 10; -n 3 para três)';

  protected fatiar(linhas: string[], quantidade: number): string[] {
    return linhas.slice(0, quantidade);
  }
}

export class Tail extends Fatiador {
  public readonly nome: string = 'tail';
  public readonly resumo: string = 'mostra as últimas linhas (padrão 10; -n 3 para três)';

  protected fatiar(linhas: string[], quantidade: number): string[] {
    return quantidade === 0 ? [] : linhas.slice(-quantidade);
  }
}

export class Wc extends Comando {
  public readonly nome: string = 'wc';
  public readonly resumo: string = 'conta linhas (-l), palavras (-w) e bytes (-c)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { lines: 'l', words: 'w', bytes: 'c' });
    const entradas = lerEntradas('wc', opcoes.operandos, contexto);
    if (entradas === null) {
      return 1;
    }
    const todas: boolean = !opcoes.tem('l', 'w', 'c');
    const totais: number[] = [0, 0, 0];
    const linhas: Array<[number[], string]> = [];
    for (const entrada of entradas) {
      const numeros: number[] = [
        (entrada.texto.match(/\n/g) ?? []).length,
        entrada.texto.split(/\s+/).filter((p: string) => p !== '').length,
        new TextEncoder().encode(entrada.texto).length,
      ];
      numeros.forEach((n: number, i: number) => { totais[i] += n; });
      linhas.push([numeros, entrada.nome ?? '']);
    }
    if (entradas.length > 1) {
      linhas.push([totais, 'total']);
    }
    const escolhidas: number[] = [0, 1, 2].filter((i: number) => todas || opcoes.tem(['l', 'w', 'c'][i]));
    const largura: number = escolhidas.length === 1 && entradas.length === 1 ? 0 : String(Math.max(...totais)).length;
    for (const [numeros, nome] of linhas) {
      const colunas: string = escolhidas.map((i: number) => String(numeros[i]).padStart(largura)).join(' ');
      contexto.linha(nome === '' ? colunas : colunas + ' ' + nome);
    }
    return 0;
  }
}

export class Grep extends Comando {
  public readonly nome: string = 'grep';
  public readonly resumo: string = 'filtra linhas que contêm um texto (-i ignora maiúsculas, -v inverte, -n numera, -c conta, -r em pastas, -l só nomes)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'e', {
      'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', recursive: 'r', 'files-with-matches': 'l', 'word-regexp': 'w',
    });
    if (opcoes.valor('e') !== undefined) opcoes.operandos.unshift(opcoes.valor('e') as string);
    if (opcoes.operandos.length === 0) {
      contexto.falhar('Uso: grep [OPÇÃO]... PADRÕES [ARQUIVO]...');
      contexto.falhar("Experimente 'grep --help' para mais informações.");
      return 2;
    }
    const [padrao, ...arquivos] = opcoes.operandos;
    let fonte: string = opcoes.tem('F') ? padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : padrao;
    if (opcoes.tem('w')) fonte = '\\b(?:' + fonte + ')\\b';
    let regex: RegExp;
    try {
      regex = new RegExp(fonte, opcoes.tem('i') ? 'gi' : 'g');
    } catch {
      regex = new RegExp(padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opcoes.tem('i') ? 'gi' : 'g');
    }
    const recursivo: boolean = opcoes.tem('r', 'R');
    const entradas = recursivo ? this.arquivosRecursivos(arquivos.length > 0 ? arquivos : ['.'], contexto) : lerEntradas('grep', arquivos, contexto);
    if (entradas === null) {
      return 2;
    }
    const colorir: boolean = saidaEhTerminal(contexto) && !opcoes.tem('v');
    let achou: boolean = false;
    for (const entrada of entradas) {
      const prefixo: string = entradas.length > 1 || recursivo ? entrada.nome + ':' : '';
      if (opcoes.tem('l')) {
        const casou: boolean = linhasDe(entrada.texto).some((linha: string) => { regex.lastIndex = 0; return regex.test(linha) !== opcoes.tem('v'); });
        if (casou) {
          achou = true;
          contexto.linha(entrada.nome ?? '(entrada padrão)', saidaEhTerminal(contexto) ? 'c-grep-arquivo' : undefined);
        }
        continue;
      }
      let contagem: number = 0;
      linhasDe(entrada.texto).forEach((linha: string, indice: number) => {
        regex.lastIndex = 0;
        const casou: boolean = regex.test(linha) !== opcoes.tem('v');
        if (!casou) {
          return;
        }
        achou = true;
        contagem++;
        if (opcoes.tem('c')) {
          return;
        }
        if (prefixo !== '') contexto.escrever(prefixo, 'c-grep-arquivo');
        if (opcoes.tem('n')) contexto.escrever((indice + 1) + ':', 'c-grep-numero');
        this.escreverDestacado(linha, colorir ? regex : null, contexto);
      });
      if (opcoes.tem('c')) {
        contexto.linha(prefixo + contagem);
      }
    }
    return achou ? 0 : 1;
  }

  /** grep -r: todos os arquivos legíveis dentro das pastas (e avisa onde não tem permissão). */
  private arquivosRecursivos(caminhos: string[], contexto: Contexto): Array<{ nome: string | null; texto: string }> {
    const lista: Array<{ nome: string | null; texto: string }> = [];
    const visitar = (caminho: string, no: No): void => {
      if (no instanceof Diretorio) {
        if (!contexto.fs.pode(no, contexto.credencial, 'r') || !contexto.fs.pode(no, contexto.credencial, 'x')) {
          contexto.falhar('grep: ' + caminho + ': Permissão negada');
          return;
        }
        for (const nome of no.nomesOrdenados()) visitar(caminho.replace(/\/$/, '') + '/' + nome, no.obter(nome) as No);
        return;
      }
      if (!(no instanceof Arquivo) || no instanceof Binario || no instanceof Dispositivo) return;
      if (!contexto.fs.pode(no, contexto.credencial, 'r')) {
        contexto.falhar('grep: ' + caminho + ': Permissão negada');
        return;
      }
      lista.push({ nome: caminho.replace(/^\.\//, ''), texto: no.ler() });
    };
    for (const caminho of caminhos) {
      try {
        visitar(caminho, contexto.localizar(caminho));
      } catch (erro) {
        contexto.falhar('grep: ' + caminho + ': ' + mensagemDe(erro));
      }
    }
    return lista;
  }

  private escreverDestacado(linha: string, regex: RegExp | null, contexto: Contexto): void {
    if (regex === null) {
      contexto.linha(linha);
      return;
    }
    let posicao: number = 0;
    regex.lastIndex = 0;
    for (const achado of linha.matchAll(regex)) {
      const inicio: number = achado.index ?? 0;
      if (achado[0] === '') break;
      contexto.escrever(linha.substring(posicao, inicio));
      contexto.escrever(achado[0], 'c-grep');
      posicao = inicio + achado[0].length;
    }
    contexto.linha(linha.substring(posicao));
  }
}

export class Sort extends Comando {
  public readonly nome: string = 'sort';
  public readonly resumo: string = 'ordena linhas (-r invertido, -n numérico, -u sem repetidas)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args);
    const entradas = lerEntradas('sort', opcoes.operandos, contexto);
    if (entradas === null) {
      return 2;
    }
    let linhas: string[] = entradas.flatMap((e) => linhasDe(e.texto));
    linhas.sort(opcoes.tem('n')
      ? (a: string, b: string) => parseFloat(a) - parseFloat(b)
      : (a: string, b: string) => a.localeCompare(b, 'pt-BR'));
    if (opcoes.tem('r')) linhas.reverse();
    if (opcoes.tem('u')) linhas = linhas.filter((l: string, i: number) => i === 0 || l !== linhas[i - 1]);
    for (const linha of linhas) contexto.linha(linha);
    return 0;
  }
}

export class Cut extends Comando {
  public readonly nome: string = 'cut';
  public readonly resumo: string = 'recorta colunas: cut -d: -f1 /etc/passwd lista só os nomes de usuário';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'df', { delimiter: 'd', fields: 'f' });
    const campos: string | undefined = opcoes.valor('f');
    if (campos === undefined) {
      contexto.falhar('cut: você deve especificar uma lista de bytes, caracteres ou campos');
      return 1;
    }
    const delimitador: string = opcoes.valor('d') ?? '\t';
    const escolhidos: Set<number> = new Set();
    for (const parte of campos.split(',')) {
      const [inicio, fim] = parte.split('-');
      const de: number = Number(inicio || '1');
      const ate: number = parte.includes('-') ? Number(fim || '99') : de;
      for (let n: number = de; n <= ate; n++) escolhidos.add(n);
    }
    const entradas = lerEntradas('cut', opcoes.operandos, contexto);
    if (entradas === null) {
      return 1;
    }
    for (const entrada of entradas) {
      for (const linha of linhasDe(entrada.texto)) {
        const colunas: string[] = linha.split(delimitador);
        contexto.linha(colunas.length === 1 ? linha : colunas.filter((_c: string, i: number) => escolhidos.has(i + 1)).join(delimitador));
      }
    }
    return 0;
  }
}
