import { Analisador, ErroDeSintaxe, type Ambiente, type ComandoSimples, type Palavra, type Pipeline } from './Analisador';
import { Contexto, type Executor, type Interacao } from './Contexto';
import { SaidaEmTexto, SaidaParaArquivo, type Saida } from './Saida';
import type { Comando } from './Comando';
import type { RegistroDeComandos } from './RegistroDeComandos';
import type { Maquina } from '../linux/Maquina';
import type { Sessao } from '../linux/Sessao';
import type { Usuario } from '../linux/Contas';
import type { Credencial } from '../linux/SistemaDeArquivos';
import { Arquivo, Diretorio, type No } from '../linux/No';
import { ErroDeSistema } from '../linux/ErroDeSistema';

/** O "bash": lê a linha, expande curingas, liga pipes e redirecionamentos e chama os comandos. */
export class Interpretador implements Executor {
  private readonly registro: RegistroDeComandos;
  private ultimoStatus: number = 0;

  constructor(registro: RegistroDeComandos) {
    this.registro = registro;
  }

  public async executarLinha(linha: string, maquina: Maquina, sessao: Sessao, terminal: Saida, interacao: Interacao): Promise<number> {
    const texto: string = linha.trim();
    if (texto === '') {
      return this.ultimoStatus;
    }
    sessao.historico.push(texto);

    let pipelines: Pipeline[];
    try {
      pipelines = new Analisador(this.criarAmbiente(maquina, sessao)).analisar(texto);
    } catch (erro) {
      if (erro instanceof ErroDeSintaxe) {
        terminal.escrever(erro.message + '\n');
        this.ultimoStatus = 2;
        return 2;
      }
      throw erro;
    }

    for (const pipeline of pipelines) {
      if (pipeline.conector === '&&' && this.ultimoStatus !== 0) continue;
      if (pipeline.conector === '||' && this.ultimoStatus === 0) continue;
      this.ultimoStatus = await this.executarPipeline(pipeline, maquina, sessao, terminal, interacao);
    }
    return this.ultimoStatus;
  }

  public ehEmbutido(nome: string): boolean {
    const comando: Comando | undefined = this.registro.obter(nome);
    return comando !== undefined && comando.embutido;
  }

  public nomesDeComandos(): string[] {
    return this.registro.nomes();
  }

  public async executarArgs(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      return 0;
    }
    if (args[0].includes('/')) {
      return this.executarScript(args[0], contexto);
    }
    const comando: Comando | undefined = this.registro.obter(args[0]);
    if (comando === undefined) {
      contexto.falhar(args[0] + ': comando não encontrado');
      return 127;
    }
    try {
      return await comando.executar(args.slice(1), contexto);
    } catch (erro) {
      if (erro instanceof ErroDeSistema) {
        contexto.falhar(args[0] + ': ' + erro.message);
        return 1;
      }
      throw erro;
    }
  }

  /** ./script.sh: precisa de x (e de r, porque o bash lê o arquivo); cada linha vira um comando. */
  private async executarScript(caminho: string, contexto: Contexto): Promise<number> {
    let no: No;
    try {
      no = contexto.localizar(caminho);
    } catch (erro) {
      contexto.falhar('bash: ' + caminho + ': ' + (erro instanceof ErroDeSistema ? erro.message : String(erro)));
      return 127;
    }
    if (no instanceof Diretorio) {
      contexto.falhar('bash: ' + caminho + ': É um diretório');
      return 126;
    }
    if (!contexto.fs.pode(no, contexto.credencial, 'x') || !contexto.fs.pode(no, contexto.credencial, 'r')) {
      contexto.falhar('bash: ' + caminho + ': Permissão negada');
      return 126;
    }
    let status: number = 0;
    for (const linha of (no as Arquivo).ler().split('\n')) {
      if (linha.trim() === '' || linha.trim().startsWith('#')) continue;
      status = await this.executarLinhaInterna(linha, contexto);
    }
    return status;
  }

  private async executarLinhaInterna(linha: string, contexto: Contexto): Promise<number> {
    let pipelines: Pipeline[];
    try {
      pipelines = new Analisador(this.criarAmbiente(contexto.maquina, contexto.sessao)).analisar(linha);
    } catch (erro) {
      contexto.falhar(erro instanceof Error ? erro.message : String(erro));
      return 2;
    }
    let status: number = 0;
    for (const pipeline of pipelines) {
      if (pipeline.conector === '&&' && status !== 0) continue;
      if (pipeline.conector === '||' && status === 0) continue;
      status = await this.executarPipeline(pipeline, contexto.maquina, contexto.sessao, contexto.saida, contexto.interacao);
    }
    return status;
  }

  private async executarPipeline(pipeline: Pipeline, maquina: Maquina, sessao: Sessao, terminal: Saida, interacao: Interacao): Promise<number> {
    let entrada: string | null = null;
    let status: number = 0;
    for (let i: number = 0; i < pipeline.comandos.length; i++) {
      const ultimo: boolean = i === pipeline.comandos.length - 1;
      const captura: SaidaEmTexto = new SaidaEmTexto();
      status = await this.executarSimples(pipeline.comandos[i], maquina, sessao, ultimo ? terminal : captura, terminal, entrada, interacao);
      entrada = captura.texto;
    }
    return status;
  }

  private async executarSimples(comando: ComandoSimples, maquina: Maquina, sessao: Sessao, saidaPadrao: Saida, terminal: Saida,
    entradaPadrao: string | null, interacao: Interacao): Promise<number> {
    const credencial: Credencial = sessao.credencial();
    let saida: Saida = saidaPadrao;
    let erro: Saida = terminal;
    let entrada: string | null = entradaPadrao;

    for (const redirecionamento of comando.redirecionamentos) {
      const alvo: string = redirecionamento.alvo.texto;
      try {
        if (redirecionamento.tipo === '<') {
          const no: No = maquina.fs.localizar(alvo, sessao.atual().cwd, credencial);
          if (no instanceof Diretorio) throw new ErroDeSistema('EISDIR');
          if (!maquina.fs.pode(no, credencial, 'r')) throw new ErroDeSistema('EACCES');
          entrada = (no as Arquivo).ler();
          continue;
        }
        const arquivo: Arquivo = Interpretador.abrirParaEscrita(alvo, !redirecionamento.tipo.endsWith('>>'), maquina, sessao, credencial);
        const destino: SaidaParaArquivo = new SaidaParaArquivo(arquivo);
        if (redirecionamento.tipo.startsWith('2')) {
          erro = destino;
        } else if (redirecionamento.tipo === '&>') {
          saida = destino;
          erro = destino;
        } else {
          saida = destino;
        }
      } catch (falha) {
        if (falha instanceof ErroDeSistema) {
          terminal.escrever('bash: ' + alvo + ': ' + falha.message + '\n');
          return 1;
        }
        throw falha;
      }
    }

    const args: string[] = [];
    for (const palavra of comando.palavras) {
      args.push(...this.expandirCuringas(palavra, maquina, sessao, credencial));
    }
    const contexto: Contexto = new Contexto(maquina, sessao, saida, erro, entrada, credencial, interacao, this);
    return this.executarArgs(args, contexto);
  }

  /** O bash abre (e zera, no caso do >) o arquivo ANTES de rodar o comando — por isso "sudo echo x > /etc/y" falha. */
  public static abrirParaEscrita(caminho: string, truncar: boolean, maquina: Maquina, sessao: Sessao, credencial: Credencial): Arquivo {
    const cwd: string = sessao.atual().cwd;
    let existente: No | null = null;
    try {
      existente = maquina.fs.localizar(caminho, cwd, credencial);
    } catch (erro) {
      if (!(erro instanceof ErroDeSistema) || erro.codigo !== 'ENOENT') throw erro;
    }
    if (existente !== null) {
      if (existente instanceof Diretorio) throw new ErroDeSistema('EISDIR');
      if (!maquina.fs.pode(existente, credencial, 'w')) throw new ErroDeSistema('EACCES');
      const arquivo: Arquivo = existente as Arquivo;
      if (truncar) arquivo.escrever('');
      return arquivo;
    }
    const { pai, nome } = maquina.fs.localizarPai(caminho, cwd, credencial);
    if (!maquina.fs.pode(pai, credencial, 'w')) throw new ErroDeSistema('EACCES');
    const novo: Arquivo = new Arquivo(nome, credencial.uid, credencial.gids[0], 0o666 & ~sessao.atual().umask);
    pai.adicionar(novo);
    return novo;
  }

  /** *.txt → a.txt b.txt. Sem nenhum resultado, o bash passa o texto literal (e o comando reclama). */
  private expandirCuringas(palavra: Palavra, maquina: Maquina, sessao: Sessao, credencial: Credencial): string[] {
    if (!palavra.coringas.some((c: boolean) => c)) {
      return [palavra.texto];
    }
    const segmentos: Array<{ texto: string; coringas: boolean[] }> = [{ texto: '', coringas: [] }];
    for (let i: number = 0; i < palavra.texto.length; i++) {
      const letra: string = palavra.texto.charAt(i);
      if (letra === '/') {
        segmentos.push({ texto: '', coringas: [] });
      } else {
        segmentos[segmentos.length - 1].texto += letra;
        segmentos[segmentos.length - 1].coringas.push(palavra.coringas[i]);
      }
    }
    const absoluto: boolean = palavra.texto.startsWith('/');
    const soDiretorios: boolean = palavra.texto.endsWith('/');
    let bases: string[] = [absoluto ? '/' : ''];
    const juntar = (base: string, nome: string): string => base === '' ? nome : base.endsWith('/') ? base + nome : base + '/' + nome;

    for (const segmento of segmentos) {
      if (segmento.texto === '') {
        continue;
      }
      if (!segmento.coringas.some((c: boolean) => c)) {
        bases = bases.map((base: string) => juntar(base, segmento.texto));
        continue;
      }
      let padrao: string = '^';
      for (let i: number = 0; i < segmento.texto.length; i++) {
        const letra: string = segmento.texto.charAt(i);
        if (segmento.coringas[i]) {
          padrao += letra === '*' ? '.*' : '.';
        } else {
          padrao += letra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
      }
      const regex: RegExp = new RegExp(padrao + '$');
      const proximas: string[] = [];
      for (const base of bases) {
        let pasta: No;
        try {
          pasta = maquina.fs.localizar(base === '' ? '.' : base, sessao.atual().cwd, credencial);
        } catch {
          continue;
        }
        if (!(pasta instanceof Diretorio) || !maquina.fs.pode(pasta, credencial, 'r')) {
          continue;
        }
        for (const nome of pasta.nomesOrdenados()) {
          if (nome.startsWith('.') && !segmento.texto.startsWith('.')) continue;
          if (regex.test(nome)) proximas.push(juntar(base, nome));
        }
      }
      bases = proximas;
    }

    let resultado: string[] = bases;
    if (soDiretorios) {
      resultado = bases.filter((c: string) => {
        const no: No | null = maquina.fs.obter(c.startsWith('/') ? c : sessao.atual().cwd + '/' + c);
        return no !== null && no.ehDiretorio();
      }).map((c: string) => c + '/');
    }
    return resultado.length > 0 ? resultado : [palavra.texto];
  }

  private criarAmbiente(maquina: Maquina, sessao: Sessao): Ambiente {
    return {
      variavel: (nome: string): string | undefined => {
        const quadro = sessao.atual();
        switch (nome) {
          case 'HOME': return quadro.usuario.home;
          case 'USER':
          case 'LOGNAME': return quadro.usuario.nome;
          case 'PWD': return quadro.cwd;
          case 'OLDPWD': return quadro.anterior;
          case 'SHELL': return quadro.usuario.shell;
          case 'HOSTNAME': return maquina.hostname;
          case 'UID': return String(quadro.usuario.uid);
          case '?': return String(this.ultimoStatus);
          default: return undefined;
        }
      },
      homeDe: (nome: string | null): string | undefined => {
        if (nome === null) {
          return sessao.atual().usuario.home;
        }
        const usuario: Usuario | undefined = maquina.contas.usuario(nome);
        return usuario !== undefined ? usuario.home : undefined;
      },
    };
  }
}
