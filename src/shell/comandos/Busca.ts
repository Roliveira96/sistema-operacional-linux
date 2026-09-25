import { Comando } from '../Comando';
import type { Contexto } from '../Contexto';
import { Diretorio, Link, type No } from '../../linux/No';
import { Permissoes } from '../../linux/Permissoes';
import { dataDoLs, mensagemDe } from './util';

/** Um nó da expressão do find: teste, ação ou operador. */
type Expressao =
  | { tipo: 'e' | 'ou'; a: Expressao; b: Expressao }
  | { tipo: 'nao'; a: Expressao }
  | { tipo: 'teste'; nome: string; valor: string }
  | { tipo: 'exec'; comando: string[]; lote: boolean }
  | { tipo: 'acao'; nome: string };

interface Encontrado {
  caminho: string;
  no: No;
  profundidade: number;
}

/** "*.log" do -name → regex. */
function padraoParaRegex(padrao: string, ignorarCaixa: boolean): RegExp {
  let fonte: string = '^';
  for (const c of padrao) {
    if (c === '*') fonte += '.*';
    else if (c === '?') fonte += '.';
    else fonte += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(fonte + '$', ignorarCaixa ? 'i' : '');
}

export class Find extends Comando {
  public readonly nome: string = 'find';
  public readonly resumo: string = 'procura arquivos por nome, tipo, tamanho, dono, permissão ou data: find /var -name "*.log" -size +1M';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const inicios: string[] = [];
    let i: number = 0;
    while (i < args.length && !args[i].startsWith('-') && args[i] !== '!' && args[i] !== '(') inicios.push(args[i++]);
    if (inicios.length === 0) inicios.push('.');
    let profundidadeMaxima: number = Infinity;
    let profundidadeMinima: number = 0;
    const tokens: string[] = [];
    for (; i < args.length; i++) {
      if (args[i] === '-maxdepth') profundidadeMaxima = Number(args[++i]);
      else if (args[i] === '-mindepth') profundidadeMinima = Number(args[++i]);
      else tokens.push(args[i]);
    }
    let expressao: Expressao | null;
    let temAcao: boolean;
    try {
      const leitor: LeitorDeExpressao = new LeitorDeExpressao(tokens);
      expressao = leitor.ler();
      temAcao = leitor.temAcao;
    } catch (erro) {
      contexto.falhar('find: ' + (erro instanceof Error ? erro.message : String(erro)));
      return 1;
    }
    const apagar: boolean = tokens.includes('-delete');
    let status: number = 0;
    const lotes: Map<Expressao, string[]> = new Map();

    for (const inicio of inicios) {
      let raiz: No;
      try {
        raiz = contexto.localizarSemSeguir(inicio);
      } catch (erro) {
        contexto.falhar("find: '" + inicio + "': " + mensagemDe(erro));
        status = 1;
        continue;
      }
      const encontrados: Encontrado[] = [];
      const visitar = (caminho: string, no: No, profundidade: number): void => {
        if (!apagar) encontrados.push({ caminho, no, profundidade });
        if (no instanceof Diretorio && profundidade < profundidadeMaxima) {
          if (!contexto.fs.pode(no, contexto.credencial, 'r') || !contexto.fs.pode(no, contexto.credencial, 'x')) {
            contexto.falhar("find: '" + caminho + "': Permissão negada");
            status = 1;
          } else {
            for (const nome of no.nomesOrdenados()) {
              visitar(caminho === '/' ? '/' + nome : caminho.replace(/\/$/, '') + '/' + nome, no.obter(nome) as No, profundidade + 1);
            }
          }
        }
        if (apagar) encontrados.push({ caminho, no, profundidade });
      };
      visitar(inicio, raiz, 0);

      for (const item of encontrados) {
        if (item.profundidade < profundidadeMinima) continue;
        const resultado: boolean = expressao === null ? true : await this.avaliar(expressao, item, contexto, lotes);
        if (resultado && !temAcao) contexto.linha(item.caminho);
      }
    }
    for (const [exec, caminhos] of lotes) {
      if (exec.tipo !== 'exec' || caminhos.length === 0) continue;
      const args: string[] = exec.comando.flatMap((p: string) => p === '{}' ? caminhos : [p]);
      await contexto.executor.executarArgs(args, contexto);
    }
    return status;
  }

  private async avaliar(e: Expressao, item: Encontrado, contexto: Contexto, lotes: Map<Expressao, string[]>): Promise<boolean> {
    switch (e.tipo) {
      case 'e': return (await this.avaliar(e.a, item, contexto, lotes)) && this.avaliar(e.b, item, contexto, lotes);
      case 'ou': return (await this.avaliar(e.a, item, contexto, lotes)) || this.avaliar(e.b, item, contexto, lotes);
      case 'nao': return !(await this.avaliar(e.a, item, contexto, lotes));
      case 'teste': return this.testar(e.nome, e.valor, item, contexto);
      case 'exec': {
        if (e.lote) {
          lotes.set(e, [...(lotes.get(e) ?? []), item.caminho]);
          return true;
        }
        const args: string[] = e.comando.map((p: string) => p.split('{}').join(item.caminho));
        return (await contexto.executor.executarArgs(args, contexto)) === 0;
      }
      case 'acao':
        if (e.nome === '-print') contexto.linha(item.caminho);
        if (e.nome === '-ls') {
          const no: No = item.no;
          contexto.linha(String(1000 + item.caminho.length * 37).padStart(9) + ' ' + String(no.ehDiretorio() ? 4 : Math.ceil(no.tamanho() / 4096) * 4).padStart(6) + ' ' +
            Permissoes.paraTexto(no.modo, no.tipoLs()) + '   1 ' + contexto.contas.nomeDoUsuario(no.dono).padEnd(8) + ' ' + contexto.contas.nomeDoGrupo(no.grupo).padEnd(8) + ' ' +
            String(no.tamanho()).padStart(8) + ' ' + dataDoLs(no.modificadoEm) + ' ' + item.caminho);
        }
        if (e.nome === '-delete') {
          const pai: Diretorio | null = item.no.pai;
          if (pai === null || (item.no instanceof Diretorio && item.no.filhos.size > 0) || !contexto.fs.podeApagar(pai, item.no, contexto.credencial)) {
            contexto.falhar('find: não foi possível excluir \'' + item.caminho + '\': ' + (item.no instanceof Diretorio && item.no.filhos.size > 0 ? 'Diretório não vazio' : 'Permissão negada'));
            return false;
          }
          pai.remover(item.no.nome);
        }
        return true;
    }
  }

  private testar(nome: string, valor: string, item: Encontrado, contexto: Contexto): boolean {
    const no: No = item.no;
    const nomeArquivo: string = item.caminho === '/' ? '/' : item.caminho.replace(/\/$/, '').split('/').pop() ?? '';
    const comparar = (texto: string, atual: number): boolean => {
      if (texto.startsWith('+')) return atual > Number(texto.substring(1));
      if (texto.startsWith('-')) return atual < Number(texto.substring(1));
      return atual === Number(texto);
    };
    switch (nome) {
      case '-name': return padraoParaRegex(valor, false).test(nomeArquivo);
      case '-iname': return padraoParaRegex(valor, true).test(nomeArquivo);
      case '-path': return padraoParaRegex(valor, false).test(item.caminho);
      case '-type':
        return (valor === 'f' && !no.ehDiretorio() && !(no instanceof Link)) || (valor === 'd' && no instanceof Diretorio) || (valor === 'l' && no instanceof Link);
      case '-user': return contexto.contas.nomeDoUsuario(no.dono) === valor || String(no.dono) === valor;
      case '-group': return contexto.contas.nomeDoGrupo(no.grupo) === valor || String(no.grupo) === valor;
      case '-nouser': return contexto.contas.usuarioPorUid(no.dono) === undefined;
      case '-empty': return no instanceof Diretorio ? no.filhos.size === 0 : no.tamanho() === 0;
      case '-size': {
        const m: RegExpMatchArray | null = valor.match(/^([+-]?)(\d+)([ckMGb]?)$/);
        if (m === null) return false;
        const unidade: number = { c: 1, k: 1024, M: 1024 * 1024, G: 1024 ** 3, b: 512, '': 512 }[m[3] as 'c'];
        return comparar(m[1] + m[2], Math.ceil(no.tamanho() / unidade));
      }
      case '-perm': {
        const modo: number = no.modo & 0o7777;
        if (valor.startsWith('-')) { const alvo: number = parseInt(valor.substring(1), 8); return (modo & alvo) === alvo; }
        if (valor.startsWith('/')) { const alvo: number = parseInt(valor.substring(1), 8); return (modo & alvo) !== 0; }
        return modo === parseInt(valor, 8);
      }
      case '-mtime': return comparar(valor, Math.floor((Date.now() - no.modificadoEm.getTime()) / 86400000));
      case '-mmin': return comparar(valor, Math.floor((Date.now() - no.modificadoEm.getTime()) / 60000));
      case '-newer': {
        const referencia: No | null = contexto.tentarLocalizar(valor);
        return referencia !== null && no.modificadoEm.getTime() > referencia.modificadoEm.getTime();
      }
      case '-true': return true;
      case '-false': return false;
      default: return false;
    }
  }
}

/** Monta a árvore da expressão: -a implícito, -o, !/-not e parênteses. */
class LeitorDeExpressao {
  private static readonly COM_VALOR: string[] = ['-name', '-iname', '-path', '-type', '-user', '-group', '-size', '-perm', '-mtime', '-mmin', '-newer'];
  private static readonly SEM_VALOR: string[] = ['-empty', '-nouser', '-true', '-false'];
  private static readonly ACOES: string[] = ['-print', '-delete', '-ls'];
  private readonly tokens: string[];
  private i: number = 0;
  public temAcao: boolean = false;

  constructor(tokens: string[]) {
    this.tokens = tokens;
  }

  public ler(): Expressao | null {
    if (this.tokens.length === 0) return null;
    const e: Expressao = this.ou();
    if (this.i < this.tokens.length) throw new Error('caminhos devem preceder a expressão: `' + this.tokens[this.i] + "'");
    return e;
  }

  private ou(): Expressao {
    let e: Expressao = this.e();
    while (this.tokens[this.i] === '-o' || this.tokens[this.i] === '-or') {
      this.i++;
      e = { tipo: 'ou', a: e, b: this.e() };
    }
    return e;
  }

  private e(): Expressao {
    let e: Expressao = this.nao();
    for (;;) {
      const t: string | undefined = this.tokens[this.i];
      if (t === undefined || t === '-o' || t === '-or' || t === ')') return e;
      if (t === '-a' || t === '-and') this.i++;
      e = { tipo: 'e', a: e, b: this.nao() };
    }
  }

  private nao(): Expressao {
    const t: string | undefined = this.tokens[this.i];
    if (t === '!' || t === '-not') {
      this.i++;
      return { tipo: 'nao', a: this.nao() };
    }
    return this.primario();
  }

  private primario(): Expressao {
    const t: string | undefined = this.tokens[this.i++];
    if (t === undefined) throw new Error('expressão incompleta');
    if (t === '(') {
      const e: Expressao = this.ou();
      if (this.tokens[this.i++] !== ')') throw new Error('faltou fechar o parêntese');
      return e;
    }
    if (LeitorDeExpressao.COM_VALOR.includes(t)) {
      const valor: string | undefined = this.tokens[this.i++];
      if (valor === undefined) throw new Error('falta argumento para `' + t + "'");
      return { tipo: 'teste', nome: t, valor };
    }
    if (LeitorDeExpressao.SEM_VALOR.includes(t)) return { tipo: 'teste', nome: t, valor: '' };
    if (LeitorDeExpressao.ACOES.includes(t)) {
      this.temAcao = true;
      return { tipo: 'acao', nome: t };
    }
    if (t === '-exec') {
      const comando: string[] = [];
      while (this.i < this.tokens.length && this.tokens[this.i] !== ';' && this.tokens[this.i] !== '+') comando.push(this.tokens[this.i++]);
      const fim: string | undefined = this.tokens[this.i++];
      if (fim === undefined) throw new Error('falta argumento para `-exec\' (termine com \\; ou +)');
      this.temAcao = true;
      return { tipo: 'exec', comando, lote: fim === '+' };
    }
    throw new Error('predicado desconhecido `' + t + "'");
  }
}

export class Du extends Comando {
  public readonly nome: string = 'du';
  public readonly resumo: string = 'quanto espaço uma pasta ocupa: du -sh /var/log | du -h --max-depth=1 /var';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let resumo: boolean = false;
    let humano: boolean = false;
    let todos: boolean = false;
    let maximo: number = Infinity;
    const caminhos: string[] = [];
    for (let i: number = 0; i < args.length; i++) {
      const a: string = args[i];
      if (a.startsWith('--max-depth=')) maximo = Number(a.split('=')[1]);
      else if (a === '-d' || a === '--max-depth') maximo = Number(args[++i]);
      else if (/^-[shac]+$/.test(a)) {
        resumo = resumo || a.includes('s');
        humano = humano || a.includes('h');
        todos = todos || a.includes('a');
      } else caminhos.push(a);
    }
    if (caminhos.length === 0) caminhos.push('.');
    if (resumo) maximo = 0;
    let status: number = 0;
    const formatar = (kb: number): string => {
      if (!humano) return String(kb);
      if (kb < 1024) return (kb < 10 ? kb.toFixed(1).replace('.', ',') : String(kb)) + 'K';
      const mb: number = kb / 1024;
      if (mb < 1024) return (mb < 10 ? mb.toFixed(1).replace('.', ',') : String(Math.round(mb))) + 'M';
      return (mb / 1024).toFixed(1).replace('.', ',') + 'G';
    };
    const medir = (caminho: string, no: No, profundidade: number): number => {
      if (no instanceof Link) return 0;
      if (!(no instanceof Diretorio)) {
        const kb: number = Math.ceil(no.tamanho() / 4096) * 4;
        if (todos && profundidade <= maximo) contexto.linha(formatar(kb) + '\t' + caminho);
        return kb;
      }
      let total: number = 4;
      if (!contexto.fs.pode(no, contexto.credencial, 'r') || !contexto.fs.pode(no, contexto.credencial, 'x')) {
        contexto.falhar("du: não foi possível ler o diretório '" + caminho + "': Permissão negada");
        status = 1;
      } else {
        for (const nome of no.nomesOrdenados()) {
          total += medir(caminho === '/' ? '/' + nome : caminho.replace(/\/$/, '') + '/' + nome, no.obter(nome) as No, profundidade + 1);
        }
      }
      if (profundidade <= maximo) contexto.linha(formatar(total) + '\t' + caminho);
      return total;
    };
    for (const caminho of caminhos) {
      try {
        medir(caminho, contexto.localizarSemSeguir(caminho), 0);
      } catch (erro) {
        contexto.falhar("du: não foi possível acessar '" + caminho + "': " + mensagemDe(erro));
        status = 1;
      }
    }
    return status;
  }
}
