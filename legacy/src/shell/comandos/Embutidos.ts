import { Comando } from '../Comando';
import type { Contexto } from '../Contexto';
import { Arquivo, Diretorio, Link, type No } from '../../linux/No';
import type { Escopo } from '../../linux/Escopo';
import { mensagemDe } from './util';

/** Comando interno do bash (não é um arquivo em /usr/bin, não cria processo). */
abstract class Embutido extends Comando {
  public readonly embutido: boolean = true;
}

export class Export extends Embutido {
  public readonly nome: string = 'export';
  public readonly resumo: string = 'torna a variável visível para os programas e scripts: export NOME=valor';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const escopo: Escopo = contexto.escopo;
    const nomes: string[] = args.filter((a: string) => a !== '-p');
    if (nomes.length === 0) {
      for (const nome of Array.from(escopo.exportadas).sort()) {
        contexto.linha('declare -x ' + nome + '="' + (escopo.obter(nome) ?? '') + '"');
      }
      return 0;
    }
    let status: number = 0;
    for (const item of nomes) {
      const i: number = item.indexOf('=');
      const nome: string = i >= 0 ? item.substring(0, i) : item;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) {
        contexto.falhar('bash: export: `' + item + '\': não é um identificador válido');
        status = 1;
        continue;
      }
      escopo.exportar(nome, i >= 0 ? item.substring(i + 1) : undefined);
    }
    return status;
  }
}

export class Unset extends Embutido {
  public readonly nome: string = 'unset';
  public readonly resumo: string = 'apaga uma variável: unset NOME';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    for (const nome of args.filter((a: string) => !a.startsWith('-'))) contexto.escopo.remover(nome);
    return 0;
  }
}

export class Set_ extends Embutido {
  public readonly nome: string = 'set';
  public readonly resumo: string = 'lista todas as variáveis do shell (exportadas ou não)';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    for (const [nome, valor] of Array.from(contexto.escopo.variaveis).sort((a, b) => a[0].localeCompare(b[0]))) {
      contexto.linha(nome + '=' + (/[\s'"]/.test(valor) ? "'" + valor + "'" : valor));
    }
    return 0;
  }
}

export class Env extends Comando {
  public readonly nome: string;
  public readonly resumo: string;

  constructor(nome: 'env' | 'printenv') {
    super();
    this.nome = nome;
    this.resumo = nome === 'env' ? 'lista as variáveis de ambiente (as exportadas)' : 'mostra uma variável de ambiente: printenv PATH';
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const escopo: Escopo = contexto.escopo;
    if (this.nome === 'printenv' && args.length > 0) {
      let status: number = 0;
      for (const nome of args) {
        if (escopo.exportadas.has(nome)) contexto.linha(escopo.obter(nome) ?? '');
        else status = 1;
      }
      return status;
    }
    if (this.nome === 'env' && args.length > 0) {
      return contexto.executor.executarArgs(args, contexto);
    }
    for (const nome of Array.from(escopo.exportadas).sort()) contexto.linha(nome + '=' + (escopo.obter(nome) ?? ''));
    return 0;
  }
}

export class Alias extends Embutido {
  public readonly nome: string = 'alias';
  public readonly resumo: string = "cria um apelido: alias ll='ls -alF' (sem argumentos, lista os apelidos)";

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const aliases: Map<string, string> = contexto.escopo.aliases;
    if (args.length === 0) {
      for (const [nome, valor] of Array.from(aliases).sort((a, b) => a[0].localeCompare(b[0]))) contexto.linha('alias ' + nome + "='" + valor + "'");
      return 0;
    }
    let status: number = 0;
    for (const item of args) {
      const i: number = item.indexOf('=');
      if (i < 0) {
        const valor: string | undefined = aliases.get(item);
        if (valor === undefined) {
          contexto.falhar('bash: alias: ' + item + ': não encontrado');
          status = 1;
        } else {
          contexto.linha('alias ' + item + "='" + valor + "'");
        }
        continue;
      }
      aliases.set(item.substring(0, i), item.substring(i + 1));
    }
    return status;
  }
}

export class Unalias extends Embutido {
  public readonly nome: string = 'unalias';
  public readonly resumo: string = 'remove um apelido';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args[0] === '-a') {
      contexto.escopo.aliases.clear();
      return 0;
    }
    let status: number = 0;
    for (const nome of args) {
      if (!contexto.escopo.aliases.delete(nome)) {
        contexto.falhar('bash: unalias: ' + nome + ': não encontrado');
        status = 1;
      }
    }
    return status;
  }
}

export class Source extends Embutido {
  public readonly nome: string;
  public readonly resumo: string = 'executa um arquivo no shell ATUAL (as variáveis e apelidos ficam valendo): source ~/.bashrc';

  constructor(nome: 'source' | '.') {
    super();
    this.nome = nome;
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      contexto.falhar('bash: ' + this.nome + ': é necessário um argumento de nome de arquivo');
      return 2;
    }
    let no: No;
    try {
      no = contexto.localizar(args[0]);
    } catch (erro) {
      contexto.falhar('bash: ' + args[0] + ': ' + mensagemDe(erro));
      return 1;
    }
    if (!(no instanceof Arquivo) || !contexto.fs.pode(no, contexto.credencial, 'r')) {
      contexto.falhar('bash: ' + args[0] + ': ' + (no instanceof Diretorio ? 'É um diretório' : 'Permissão negada'));
      return 1;
    }
    const texto: string = no.ler();
    // apelidos e exports simples também passam pelo leitor de perfil (alias com aspas)
    contexto.escopo.aplicarPerfil(texto.split('\n').filter((l: string) => /^\s*alias\s/.test(l)).join('\n'));
    const semAlias: string = texto.split('\n').filter((l: string) => !/^\s*alias\s/.test(l)).join('\n');
    return contexto.executor.executarTexto(semAlias, contexto);
  }
}

export class Read extends Embutido {
  public readonly nome: string = 'read';
  public readonly resumo: string = 'lê o que o usuário digitar para uma variável: read -p "Nome: " NOME';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let prompt: string = '';
    let oculto: boolean = false;
    const nomes: string[] = [];
    for (let i: number = 0; i < args.length; i++) {
      if (args[i] === '-p') prompt = args[++i] ?? '';
      else if (args[i] === '-s') oculto = true;
      else if (args[i] === '-r') continue;
      else nomes.push(args[i]);
    }
    if (nomes.length === 0) nomes.push('REPLY');
    let linha: string;
    if (contexto.entrada !== null) {
      linha = contexto.entrada.split('\n')[0] ?? '';
      if (contexto.entrada === '') return 1;
    } else {
      linha = await contexto.interacao.perguntar(prompt, oculto);
      if (linha === '\u0003') return 130;
    }
    const partes: string[] = linha.trim().split(/\s+/);
    nomes.forEach((nome: string, i: number) => {
      const valor: string = i === nomes.length - 1 ? partes.slice(i).join(' ') : partes[i] ?? '';
      contexto.escopo.definir(nome, valor);
    });
    return 0;
  }
}

/** test e [ ]: condições do if. */
export class Test extends Embutido {
  public readonly nome: string;
  public readonly resumo: string = 'testa condições: [ -f arq ] existe arquivo, [ -d pasta ], [ "$a" = "$b" ], [ $n -gt 5 ]';

  constructor(nome: 'test' | '[' | '[[') {
    super();
    this.nome = nome;
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let lista: string[] = args;
    if (this.nome !== 'test') {
      const fecho: string = this.nome === '[' ? ']' : ']]';
      if (lista[lista.length - 1] !== fecho) {
        contexto.falhar('bash: ' + this.nome + ': faltando `' + fecho + "'");
        return 2;
      }
      lista = lista.slice(0, -1);
    }
    try {
      return this.avaliar(lista, contexto) ? 0 : 1;
    } catch (erro) {
      contexto.falhar('bash: ' + this.nome + ': ' + (erro instanceof Error ? erro.message : String(erro)));
      return 2;
    }
  }

  private avaliar(args: string[], contexto: Contexto): boolean {
    const ou: number = args.indexOf('-o');
    if (ou > 0) return this.avaliar(args.slice(0, ou), contexto) || this.avaliar(args.slice(ou + 1), contexto);
    const e: number = args.indexOf('-a');
    if (e > 0 && args.length > 3) return this.avaliar(args.slice(0, e), contexto) && this.avaliar(args.slice(e + 1), contexto);
    if (args[0] === '!') return !this.avaliar(args.slice(1), contexto);
    if (args.length === 0) return false;
    if (args.length === 1) return args[0] !== '';
    if (args.length === 2) {
      const [op, valor] = args;
      if (op === '-z') return valor === '';
      if (op === '-n') return valor !== '';
      let no: No | null = null;
      try {
        no = op === '-L' || op === '-h' ? contexto.localizarSemSeguir(valor) : contexto.localizar(valor);
      } catch {
        no = null;
      }
      switch (op) {
        case '-e': return no !== null;
        case '-f': return no instanceof Arquivo;
        case '-d': return no instanceof Diretorio;
        case '-L':
        case '-h': return no instanceof Link;
        case '-s': return no !== null && no.tamanho() > 0;
        case '-r': return no !== null && contexto.fs.pode(no, contexto.credencial, 'r');
        case '-w': return no !== null && contexto.fs.pode(no, contexto.credencial, 'w');
        case '-x': return no !== null && contexto.fs.pode(no, contexto.credencial, 'x');
        default: throw new Error(op + ': esperado operador unário');
      }
    }
    const [a, op, b] = args;
    const numero = (t: string): number => {
      if (!/^-?\d+$/.test(t.trim())) throw new Error(t + ': esperado expressão de número inteiro');
      return Number(t);
    };
    switch (op) {
      case '=':
      case '==': return a === b;
      case '!=': return a !== b;
      case '-eq': return numero(a) === numero(b);
      case '-ne': return numero(a) !== numero(b);
      case '-lt': return numero(a) < numero(b);
      case '-le': return numero(a) <= numero(b);
      case '-gt': return numero(a) > numero(b);
      case '-ge': return numero(a) >= numero(b);
      case '<': return a < b;
      case '>': return a > b;
      default: throw new Error(op + ': esperado operador binário');
    }
  }
}

export class Verdadeiro extends Embutido {
  public readonly nome: string;
  public readonly resumo: string;

  constructor(nome: 'true' | 'false' | ':') {
    super();
    this.nome = nome;
    this.resumo = nome === 'false' ? 'não faz nada e termina com erro (código 1)' : 'não faz nada e termina com sucesso (código 0)';
  }

  public async executar(): Promise<number> {
    return this.nome === 'false' ? 1 : 0;
  }
}

export class Shift extends Embutido {
  public readonly nome: string = 'shift';
  public readonly resumo: string = 'descarta o $1 e anda com os parâmetros ($2 vira $1)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const n: number = Number(args[0] ?? '1');
    if (n > contexto.escopo.posicionais.length) return 1;
    contexto.escopo.posicionais = contexto.escopo.posicionais.slice(n);
    return 0;
  }
}

export class Type extends Embutido {
  public readonly nome: string = 'type';
  public readonly resumo: string = 'diz o que é um comando: apelido, comando interno ou arquivo (e onde)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let status: number = 0;
    for (const nome of args) {
      const apelido: string | undefined = contexto.escopo.aliases.get(nome);
      if (apelido !== undefined) {
        contexto.linha(nome + ' é um apelido para `' + apelido + "'");
        continue;
      }
      if (['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'until'].includes(nome)) {
        contexto.linha(nome + ' é uma palavra-chave do shell');
        continue;
      }
      if (contexto.executor.ehEmbutido(nome)) {
        contexto.linha(nome + ' é um comando interno do shell');
        continue;
      }
      const pasta: string | undefined = contexto.escopo.caminhos().find((p: string) => contexto.fs.obter(p + '/' + nome) !== null);
      if (pasta !== undefined) {
        contexto.linha(nome + ' é ' + pasta + '/' + nome);
      } else {
        contexto.falhar('bash: type: ' + nome + ': não encontrado');
        status = 1;
      }
    }
    return status;
  }
}

/** bash / sh: roda um script sem precisar do x, ou um comando com -c. */
export class Bash extends Comando {
  public readonly nome: string;
  public readonly resumo: string;

  constructor(nome: 'bash' | 'sh') {
    super();
    this.nome = nome;
    this.resumo = 'interpretador de comandos: ' + nome + ' script.sh (roda o script mesmo sem x) | ' + nome + ' -c "comando"';
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args[0] === '--version') {
      contexto.linha('GNU bash, versão 5.2.21(1)-release (x86_64-pc-linux-gnu)');
      return 0;
    }
    if (args[0] === '-c') {
      return contexto.executor.executarTexto(args[1] ?? '', contexto.com({ escopo: contexto.escopo.filho(this.nome, args.slice(2)) }));
    }
    const opcoes: string[] = args.filter((a: string) => a === '-x' || a === '-n');
    const resto: string[] = args.filter((a: string) => a !== '-x' && a !== '-n');
    if (resto.length === 0) {
      contexto.linha('(O simulador não abre um shell dentro do shell. Use ' + this.nome + ' script.sh ou ' + this.nome + ' -c "comando".)', 'c-info');
      return 0;
    }
    if (opcoes.includes('-n')) {
      return 0;
    }
    return contexto.executor.executarScript(resto[0], resto.slice(1), contexto, false);
  }
}

export class Sleep extends Comando {
  public readonly nome: string = 'sleep';
  public readonly resumo: string = 'espera N segundos (sleep 5, sleep 2m). Ctrl+C interrompe';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      contexto.falhar('sleep: falta operando');
      return 1;
    }
    let total: number = 0;
    for (const arg of args) {
      const partes: RegExpMatchArray | null = arg.match(/^(\d+(?:\.\d+)?)([smhd]?)$/);
      if (partes === null) {
        contexto.falhar('sleep: intervalo de tempo inválido ' + "'" + arg + "'");
        return 1;
      }
      const multiplicador: number = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[partes[2] as '' | 's' | 'm' | 'h' | 'd'];
      total += Number(partes[1]) * multiplicador;
    }
    return (await contexto.dormir(total * 1000)) ? 0 : 130;
  }
}
