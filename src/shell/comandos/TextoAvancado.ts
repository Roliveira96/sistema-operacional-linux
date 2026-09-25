import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { Arquivo, type No } from '../../linux/No';
import { ErroDeSistema } from '../../linux/ErroDeSistema';
import { Interpretador } from '../Interpretador';
import { lerEntradas, linhasDe, mensagemDe } from './util';

export class Tee extends Comando {
  public readonly nome: string = 'tee';
  public readonly resumo: string = 'grava a entrada em arquivo E mostra na tela: comando | tee log.txt (-a acrescenta)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { append: 'a' });
    const texto: string = contexto.entrada ?? '';
    let status: number = 0;
    for (const caminho of opcoes.operandos) {
      try {
        Interpretador.abrirParaEscrita(caminho, !opcoes.tem('a'), contexto.maquina, contexto.sessao, contexto.credencial).acrescentar(texto);
      } catch (erro) {
        contexto.falhar('tee: ' + caminho + ': ' + mensagemDe(erro));
        status = 1;
      }
    }
    contexto.escrever(texto);
    return status;
  }
}

export class Xargs extends Comando {
  public readonly nome: string = 'xargs';
  public readonly resumo: string = 'transforma a entrada em argumentos: find . -name "*.log" | xargs rm  (-I {} para posicionar)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let substituir: string | null = null;
    let porVez: number = 0;
    let i: number = 0;
    for (; i < args.length; i++) {
      if (args[i] === '-I') substituir = args[++i] ?? '{}';
      else if (args[i] === '-n') porVez = Number(args[++i] ?? '0');
      else if (args[i] === '-0' || args[i] === '-r') continue;
      else break;
    }
    const comando: string[] = args.slice(i).length > 0 ? args.slice(i) : ['echo'];
    const itens: string[] = substituir !== null
      ? linhasDe(contexto.entrada ?? '').filter((l: string) => l.trim() !== '')
      : (contexto.entrada ?? '').split(/\s+/).filter((p: string) => p !== '');
    if (itens.length === 0) return 0;
    let status: number = 0;
    const rodar = async (lista: string[]): Promise<void> => {
      const resultado: number = await contexto.executor.executarArgs(lista, contexto.com({ entrada: null }));
      if (resultado !== 0) status = 123;
    };
    if (substituir !== null) {
      for (const item of itens) await rodar(comando.map((parte: string) => parte.split(substituir as string).join(item)));
    } else if (porVez > 0) {
      for (let j: number = 0; j < itens.length; j += porVez) await rodar([...comando, ...itens.slice(j, j + porVez)]);
    } else {
      await rodar([...comando, ...itens]);
    }
    return status;
  }
}

export class Uniq extends Comando {
  public readonly nome: string = 'uniq';
  public readonly resumo: string = 'junta linhas repetidas SEGUIDAS (use depois do sort): sort | uniq -c conta ocorrências';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { count: 'c', repeated: 'd', unique: 'u' });
    const entradas = lerEntradas('uniq', opcoes.operandos.slice(0, 1), contexto);
    if (entradas === null) return 1;
    const grupos: Array<[string, number]> = [];
    for (const linha of linhasDe(entradas[0]?.texto ?? '')) {
      const ultimo: [string, number] | undefined = grupos[grupos.length - 1];
      if (ultimo !== undefined && ultimo[0] === linha) ultimo[1]++;
      else grupos.push([linha, 1]);
    }
    for (const [linha, quantidade] of grupos) {
      if (opcoes.tem('d') && quantidade < 2) continue;
      if (opcoes.tem('u') && quantidade > 1) continue;
      contexto.linha(opcoes.tem('c') ? String(quantidade).padStart(7) + ' ' + linha : linha);
    }
    return 0;
  }
}

export class Tr extends Comando {
  public readonly nome: string = 'tr';
  public readonly resumo: string = 'troca ou apaga caracteres: tr a-z A-Z (maiúsculas) | tr -d ":" | tr -s " "';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { delete: 'd', 'squeeze-repeats': 's' });
    const expandir = (conjunto: string): string[] => {
      const classes: Record<string, string> = { '[:lower:]': 'a-z', '[:upper:]': 'A-Z', '[:digit:]': '0-9', '[:space:]': ' \t\n' };
      let texto: string = conjunto;
      for (const [classe, valor] of Object.entries(classes)) texto = texto.split(classe).join(valor);
      texto = texto.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      const saida: string[] = [];
      for (let i: number = 0; i < texto.length; i++) {
        if (texto.charAt(i + 1) === '-' && i + 2 < texto.length) {
          for (let c: number = texto.charCodeAt(i); c <= texto.charCodeAt(i + 2); c++) saida.push(String.fromCharCode(c));
          i += 2;
        } else {
          saida.push(texto.charAt(i));
        }
      }
      return saida;
    };
    const [primeiro, segundo] = opcoes.operandos;
    if (primeiro === undefined) {
      contexto.falhar('tr: falta operando');
      return 1;
    }
    const de: string[] = expandir(primeiro);
    const para: string[] = segundo !== undefined ? expandir(segundo) : [];
    let resultado: string = '';
    for (const c of contexto.entrada ?? '') {
      const i: number = de.indexOf(c);
      if (i < 0) resultado += c;
      else if (opcoes.tem('d')) continue;
      else resultado += para.length > 0 ? para[Math.min(i, para.length - 1)] : c;
    }
    if (opcoes.tem('s')) {
      const alvo: string[] = para.length > 0 ? para : de;
      resultado = resultado.replace(/(.)\1+/g, (trecho: string, c: string) => alvo.includes(c) ? c : trecho);
    }
    contexto.escrever(resultado);
    return 0;
  }
}

/** Converte regex "básica" do sed/grep (\( \) \+ literais) para a do JavaScript. */
function regexBasica(texto: string, estendida: boolean): string {
  if (estendida) return texto;
  let saida: string = '';
  for (let i: number = 0; i < texto.length; i++) {
    const c: string = texto.charAt(i);
    if (c === '\\' && i + 1 < texto.length) {
      const d: string = texto.charAt(++i);
      saida += '(){}+?|'.includes(d) ? d : '\\' + d;
    } else if ('(){}+?|'.includes(c)) {
      saida += '\\' + c;
    } else {
      saida += c;
    }
  }
  return saida;
}

type ComandoSed =
  | { tipo: 's'; regex: RegExp; troca: string; global: boolean; imprimir: boolean; endereco: Endereco | null }
  | { tipo: 'd' | 'p'; endereco: Endereco | null };

type Endereco = { tipo: 'linha'; n: number | '$'; ate?: number | '$' } | { tipo: 'regex'; regex: RegExp };

export class Sed extends Comando {
  public readonly nome: string = 'sed';
  public readonly resumo: string = "edita texto em fluxo: sed 's/velho/novo/g' arq | sed -i (altera o arquivo) | sed '/padrão/d'";

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'e', { 'in-place': 'i', quiet: 'n', expression: 'e', 'regexp-extended': 'E' });
    const operandos: string[] = opcoes.operandos.slice();
    const script: string | undefined = opcoes.valor('e') ?? operandos.shift();
    if (script === undefined) {
      contexto.falhar('Uso: sed [OPÇÃO]... {script} [ARQUIVO]...');
      return 1;
    }
    let comandos: ComandoSed[];
    try {
      comandos = this.compilar(script, opcoes.tem('E', 'r'));
    } catch (erro) {
      contexto.falhar('sed: -e expressão #1, caractere 1: ' + (erro instanceof Error ? erro.message : 'comando desconhecido'));
      return 1;
    }
    const processar = (texto: string): string => this.aplicar(comandos, linhasDe(texto), opcoes.tem('n'));
    if (opcoes.tem('i')) {
      let status: number = 0;
      for (const caminho of operandos) {
        try {
          const no: No = contexto.localizar(caminho);
          if (!(no instanceof Arquivo)) throw new ErroDeSistema('EISDIR');
          if (!contexto.fs.pode(no, contexto.credencial, 'r') || !contexto.fs.pode(no, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
          no.escrever(processar(no.ler()));
        } catch (erro) {
          contexto.falhar('sed: não foi possível editar ' + caminho + ': ' + mensagemDe(erro));
          status = 4;
        }
      }
      return status;
    }
    const entradas = lerEntradas('sed', operandos, contexto);
    if (entradas === null) return 2;
    contexto.escrever(processar(entradas.map((e) => e.texto).join('')));
    return 0;
  }

  private compilar(script: string, estendida: boolean): ComandoSed[] {
    const comandos: ComandoSed[] = [];
    let i: number = 0;
    const ler = (): string => script.charAt(i++);
    while (i < script.length) {
      while (i < script.length && ' ;\n'.includes(script.charAt(i))) i++;
      if (i >= script.length) break;
      let endereco: Endereco | null = null;
      if (/[0-9$]/.test(script.charAt(i))) {
        const m: RegExpMatchArray = script.substring(i).match(/^(\d+|\$)(?:,(\d+|\$))?/) as RegExpMatchArray;
        i += m[0].length;
        const n = (t: string): number | '$' => t === '$' ? '$' : Number(t);
        endereco = { tipo: 'linha', n: n(m[1]), ate: m[2] !== undefined ? n(m[2]) : undefined };
      } else if (script.charAt(i) === '/') {
        const fim: number = script.indexOf('/', i + 1);
        if (fim < 0) throw new Error('expressão regular sem fim');
        endereco = { tipo: 'regex', regex: new RegExp(regexBasica(script.substring(i + 1, fim), estendida)) };
        i = fim + 1;
      }
      const letra: string = ler();
      if (letra === 's') {
        const delim: string = ler();
        const partes: string[] = [];
        let atual: string = '';
        while (i < script.length && partes.length < 2) {
          const c: string = ler();
          if (c === '\\' && script.charAt(i) === delim) { atual += delim; i++; continue; }
          if (c === delim) { partes.push(atual); atual = ''; continue; }
          atual += c;
        }
        if (partes.length < 2) throw new Error('comando `s\' inacabado');
        let bandeiras: string = '';
        while (i < script.length && /[gip]/.test(script.charAt(i))) bandeiras += ler();
        const troca: string = partes[1].replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&').replace(/\\n/g, '\n');
        comandos.push({ tipo: 's', regex: new RegExp(regexBasica(partes[0], estendida), bandeiras.includes('g') ? 'g' + (bandeiras.includes('i') ? 'i' : '') : bandeiras.includes('i') ? 'i' : ''),
          troca, global: bandeiras.includes('g'), imprimir: bandeiras.includes('p'), endereco });
      } else if (letra === 'd' || letra === 'p') {
        comandos.push({ tipo: letra, endereco });
      } else {
        throw new Error('comando desconhecido: `' + letra + "'");
      }
    }
    return comandos;
  }

  private aplicar(comandos: ComandoSed[], linhas: string[], silencioso: boolean): string {
    let saida: string = '';
    const total: number = linhas.length;
    const casa = (endereco: Endereco | null, linha: string, numero: number): boolean => {
      if (endereco === null) return true;
      if (endereco.tipo === 'regex') return endereco.regex.test(linha);
      const valor = (v: number | '$'): number => v === '$' ? total : v;
      if (endereco.ate === undefined) return numero === valor(endereco.n);
      return numero >= valor(endereco.n) && numero <= valor(endereco.ate);
    };
    linhas.forEach((original: string, indice: number) => {
      let linha: string = original;
      let apagar: boolean = false;
      for (const comando of comandos) {
        if (!casa(comando.endereco, linha, indice + 1)) continue;
        if (comando.tipo === 'd') { apagar = true; break; }
        if (comando.tipo === 'p') { saida += linha + '\n'; continue; }
        if (comando.tipo !== 's') continue;
        const nova: string = linha.replace(comando.regex, comando.troca);
        if (comando.imprimir && nova !== linha) saida += nova + '\n';
        linha = nova;
      }
      if (!apagar && !silencioso) saida += linha + '\n';
    });
    return saida;
  }
}

/** awk "de sobrevivência": colunas ($1, $NF), -F, condições, BEGIN/END, somas e contagens. */
export class Awk extends Comando {
  public readonly nome: string = 'awk';
  public readonly resumo: string = "trabalha com colunas: awk '{print $1}' | awk -F: '{print $1, $7}' /etc/passwd | awk '{s+=$2} END {print s}'";

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'Fv', { 'field-separator': 'F' });
    const operandos: string[] = opcoes.operandos.slice();
    const programa: string | undefined = operandos.shift();
    if (programa === undefined) {
      contexto.falhar("uso: awk [-F sep] 'programa' [arquivo ...]");
      return 2;
    }
    const entradas = lerEntradas('awk', operandos, contexto);
    if (entradas === null) return 2;
    try {
      const interprete: MiniAwk = new MiniAwk(programa, opcoes.valor('F') ?? null);
      contexto.escrever(interprete.rodar(entradas.flatMap((e) => linhasDe(e.texto))));
      return 0;
    } catch (erro) {
      contexto.falhar('awk: ' + (erro instanceof Error ? erro.message : 'erro de sintaxe'));
      return 2;
    }
  }
}

type Regra = { padrao: string | null; acao: string };

class MiniAwk {
  private readonly regras: Regra[] = [];
  private readonly separador: string | null;
  private readonly variaveis: Map<string, string | number> = new Map();
  private campos: string[] = [];
  private saida: string = '';

  constructor(programa: string, separador: string | null) {
    this.separador = separador === '\\t' ? '\t' : separador;
    let resto: string = programa.trim();
    while (resto !== '') {
      const chave: number = resto.indexOf('{');
      if (chave < 0) {
        this.regras.push({ padrao: resto, acao: 'print' });
        break;
      }
      const padrao: string = resto.substring(0, chave).trim();
      let profundidade: number = 0;
      let fim: number = chave;
      for (; fim < resto.length; fim++) {
        if (resto.charAt(fim) === '{') profundidade++;
        if (resto.charAt(fim) === '}' && --profundidade === 0) break;
      }
      if (fim >= resto.length) throw new Error('falta fechar a chave }');
      this.regras.push({ padrao: padrao === '' ? null : padrao, acao: resto.substring(chave + 1, fim) });
      resto = resto.substring(fim + 1).trim();
    }
  }

  public rodar(linhas: string[]): string {
    this.variaveis.set('NR', 0);
    for (const regra of this.regras.filter((r) => r.padrao === 'BEGIN')) this.executar(regra.acao);
    for (const linha of linhas) {
      this.variaveis.set('NR', Number(this.variaveis.get('NR')) + 1);
      this.campos = [linha, ...(this.separador === null ? linha.trim().split(/\s+/).filter((c) => c !== '') : linha.split(this.separador))];
      this.variaveis.set('NF', this.campos.length - 1);
      for (const regra of this.regras.filter((r) => r.padrao !== 'BEGIN' && r.padrao !== 'END')) {
        if (regra.padrao === null || this.verdade(this.avaliar(regra.padrao))) this.executar(regra.acao);
      }
    }
    for (const regra of this.regras.filter((r) => r.padrao === 'END')) this.executar(regra.acao);
    return this.saida;
  }

  private verdade(valor: string | number | boolean): boolean {
    return typeof valor === 'boolean' ? valor : typeof valor === 'number' ? valor !== 0 : valor !== '';
  }

  private executar(acao: string): void {
    for (const bruta of acao.split(/;|\n/)) {
      const instrucao: string = bruta.trim();
      if (instrucao === '') continue;
      if (instrucao === 'print' || instrucao.startsWith('print ') || instrucao.startsWith('print(')) {
        const lista: string = instrucao.substring(5).trim();
        const partes: string[] = lista === '' ? ['$0'] : this.dividirVirgulas(lista);
        this.saida += partes.map((p) => this.texto(this.avaliar(p))).join(' ') + '\n';
        continue;
      }
      const atrib: RegExpMatchArray | null = instrucao.match(/^([A-Za-z_]\w*)\s*(\+\+|--|\+=|-=|=)\s*(.*)$/);
      if (atrib !== null) {
        const atual: number = Number(this.variaveis.get(atrib[1]) ?? 0);
        const valor = (): string | number => this.avaliar(atrib[3]) as string | number;
        switch (atrib[2]) {
          case '++': this.variaveis.set(atrib[1], atual + 1); break;
          case '--': this.variaveis.set(atrib[1], atual - 1); break;
          case '+=': this.variaveis.set(atrib[1], atual + Number(valor())); break;
          case '-=': this.variaveis.set(atrib[1], atual - Number(valor())); break;
          default: this.variaveis.set(atrib[1], valor());
        }
        continue;
      }
      throw new Error('instrução não suportada no simulador: ' + instrucao);
    }
  }

  private dividirVirgulas(texto: string): string[] {
    const partes: string[] = [];
    let atual: string = '';
    let aspas: boolean = false;
    for (const c of texto) {
      if (c === '"') aspas = !aspas;
      if (c === ',' && !aspas) { partes.push(atual); atual = ''; continue; }
      atual += c;
    }
    partes.push(atual);
    return partes.map((p) => p.trim());
  }

  private texto(valor: string | number | boolean): string {
    if (typeof valor === 'boolean') return valor ? '1' : '0';
    return String(valor);
  }

  /** Expressões: $N, NR, NF, variáveis, "texto", números, /regex/, comparações e + - * /. Concatenação por espaço. */
  private avaliar(expressao: string): string | number | boolean {
    const e: string = expressao.trim();
    if (/^\/.*\/$/.test(e)) return new RegExp(e.slice(1, -1)).test(this.campos[0] ?? '');
    const casa: RegExpMatchArray | null = e.match(/^(.+?)\s*~\s*\/(.*)\/$/);
    if (casa !== null) return new RegExp(casa[2]).test(this.texto(this.avaliar(casa[1])));
    for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
      const i: number = this.fora(e, op);
      if (i > 0) {
        const a: string | number | boolean = this.avaliar(e.substring(0, i));
        const b: string | number | boolean = this.avaliar(e.substring(i + op.length));
        const numericos: boolean = !isNaN(Number(a)) && !isNaN(Number(b)) && String(a).trim() !== '' && String(b).trim() !== '';
        const x: string | number = numericos ? Number(a) : String(a);
        const y: string | number = numericos ? Number(b) : String(b);
        switch (op) {
          case '==': return x === y;
          case '!=': return x !== y;
          case '>=': return x >= y;
          case '<=': return x <= y;
          case '>': return x > y;
          default: return x < y;
        }
      }
    }
    for (const op of ['+', '-']) {
      const i: number = this.fora(e, op, true);
      if (i > 0) {
        const a: number = Number(this.avaliar(e.substring(0, i))) || 0;
        const b: number = Number(this.avaliar(e.substring(i + 1))) || 0;
        return op === '+' ? a + b : a - b;
      }
    }
    for (const op of ['*', '/', '%']) {
      const i: number = this.fora(e, op, true);
      if (i > 0) {
        const a: number = Number(this.avaliar(e.substring(0, i))) || 0;
        const b: number = Number(this.avaliar(e.substring(i + 1))) || 0;
        return op === '*' ? a * b : op === '/' ? a / b : a % b;
      }
    }
    // concatenação: $1 "-" $2
    const pecas: string[] = e.match(/"[^"]*"|\$\w+|\$\([^)]*\)|[A-Za-z_]\w*|-?\d+(?:\.\d+)?/g) ?? [];
    if (pecas.length > 1) return pecas.map((p) => this.texto(this.avaliar(p))).join('');
    if (/^".*"$/.test(e)) return e.slice(1, -1).replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
    if (e.startsWith('$')) {
      const indice: string | number | boolean = e === '$NF' ? Number(this.variaveis.get('NF')) : /^\$\d+$/.test(e) ? Number(e.substring(1)) : this.avaliar(e.substring(1).replace(/^\((.*)\)$/, '$1'));
      return this.campos[Number(indice)] ?? '';
    }
    if (/^[A-Za-z_]\w*$/.test(e)) return this.variaveis.get(e) ?? '';
    if (/^\(.*\)$/.test(e)) return this.avaliar(e.slice(1, -1));
    throw new Error('expressão não suportada no simulador: ' + e);
  }

  /** Posição de um operador fora de aspas e de /regex/. */
  private fora(texto: string, op: string, ultimo: boolean = false): number {
    let aspas: boolean = false;
    let achado: number = -1;
    for (let i: number = 0; i < texto.length; i++) {
      const c: string = texto.charAt(i);
      if (c === '"') aspas = !aspas;
      if (aspas) continue;
      if (texto.startsWith(op, i) && !(op.length === 1 && '=!<>'.includes(texto.charAt(i + 1)) && '<>'.includes(op)) &&
        !(op === '-' && (i === 0 || /[+\-*/<>=(]\s*$/.test(texto.substring(0, i))))) {
        if (!ultimo) return i;
        achado = i;
      }
    }
    return achado;
  }
}
