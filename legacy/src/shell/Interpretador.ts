import { Analisador, ErroDeSintaxe, type Ambiente, type ComandoSimples, type Palavra, type Pipeline } from './Analisador';
import { LeitorDeBlocos, type Instrucao } from './Blocos';
import { Aritmetica } from './Aritmetica';
import { Contexto, type Executor, type Interacao } from './Contexto';
import { SaidaEmTexto, SaidaParaArquivo, type Saida } from './Saida';
import type { Comando } from './Comando';
import type { RegistroDeComandos } from './RegistroDeComandos';
import type { Maquina } from '../linux/Maquina';
import { Job, type Sessao } from '../linux/Sessao';
import type { Usuario } from '../linux/Contas';
import type { Credencial } from '../linux/SistemaDeArquivos';
import type { Escopo } from '../linux/Escopo';
import type { Processo } from '../linux/Processos';
import { Arquivo, Binario, Diretorio, type No } from '../linux/No';
import { GerenciadorDePacotes, type Pacote } from '../linux/Pacotes';
import { ErroDeSistema } from '../linux/ErroDeSistema';

/** exit dentro de um script: sai só do script, com este código. */
export class SaidaDoScript {
  public readonly codigo: number;

  constructor(codigo: number) {
    this.codigo = codigo;
  }
}

/** break / continue dentro de for e while. */
class DesvioDeLaco {
  public readonly tipo: 'break' | 'continue';

  constructor(tipo: 'break' | 'continue') {
    this.tipo = tipo;
  }
}

/**
 * O "bash": lê a linha ou o script, monta if/for/while, faz a substituição de comandos $( ) e $(( )),
 * expande variáveis, chaves e curingas, liga pipes e redirecionamentos, cria processos e jobs e chama os comandos.
 */
export class Interpretador implements Executor {
  private readonly registro: RegistroDeComandos;

  constructor(registro: RegistroDeComandos) {
    this.registro = registro;
  }

  // ───────────── entrada pelo terminal ─────────────

  public async executarLinha(linha: string, maquina: Maquina, sessao: Sessao, terminal: Saida, interacao: Interacao): Promise<number> {
    this.anunciarJobs(sessao, terminal);
    const texto: string = linha.trim();
    const quadro = sessao.atual();
    if (texto === '') {
      return quadro.escopo.ultimoStatus;
    }
    sessao.historico.push(texto);
    sessao.interrompido = false;
    const contexto: Contexto = new Contexto({
      maquina, sessao, saida: terminal, erro: terminal, entrada: null, credencial: sessao.credencial(), interacao,
      executor: this, escopo: quadro.escopo, processo: null, emFundo: false,
    });
    const status: number = await this.executarTextoInterno(texto, contexto, true);
    sessao.interrompido = false;
    return status;
  }

  /** "[1]+  Concluído   sleep 5": avisos de jobs que terminaram, antes do próximo prompt. */
  public anunciarJobs(sessao: Sessao, saida: Saida): void {
    while (sessao.avisos.length > 0) {
      const job: Job = sessao.avisos.shift() as Job;
      saida.escrever('[' + job.numero + ']+  ' + job.estado().padEnd(23) + ' ' + job.comando + '\n');
    }
  }

  public ehEmbutido(nome: string): boolean {
    const comando: Comando | undefined = this.registro.obter(nome);
    return comando !== undefined && comando.embutido;
  }

  public nomesDeComandos(): string[] {
    return this.registro.nomes();
  }

  public executarTexto(texto: string, contexto: Contexto): Promise<number> {
    return this.executarTextoInterno(texto, contexto, false);
  }

  // ───────────── blocos (if, for, while) ─────────────

  private async executarTextoInterno(texto: string, contexto: Contexto, interativo: boolean): Promise<number> {
    let instrucoes: Instrucao[];
    try {
      instrucoes = new LeitorDeBlocos().ler(texto);
    } catch (erro) {
      if (erro instanceof ErroDeSintaxe) {
        contexto.falhar(erro.message);
        contexto.escopo.ultimoStatus = 2;
        return 2;
      }
      throw erro;
    }
    try {
      return await this.executarInstrucoes(instrucoes, contexto, interativo);
    } catch (erro) {
      if (erro instanceof DesvioDeLaco) return contexto.escopo.ultimoStatus;
      throw erro;
    }
  }

  private async executarInstrucoes(lista: Instrucao[], contexto: Contexto, interativo: boolean): Promise<number> {
    let status: number = contexto.escopo.ultimoStatus;
    for (const instrucao of lista) {
      if (contexto.interrompido()) return 130;
      status = await this.executarInstrucao(instrucao, contexto, interativo);
    }
    return status;
  }

  private async executarInstrucao(instrucao: Instrucao, contexto: Contexto, interativo: boolean): Promise<number> {
    switch (instrucao.tipo) {
      case 'comando':
        return this.executarComandoTexto(instrucao.texto, contexto, interativo);
      case 'se':
        for (const ramo of instrucao.ramos) {
          if ((await this.executarInstrucoes(ramo.condicao, contexto, interativo)) === 0) {
            return this.executarInstrucoes(ramo.corpo, contexto, interativo);
          }
        }
        return instrucao.senao !== null ? this.executarInstrucoes(instrucao.senao, contexto, interativo) : 0;
      case 'para': {
        const itens: string[] = instrucao.lista === null ? contexto.escopo.posicionais : await this.expandirLista(instrucao.lista, contexto);
        let status: number = 0;
        for (const item of itens) {
          if (contexto.interrompido()) return 130;
          contexto.escopo.definir(instrucao.variavel, item);
          try {
            status = await this.executarInstrucoes(instrucao.corpo, contexto, interativo);
          } catch (erro) {
            if (!(erro instanceof DesvioDeLaco)) throw erro;
            if (erro.tipo === 'break') break;
          }
        }
        return status;
      }
      case 'enquanto': {
        let status: number = 0;
        for (let voltas: number = 0; voltas < 10000; voltas++) {
          if (contexto.interrompido()) return 130;
          const condicao: number = await this.executarInstrucoes(instrucao.condicao, contexto, interativo);
          if (instrucao.ate ? condicao === 0 : condicao !== 0) break;
          try {
            status = await this.executarInstrucoes(instrucao.corpo, contexto, interativo);
          } catch (erro) {
            if (!(erro instanceof DesvioDeLaco)) throw erro;
            if (erro.tipo === 'break') break;
          }
          await new Promise((resolver) => setTimeout(resolver, 0));
        }
        return status;
      }
    }
  }

  private async expandirLista(texto: string, contexto: Contexto): Promise<string[]> {
    const pronto: string = await this.substituir(texto, contexto);
    const palavras: Palavra[] = new Analisador(this.ambiente(contexto)).analisar(pronto)
      .flatMap((p: Pipeline) => p.comandos.flatMap((c: ComandoSimples) => c.palavras));
    return palavras.flatMap((p: Palavra) => this.expandirPalavra(p, contexto));
  }

  // ───────────── uma instrução simples: aliases, $( ), pipelines ─────────────

  private async executarComandoTexto(texto: string, contexto: Contexto, interativo: boolean): Promise<number> {
    const primeira: string = texto.split(/\s+/)[0];
    if (primeira === 'break' || primeira === 'continue') {
      throw new DesvioDeLaco(primeira);
    }
    let linha: string = interativo ? this.expandirApelido(texto, contexto.escopo) : texto;
    try {
      linha = await this.substituir(linha, contexto);
    } catch (erro) {
      contexto.falhar('bash: ' + (erro instanceof Error ? erro.message : String(erro)));
      contexto.escopo.ultimoStatus = 1;
      return 1;
    }
    let pipelines: Pipeline[];
    try {
      pipelines = new Analisador(this.ambiente(contexto)).analisar(linha);
    } catch (erro) {
      if (erro instanceof ErroDeSintaxe) {
        contexto.falhar(erro.message);
        contexto.escopo.ultimoStatus = 2;
        return 2;
      }
      throw erro;
    }
    let status: number = contexto.escopo.ultimoStatus;
    for (const pipeline of pipelines) {
      if (pipeline.conector === '&&' && status !== 0) continue;
      if (pipeline.conector === '||' && status === 0) continue;
      status = pipeline.fundo ? this.iniciarJob(pipeline, contexto) : await this.executarPipeline(pipeline, contexto);
      contexto.escopo.ultimoStatus = status;
      if (contexto.interrompido()) break;
    }
    return status;
  }

  /** alias ll='ls -alF': troca a primeira palavra pelo valor do apelido. */
  private expandirApelido(texto: string, escopo: Escopo): string {
    let atual: string = texto;
    const usados: Set<string> = new Set();
    for (let i: number = 0; i < 5; i++) {
      const primeira: string = atual.split(/\s+/)[0];
      const valor: string | undefined = escopo.aliases.get(primeira);
      if (valor === undefined || usados.has(primeira)) break;
      usados.add(primeira);
      atual = valor + atual.substring(primeira.length);
    }
    return atual;
  }

  /** Substituição de comandos $(comando) e `comando`, e aritmética $(( 1 + 2 )). */
  private async substituir(texto: string, contexto: Contexto): Promise<string> {
    if (!texto.includes('$(') && !texto.includes('`')) {
      return texto;
    }
    let saida: string = '';
    let aspas: string | null = null;
    for (let i: number = 0; i < texto.length; i++) {
      const c: string = texto.charAt(i);
      if (aspas === "'") {
        saida += c;
        if (c === "'") aspas = null;
        continue;
      }
      if (c === '\\') {
        saida += c + texto.charAt(i + 1);
        i++;
        continue;
      }
      if (c === "'" && aspas === null) {
        aspas = "'";
        saida += c;
        continue;
      }
      if (c === '"') {
        aspas = aspas === '"' ? null : '"';
        saida += c;
        continue;
      }
      if (c === '$' && texto.startsWith('$((', i)) {
        const fim: number = Interpretador.fechamento(texto, i + 1);
        const expressao: string = texto.substring(i + 3, fim - 1)
          .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*|[0-9#?])\}?/g, (_t: string, nome: string) => this.ambiente(contexto).variavel(nome) ?? '0');
        saida += String(new Aritmetica((nome: string) => this.ambiente(contexto).variavel(nome)).calcular(expressao));
        i = fim;
        continue;
      }
      if (c === '$' && texto.charAt(i + 1) === '(') {
        const fim: number = Interpretador.fechamento(texto, i + 1);
        saida += this.protegerResultado(await this.capturar(texto.substring(i + 2, fim), contexto), aspas === '"');
        i = fim;
        continue;
      }
      if (c === '`') {
        const fim: number = texto.indexOf('`', i + 1);
        if (fim < 0) throw new Error('erro de sintaxe: ` sem fechamento');
        saida += this.protegerResultado(await this.capturar(texto.substring(i + 1, fim), contexto), aspas === '"');
        i = fim;
        continue;
      }
      saida += c;
    }
    return saida;
  }

  /** Posição do ")" que fecha o "(" em inicio (respeitando aspas e parênteses aninhados). */
  private static fechamento(texto: string, inicio: number): number {
    let profundidade: number = 0;
    let aspas: string | null = null;
    for (let i: number = inicio; i < texto.length; i++) {
      const c: string = texto.charAt(i);
      if (aspas !== null) {
        if (c === aspas) aspas = null;
        continue;
      }
      if (c === "'" || c === '"') aspas = c;
      else if (c === '(') profundidade++;
      else if (c === ')' && --profundidade === 0) return i;
    }
    throw new Error('erro de sintaxe: ( sem fechamento');
  }

  private async capturar(comando: string, contexto: Contexto): Promise<string> {
    const captura: SaidaEmTexto = new SaidaEmTexto();
    await this.executarTextoInterno(comando, contexto.com({ saida: captura, entrada: null }), false);
    return captura.texto.replace(/\n+$/, '');
  }

  /** O resultado de $( ) volta para a linha: sem aspas vira palavras soltas; símbolos do shell não viram operadores. */
  private protegerResultado(valor: string, entreAspas: boolean): string {
    if (entreAspas) return valor.replace(/(["\\$`])/g, '\\$1');
    return valor.replace(/\n/g, ' ').replace(/([|&;<>()$`\\"'{}#])/g, '\\$1');
  }

  // ───────────── pipelines e jobs ─────────────

  private async executarPipeline(pipeline: Pipeline, contexto: Contexto): Promise<number> {
    let entrada: string | null = contexto.entrada;
    let status: number = 0;
    for (let i: number = 0; i < pipeline.comandos.length; i++) {
      const ultimo: boolean = i === pipeline.comandos.length - 1;
      const captura: SaidaEmTexto = new SaidaEmTexto();
      status = await this.executarSimples(pipeline.comandos[i], contexto.com({ saida: ultimo ? contexto.saida : captura, entrada }));
      entrada = captura.texto;
      if (contexto.interrompido()) break;
    }
    return status;
  }

  /** comando &: vira um job; o terminal devolve o prompt na hora. */
  private iniciarJob(pipeline: Pipeline, contexto: Contexto): number {
    const sessao: Sessao = contexto.sessao;
    const processo: Processo = contexto.maquina.processos.criar(contexto.credencial.uid, pipeline.texto, sessao.tty, sessao, contexto.processo);
    processo.reutilizavel = true;
    const job: Job = new Job(sessao.novoNumeroDeJob(), processo, pipeline.texto);
    sessao.jobs.push(job);
    contexto.escopo.ultimoFundo = processo.pid;
    contexto.erro.escrever('[' + job.numero + '] ' + processo.pid + '\n');
    job.promessa = this.executarPipeline(pipeline, contexto.com({ processo, emFundo: true }));
    this.acompanharJob(job, sessao, contexto.maquina);
    return 0;
  }

  private acompanharJob(job: Job, sessao: Sessao, maquina: Maquina): void {
    (job.promessa as Promise<number>)
      .then((status: number) => { job.status = status; })
      .catch(() => { job.status = 1; })
      .finally(() => {
        job.terminou = true;
        maquina.processos.remover(job.processo);
        const i: number = sessao.jobs.indexOf(job);
        if (i >= 0) sessao.jobs.splice(i, 1);
        if (!job.emPrimeiroPlano) sessao.avisos.push(job);
      });
  }

  // ───────────── um comando: redirecionamentos, variáveis, curingas ─────────────

  private async executarSimples(comando: ComandoSimples, contexto: Contexto): Promise<number> {
    let saida: Saida = contexto.saida;
    let erro: Saida = contexto.erro;
    let entrada: string | null = contexto.entrada;

    for (const redirecionamento of comando.redirecionamentos) {
      if (redirecionamento.tipo === '2>&1') {
        erro = saida;
        continue;
      }
      if (redirecionamento.tipo === '>&2') {
        saida = erro;
        continue;
      }
      const alvo: string = (redirecionamento.alvo as Palavra).texto;
      try {
        if (redirecionamento.tipo === '<') {
          const no: No = contexto.localizar(alvo);
          if (no instanceof Diretorio) throw new ErroDeSistema('EISDIR');
          if (!contexto.fs.pode(no, contexto.credencial, 'r')) throw new ErroDeSistema('EACCES');
          entrada = (no as Arquivo).ler();
          continue;
        }
        const arquivo: Arquivo = Interpretador.abrirParaEscrita(alvo, !redirecionamento.tipo.endsWith('>>'), contexto.maquina, contexto.sessao, contexto.credencial);
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
          contexto.erro.escrever('bash: ' + alvo + ': ' + falha.message + '\n');
          return 1;
        }
        throw falha;
      }
    }

    const atribuicoes: Array<[string, string]> = [];
    const args: string[] = [];
    for (const palavra of comando.palavras) {
      if (args.length === 0 && palavra.atribuicao) {
        const i: number = palavra.texto.indexOf('=');
        atribuicoes.push([palavra.texto.substring(0, i), palavra.texto.substring(i + 1)]);
        continue;
      }
      args.push(...this.expandirPalavra(palavra, contexto));
    }
    const escopo: Escopo = contexto.escopo;
    if (args.length === 0) {
      for (const [nome, valor] of atribuicoes) escopo.definir(nome, valor);
      return 0;
    }
    // VAR=valor comando: a variável vale só para este comando
    const antes: Array<[string, string | undefined, boolean]> = atribuicoes.map(([nome]) => [nome, escopo.obter(nome), escopo.exportadas.has(nome)]);
    for (const [nome, valor] of atribuicoes) escopo.exportar(nome, valor);
    try {
      return await this.executarArgs(args, contexto.com({ saida, erro, entrada }));
    } finally {
      for (const [nome, valor, exportada] of antes) {
        if (valor === undefined) escopo.remover(nome);
        else {
          escopo.definir(nome, valor);
          if (!exportada) escopo.exportadas.delete(nome);
        }
      }
    }
  }

  // ───────────── achar e rodar o programa ─────────────

  /** Procura o comando: embutido do bash → caminho com / → pastas do $PATH. Cria o processo e roda. */
  public async executarArgs(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      return 0;
    }
    const nome: string = args[0];
    const embutido: Comando | undefined = this.registro.obter(nome);
    if (embutido !== undefined && embutido.embutido) {
      return this.rodarComando(embutido, args, contexto);
    }
    let caminho: string | null = null;
    if (nome.includes('/')) {
      caminho = nome;
    } else {
      for (const pasta of contexto.escopo.caminhos()) {
        if (contexto.fs.obter(pasta + '/' + nome) !== null) {
          caminho = pasta + '/' + nome;
          break;
        }
      }
    }
    if (caminho === null) {
      const fornecedor: Pacote | undefined = GerenciadorDePacotes.fornecedor(nome);
      if (fornecedor !== undefined) {
        contexto.falhar('O comando \'' + nome + '\' não foi encontrado, mas pode ser instalado com:');
        contexto.falhar((contexto.ehRoot() ? '' : 'sudo ') + 'apt install ' + fornecedor.nome);
      } else {
        contexto.falhar(nome + ': comando não encontrado');
      }
      return 127;
    }
    let no: No;
    try {
      no = contexto.localizar(caminho);
    } catch (erro) {
      contexto.falhar('bash: ' + nome + ': ' + (erro instanceof ErroDeSistema ? erro.message : String(erro)));
      return 127;
    }
    if (no instanceof Diretorio) {
      contexto.falhar('bash: ' + nome + ': É um diretório');
      return 126;
    }
    const binario: boolean = no instanceof Binario;
    if (!contexto.fs.pode(no, contexto.credencial, 'x') || (!binario && !contexto.fs.pode(no, contexto.credencial, 'r'))) {
      contexto.falhar('bash: ' + nome + ': Permissão negada');
      return 126;
    }
    const arquivo: No = no;
    const caminhoFinal: string = caminho;
    return this.comProcesso(args.join(' '), contexto, async (filho: Contexto): Promise<number> => {
      if (arquivo instanceof Binario) {
        const programa: Comando | undefined = this.registro.obter(arquivo.nome);
        return programa !== undefined ? this.rodarComando(programa, [arquivo.nome, ...args.slice(1)], filho) : 0;
      }
      return this.rodarScript(arquivo as Arquivo, caminhoFinal, args.slice(1), filho);
    });
  }

  private async rodarComando(comando: Comando, args: string[], contexto: Contexto): Promise<number> {
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

  /** Registra o processo (aparece no ps, recebe kill, Ctrl+C e Ctrl+Z) enquanto o comando roda. */
  private async comProcesso(textoComando: string, contexto: Contexto, rodar: (filho: Contexto) => Promise<number>): Promise<number> {
    const tabela = contexto.maquina.processos;
    let processo: Processo;
    if (contexto.processo !== null && contexto.processo.reutilizavel) {
      processo = contexto.processo;
      processo.reutilizavel = false;
    } else {
      processo = tabela.criar(contexto.credencial.uid, textoComando, contexto.sessao.tty, contexto.sessao, contexto.processo);
      if (contexto.processo?.nohup) processo.nohup = true;
    }
    const proprio: boolean = processo !== contexto.processo;
    const filho: Contexto = contexto.com({ processo });
    const sessao: Sessao = contexto.sessao;
    if (contexto.emFundo) {
      try {
        return await rodar(filho);
      } finally {
        if (proprio) tabela.remover(processo);
      }
    }
    sessao.primeiroPlano.push(processo);
    const execucao: Promise<number> = rodar(filho);
    let virouJob: boolean = false;
    try {
      const resultado: number | 'suspenso' = await Promise.race([execucao, processo.suspensao()]);
      if (resultado === 'suspenso') {
        // Ctrl+Z: o comando fica parado, como um job
        virouJob = true;
        const job: Job = new Job(sessao.novoNumeroDeJob(), processo, textoComando);
        job.promessa = execucao;
        sessao.jobs.push(job);
        this.acompanharJob(job, sessao, contexto.maquina);
        contexto.erro.escrever('\n[' + job.numero + ']+  Parado                  ' + textoComando + '\n');
        return 148;
      }
      if (processo.sinal === 15) contexto.erro.escrever('Terminado\n');
      if (processo.sinal === 9) contexto.erro.escrever('Morto\n');
      return processo.sinal !== null ? 128 + processo.sinal : resultado;
    } finally {
      const i: number = sessao.primeiroPlano.indexOf(processo);
      if (i >= 0) sessao.primeiroPlano.splice(i, 1);
      if (proprio && !virouJob) tabela.remover(processo);
    }
  }

  /** Script: roda num escopo filho ($1, $2... e só o ambiente exportado). exit sai só do script. */
  private async rodarScript(arquivo: Arquivo, caminho: string, argumentos: string[], contexto: Contexto): Promise<number> {
    const escopo: Escopo = contexto.escopo.filho(caminho, argumentos);
    try {
      return await this.executarTextoInterno(arquivo.ler(), contexto.com({ escopo }), false);
    } catch (erro) {
      if (erro instanceof SaidaDoScript) return erro.codigo;
      throw erro;
    }
  }

  /** bash script.sh: roda o arquivo sem precisar de permissão x (só r). */
  public async executarScript(caminho: string, argumentos: string[], contexto: Contexto, exigirExecucao: boolean): Promise<number> {
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
    if (!contexto.fs.pode(no, contexto.credencial, 'r') || (exigirExecucao && !contexto.fs.pode(no, contexto.credencial, 'x'))) {
      contexto.falhar('bash: ' + caminho + ': Permissão negada');
      return 126;
    }
    if (no instanceof Binario) {
      contexto.falhar(caminho + ': ' + caminho + ': não é possível executar o arquivo binário');
      return 126;
    }
    return this.rodarScript(no as Arquivo, caminho, argumentos, contexto);
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
    const novo: Arquivo = new Arquivo(nome, credencial.uid, maquina.fs.grupoParaNovo(pai, credencial), 0o666 & ~sessao.atual().umask);
    pai.adicionar(novo);
    return novo;
  }

  // ───────────── expansões ─────────────

  /** Uma palavra pode virar várias: chaves ({a,b} e {1..5}) e depois curingas (*.txt). */
  private expandirPalavra(palavra: Palavra, contexto: Contexto): string[] {
    const textos: string[] = palavra.chaves ? Interpretador.expandirChaves(palavra.texto) : [palavra.texto];
    if (textos.length === 1 && textos[0] === palavra.texto) {
      return this.expandirCuringas(palavra, contexto);
    }
    return textos.flatMap((texto: string) => this.expandirCuringas({
      texto, coringas: Array.from(texto).map((c: string) => c === '*' || c === '?'), atribuicao: false, chaves: false,
    }, contexto));
  }

  /** mkdir site/{css,js}  →  site/css site/js;  {1..3} → 1 2 3. */
  public static expandirChaves(texto: string): string[] {
    const achado: RegExpMatchArray | null = texto.match(/^(.*?)\{([^{}]*)\}(.*)$/);
    if (achado === null) return [texto];
    const [, antes, meio, depois] = achado;
    let itens: string[];
    const faixa: RegExpMatchArray | null = meio.match(/^(-?\d+)\.\.(-?\d+)$/) ?? meio.match(/^([a-z])\.\.([a-z])$/);
    if (faixa !== null) {
      const numerico: boolean = /\d/.test(faixa[1]);
      const inicio: number = numerico ? Number(faixa[1]) : faixa[1].charCodeAt(0);
      const fim: number = numerico ? Number(faixa[2]) : faixa[2].charCodeAt(0);
      const passo: number = inicio <= fim ? 1 : -1;
      itens = [];
      for (let n: number = inicio; passo > 0 ? n <= fim : n >= fim; n += passo) {
        itens.push(numerico ? String(n) : String.fromCharCode(n));
        if (itens.length > 1000) break;
      }
    } else if (meio.includes(',')) {
      itens = meio.split(',');
    } else {
      return [texto];
    }
    return itens.flatMap((item: string) => Interpretador.expandirChaves(antes + item + depois));
  }

  /** *.txt → a.txt b.txt. Sem nenhum resultado, o bash passa o texto literal (e o comando reclama). */
  private expandirCuringas(palavra: Palavra, contexto: Contexto): string[] {
    if (!palavra.coringas.some((c: boolean) => c)) {
      return [palavra.texto];
    }
    const maquina: Maquina = contexto.maquina;
    const credencial: Credencial = contexto.credencial;
    const cwd: string = contexto.quadro.cwd;
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
          pasta = maquina.fs.localizar(base === '' ? '.' : base, cwd, credencial);
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
        const no: No | null = maquina.fs.obter(c.startsWith('/') ? c : cwd + '/' + c);
        return no !== null && no.ehDiretorio();
      }).map((c: string) => c + '/');
    }
    return resultado.length > 0 ? resultado : [palavra.texto];
  }

  /** $HOME, $1, $#, $?, $$, $!, $RANDOM... */
  private ambiente(contexto: Contexto): Ambiente {
    const escopo: Escopo = contexto.escopo;
    return {
      variavel: (nome: string): string | undefined => {
        const quadro = contexto.sessao.atual();
        if (/^[0-9]+$/.test(nome)) return nome === '0' ? escopo.nome : escopo.posicionais[Number(nome) - 1] ?? '';
        switch (nome) {
          case '?': return String(escopo.ultimoStatus);
          case '#': return String(escopo.posicionais.length);
          case '@':
          case '*': return escopo.posicionais.join(' ');
          case '$': return String(quadro.pid);
          case '!': return escopo.ultimoFundo !== null ? String(escopo.ultimoFundo) : '';
          case 'PWD': return quadro.cwd;
          case 'OLDPWD': return quadro.anterior;
          case 'UID': return String(quadro.usuario.uid);
          case 'HOSTNAME': return contexto.maquina.hostname;
          case 'RANDOM': return String(Math.floor(Math.random() * 32768));
          default: return escopo.obter(nome);
        }
      },
      homeDe: (nome: string | null): string | undefined => {
        if (nome === null) {
          return escopo.obter('HOME') ?? contexto.sessao.atual().usuario.home;
        }
        const usuario: Usuario | undefined = contexto.maquina.contas.usuario(nome);
        return usuario !== undefined ? usuario.home : undefined;
      },
    };
  }
}
