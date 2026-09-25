import { Comando } from '../Comando';
import type { Contexto } from '../Contexto';
import { Arquivo, Compactado, Diretorio, Link, type No } from '../../linux/No';
import { ErroDeSistema } from '../../linux/ErroDeSistema';
import { Permissoes } from '../../linux/Permissoes';
import { SistemaDeArquivos } from '../../linux/SistemaDeArquivos';
import { mensagemDe, simOuNao } from './util';

/** Um item dentro de um .tar ou .zip. */
interface Entrada {
  nome: string;
  tipo: 'd' | 'f' | 'l';
  modo: number;
  dono: number;
  grupo: number;
  conteudo?: string;
  alvo?: string;
  mtime: string;
}

/** Junta arquivos e pastas numa lista de entradas (o "empacotar" do tar e do zip). */
function coletar(caminho: string, contexto: Contexto, recursivo: boolean, erros: string[]): Entrada[] {
  const entradas: Entrada[] = [];
  const nomeGuardado = (c: string): string => c.replace(/^\/+/, '');
  const visitar = (atual: string, no: No): void => {
    const base: Entrada = { nome: nomeGuardado(atual), tipo: 'f', modo: no.modo, dono: no.dono, grupo: no.grupo, mtime: no.modificadoEm.toISOString() };
    if (no instanceof Link) {
      entradas.push({ ...base, tipo: 'l', alvo: no.alvo });
      return;
    }
    if (no instanceof Diretorio) {
      entradas.push({ ...base, tipo: 'd', nome: base.nome.replace(/\/?$/, '/') });
      if (!recursivo) return;
      if (!contexto.fs.pode(no, contexto.credencial, 'r') || !contexto.fs.pode(no, contexto.credencial, 'x')) {
        erros.push(atual + ': Não foi possível abrir: Permissão negada');
        return;
      }
      for (const nome of no.nomesOrdenados()) visitar(atual.replace(/\/$/, '') + '/' + nome, no.obter(nome) as No);
      return;
    }
    if (!contexto.fs.pode(no, contexto.credencial, 'r')) {
      erros.push(atual + ': Não foi possível abrir: Permissão negada');
      return;
    }
    entradas.push({ ...base, conteudo: no instanceof Compactado ? no.dados : (no as Arquivo).ler() });
  };
  visitar(caminho, contexto.localizarSemSeguir(caminho));
  return entradas;
}

/** Cria (ou substitui) um arquivo compactado respeitando as permissões da pasta. */
function gravarCompactado(caminho: string, formato: Compactado['formato'], dados: string, contexto: Contexto, modo?: number): void {
  const { pai, nome } = contexto.localizarPai(caminho);
  const existente: No | undefined = pai.obter(nome);
  if (existente instanceof Diretorio) throw new ErroDeSistema('EISDIR');
  if (existente !== undefined && !contexto.fs.pode(existente, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
  if (existente === undefined && !contexto.fs.pode(pai, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
  if (existente !== undefined) pai.remover(nome);
  pai.adicionar(new Compactado(nome, formato, dados, contexto.credencial.uid, contexto.fs.grupoParaNovo(pai, contexto.credencial),
    modo ?? 0o666 & ~contexto.quadro.umask));
}

/** Recria as entradas dentro de uma pasta (extrair). Root mantém os donos; os outros viram donos dos arquivos. */
function extrair(entradas: Entrada[], destino: string, contexto: Contexto, aoCriar: (e: Entrada) => void,
  perguntarSubstituir?: (nome: string) => Promise<boolean>): Promise<string[]> {
  return (async (): Promise<string[]> => {
    const erros: string[] = [];
    for (const entrada of entradas) {
      const caminho: string = SistemaDeArquivos.absoluto(entrada.nome, SistemaDeArquivos.absoluto(destino, contexto.quadro.cwd));
      try {
        const { pai, nome } = contexto.localizarPai(caminho);
        if (!contexto.fs.pode(pai, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
        const existente: No | undefined = pai.obter(nome);
        const dono: number = contexto.ehRoot() ? entrada.dono : contexto.credencial.uid;
        const grupo: number = contexto.ehRoot() ? entrada.grupo : contexto.credencial.gids[0];
        if (entrada.tipo === 'd') {
          if (!(existente instanceof Diretorio)) {
            if (existente !== undefined) pai.remover(nome);
            pai.adicionar(new Diretorio(nome, dono, grupo, entrada.modo));
          }
        } else {
          if (existente !== undefined) {
            if (perguntarSubstituir !== undefined && !(await perguntarSubstituir(entrada.nome))) continue;
            pai.remover(nome);
          }
          const novo: No = entrada.tipo === 'l' ? new Link(nome, entrada.alvo ?? '', dono, grupo) : new Arquivo(nome, dono, grupo, entrada.modo, entrada.conteudo ?? '');
          novo.modificadoEm = new Date(entrada.mtime);
          pai.adicionar(novo);
        }
        aoCriar(entrada);
      } catch (erro) {
        erros.push(entrada.nome + ': Não foi possível criar: ' + mensagemDe(erro));
      }
    }
    return erros;
  })();
}

function lerEntradasDoPacote(caminho: string, contexto: Contexto, formatos: Array<Compactado['formato']>): Entrada[] {
  const no: No = contexto.localizar(caminho);
  if (!contexto.fs.pode(no, contexto.credencial, 'r')) throw new ErroDeSistema('EACCES');
  if (!(no instanceof Compactado) || !formatos.includes(no.formato)) throw new Error('formato');
  return JSON.parse(no.dados) as Entrada[];
}

export class Tar extends Comando {
  public readonly nome: string = 'tar';
  public readonly resumo: string = 'empacota/desempacota: tar -czvf backup.tar.gz pasta | tar -tzvf (lista) | tar -xzvf (extrai) -C destino';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const letras: Set<string> = new Set();
    let arquivo: string | undefined;
    let destino: string = '.';
    const operandos: string[] = [];
    let precisaArquivo: boolean = false;
    args.forEach((arg: string, indice: number) => {
      if (precisaArquivo) {
        arquivo = arg;
        precisaArquivo = false;
        return;
      }
      const agrupado: boolean = indice === 0 && /^[a-zA-Z]+$/.test(arg);
      if (arg.startsWith('--')) {
        if (arg === '--gzip') letras.add('z');
        if (arg.startsWith('--file=')) arquivo = arg.substring(7);
        if (arg.startsWith('--directory=')) destino = arg.substring(12);
        return;
      }
      if (arg.startsWith('-') || agrupado) {
        for (const letra of arg.replace(/^-/, '')) letras.add(letra);
        if (letras.has('f') && arquivo === undefined) precisaArquivo = true;
        return;
      }
      operandos.push(arg);
    });
    const indiceC: number = operandos.indexOf('-C');
    if (letras.has('C')) {
      destino = operandos.shift() ?? '.';
    } else if (indiceC >= 0) {
      destino = operandos[indiceC + 1] ?? '.';
      operandos.splice(indiceC, 2);
    }
    const modos: string[] = ['c', 'x', 't'].filter((m: string) => letras.has(m));
    if (modos.length !== 1) {
      contexto.falhar("tar: Você deve especificar uma das opções '-Acdtrux', '--delete' ou '--test-label'");
      contexto.falhar("Tente 'tar --help' ou 'tar --usage' para mais informações.");
      return 2;
    }
    if (arquivo === undefined) {
      contexto.falhar('tar: Use a opção -f para indicar o arquivo (ex.: tar -czvf backup.tar.gz pasta)');
      return 2;
    }
    const verboso: boolean = letras.has('v');
    const alvo: string = arquivo;
    if (modos[0] === 'c') {
      if (operandos.length === 0) {
        contexto.falhar('tar: Recusando-me covardemente a criar um arquivo vazio');
        return 2;
      }
      const erros: string[] = [];
      const entradas: Entrada[] = [];
      if (operandos.some((o: string) => o.startsWith('/'))) contexto.falhar("tar: Removendo '/' inicial dos nomes dos membros");
      for (const caminho of operandos) {
        try {
          entradas.push(...coletar(caminho, contexto, true, erros));
        } catch (erro) {
          erros.push(caminho + ': Não foi possível executar stat: ' + mensagemDe(erro));
        }
      }
      for (const entrada of entradas) if (verboso) contexto.linha(entrada.nome);
      for (const erro of erros) contexto.falhar('tar: ' + erro);
      try {
        gravarCompactado(alvo, letras.has('z') ? 'tar.gz' : 'tar', JSON.stringify(entradas), contexto);
      } catch (erro) {
        contexto.falhar('tar: ' + alvo + ': Não foi possível abrir: ' + mensagemDe(erro));
        return 2;
      }
      if (erros.length > 0) {
        contexto.falhar('tar: Saindo com status de falha devido a erros anteriores');
        return 2;
      }
      return 0;
    }
    let entradas: Entrada[];
    try {
      entradas = lerEntradasDoPacote(alvo, contexto, ['tar', 'tar.gz']);
    } catch (erro) {
      if (erro instanceof ErroDeSistema) contexto.falhar('tar: ' + alvo + ': Não foi possível abrir: ' + erro.message);
      else contexto.falhar('tar: Isto não parece ser um arquivo tar');
      contexto.falhar('tar: Saindo com status de falha devido a erros anteriores');
      return 2;
    }
    if (modos[0] === 't') {
      for (const e of entradas) {
        if (!verboso) {
          contexto.linha(e.nome);
          continue;
        }
        const tipo: string = e.tipo === 'd' ? 'd' : e.tipo === 'l' ? 'l' : '-';
        const data: string = e.mtime.substring(0, 16).replace('T', ' ');
        contexto.linha(Permissoes.paraTexto(e.modo, tipo) + ' ' + contexto.contas.nomeDoUsuario(e.dono) + '/' + contexto.contas.nomeDoGrupo(e.grupo) + ' ' +
          String((e.conteudo ?? '').length).padStart(6) + ' ' + data + ' ' + e.nome + (e.tipo === 'l' ? ' -> ' + e.alvo : ''));
      }
      return 0;
    }
    const erros: string[] = await extrair(entradas, destino, contexto, (e: Entrada) => {
      if (verboso) contexto.linha(e.nome);
    });
    for (const erro of erros) contexto.falhar('tar: ' + erro);
    return erros.length > 0 ? 2 : 0;
  }
}

export class Gzip extends Comando {
  public readonly nome: string;
  public readonly resumo: string;

  constructor(nome: 'gzip' | 'gunzip' | 'zcat') {
    super();
    this.nome = nome;
    this.resumo = nome === 'gzip' ? 'compacta UM arquivo (vira arquivo.gz e o original some; -k mantém)'
      : nome === 'gunzip' ? 'descompacta um .gz' : 'mostra o conteúdo de um .gz sem descompactar';
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Set<string> = new Set(args.filter((a) => /^-[a-z]+$/.test(a)).flatMap((a) => Array.from(a.substring(1))));
    const arquivos: string[] = args.filter((a) => !/^-[a-z]+$/.test(a));
    const descompactar: boolean = this.nome !== 'gzip' || opcoes.has('d');
    if (arquivos.length === 0) {
      contexto.falhar(this.nome + ': dados compactados não serão lidos de um terminal (informe um arquivo)');
      return 1;
    }
    let status: number = 0;
    for (const caminho of arquivos) {
      try {
        const no: No = contexto.localizar(caminho);
        if (no instanceof Diretorio) {
          contexto.falhar(this.nome + ': ' + caminho + ' is a directory -- ignored');
          status = 2;
          continue;
        }
        if (!contexto.fs.pode(no, contexto.credencial, 'r')) throw new ErroDeSistema('EACCES');
        if (this.nome === 'zcat') {
          if (!(no instanceof Compactado) || no.formato !== 'gz') throw new Error('not in gzip format');
          contexto.escrever(no.dados);
          continue;
        }
        const pai: Diretorio = no.pai as Diretorio;
        if (!contexto.fs.pode(pai, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
        if (descompactar) {
          if (!/\.(gz|tgz)$/.test(no.nome)) {
            contexto.falhar(this.nome + ': ' + caminho + ': unknown suffix -- ignored');
            status = 2;
            continue;
          }
          if (!(no instanceof Compactado) || (no.formato !== 'gz' && no.formato !== 'tar.gz')) throw new Error('not in gzip format');
          const novoNome: string = no.nome.replace(/\.tgz$/, '.tar').replace(/\.gz$/, '');
          const novo: No = no.formato === 'tar.gz'
            ? new Compactado(novoNome, 'tar', no.dados, no.dono, no.grupo, no.modo)
            : new Arquivo(novoNome, no.dono, no.grupo, no.modo, no.dados);
          if (pai.obter(novoNome) !== undefined) pai.remover(novoNome);
          pai.adicionar(novo);
          if (!opcoes.has('k')) pai.remover(no.nome);
          if (opcoes.has('v')) contexto.falhar(caminho + ':\t 70.1% -- replaced with ' + novoNome);
          continue;
        }
        if (/\.gz$/.test(no.nome)) {
          contexto.falhar('gzip: ' + caminho + ' already has .gz suffix -- unchanged');
          status = 2;
          continue;
        }
        const dados: string = no instanceof Compactado ? no.dados : (no as Arquivo).ler();
        const formato: Compactado['formato'] = no instanceof Compactado && no.formato === 'tar' ? 'tar.gz' : 'gz';
        const compactado: Compactado = new Compactado(no.nome + '.gz', formato, dados, no.dono, no.grupo, no.modo);
        compactado.modificadoEm = no.modificadoEm;
        if (pai.obter(compactado.nome) !== undefined) pai.remover(compactado.nome);
        pai.adicionar(compactado);
        if (!opcoes.has('k')) pai.remover(no.nome);
        if (opcoes.has('v')) {
          const reducao: number = no.tamanho() > 0 ? 100 - (compactado.tamanho() / no.tamanho()) * 100 : 0;
          contexto.falhar(caminho + ':\t ' + reducao.toFixed(1).replace('.', ',') + '% -- ' + (opcoes.has('k') ? 'created ' : 'replaced with ') + compactado.nome);
        }
      } catch (erro) {
        contexto.falhar(this.nome + ': ' + caminho + ': ' + (erro instanceof ErroDeSistema ? erro.message : erro instanceof Error ? erro.message : String(erro)));
        status = 1;
      }
    }
    return status;
  }
}

export class Zip extends Comando {
  public readonly nome: string = 'zip';
  public readonly resumo: string = 'compacta no formato .zip (compatível com Windows): zip -r arquivo.zip pasta';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const recursivo: boolean = args.some((a) => /^-[a-z]*r/.test(a));
    const resto: string[] = args.filter((a) => !a.startsWith('-'));
    const [destino, ...itens] = resto;
    if (destino === undefined || itens.length === 0) {
      contexto.falhar('zip error: Nothing to do! (uso: zip -r arquivo.zip pasta arquivo...)');
      return 12;
    }
    const nomeZip: string = destino.endsWith('.zip') ? destino : destino + '.zip';
    const erros: string[] = [];
    const entradas: Entrada[] = [];
    for (const item of itens) {
      try {
        entradas.push(...coletar(item, contexto, recursivo, erros));
      } catch (erro) {
        contexto.falhar('\tzip warning: name not matched: ' + item + ' (' + mensagemDe(erro) + ')');
      }
    }
    for (const e of entradas) {
      contexto.linha('  adding: ' + e.nome + (e.tipo === 'd' || (e.conteudo ?? '').length < 40 ? ' (stored 0%)' : ' (deflated ' + (55 + e.nome.length % 20) + '%)'));
    }
    for (const erro of erros) contexto.falhar('zip warning: ' + erro);
    try {
      gravarCompactado(nomeZip, 'zip', JSON.stringify(entradas), contexto);
    } catch (erro) {
      contexto.falhar('zip error: Could not create output file (' + nomeZip + '): ' + mensagemDe(erro));
      return 15;
    }
    return 0;
  }
}

export class Unzip extends Comando {
  public readonly nome: string = 'unzip';
  public readonly resumo: string = 'extrai um .zip: unzip arquivo.zip [-d pasta] | unzip -l arquivo.zip (lista)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const listar: boolean = args.includes('-l');
    const sobrescrever: boolean = args.includes('-o');
    const d: number = args.indexOf('-d');
    const destino: string = d >= 0 ? args[d + 1] ?? '.' : '.';
    const arquivo: string | undefined = args.filter((a, i) => !a.startsWith('-') && i !== d + 1)[0];
    if (arquivo === undefined) {
      contexto.falhar('UnZip 6.00 · uso: unzip arquivo.zip [-d pasta] | unzip -l arquivo.zip');
      return 10;
    }
    let entradas: Entrada[];
    try {
      entradas = lerEntradasDoPacote(arquivo, contexto, ['zip']);
    } catch (erro) {
      contexto.falhar('unzip:  cannot find or open ' + arquivo + ', ' + arquivo + '.zip or ' + arquivo + '.ZIP.' + (erro instanceof ErroDeSistema ? ' (' + erro.message + ')' : ''));
      return 9;
    }
    contexto.linha('Archive:  ' + arquivo);
    if (listar) {
      contexto.linha('  Length      Date    Time    Name');
      contexto.linha('---------  ---------- -----   ----');
      let total: number = 0;
      for (const e of entradas) {
        const tamanho: number = (e.conteudo ?? '').length;
        total += tamanho;
        contexto.linha(String(tamanho).padStart(9) + '  ' + e.mtime.substring(0, 10) + ' ' + e.mtime.substring(11, 16) + '   ' + e.nome);
      }
      contexto.linha('---------                     -------');
      contexto.linha(String(total).padStart(9) + '                     ' + entradas.length + ' files');
      return 0;
    }
    let paraTodos: boolean | null = sobrescrever ? true : null;
    const erros: string[] = await extrair(entradas, destino, contexto, (e: Entrada) => {
      contexto.linha((e.tipo === 'd' ? '   creating: ' : '  inflating: ') + (destino === '.' ? '' : destino.replace(/\/$/, '') + '/') + e.nome);
    }, async (nome: string): Promise<boolean> => {
      if (paraTodos !== null) return paraTodos;
      const resposta: string = await contexto.interacao.perguntar('replace ' + nome + '? [y]es, [n]o, [A]ll, [N]one, [r]ename: ', false);
      if (resposta === 'A') paraTodos = true;
      if (resposta === 'N') paraTodos = false;
      return resposta === 'A' || simOuNao(resposta);
    });
    for (const erro of erros) contexto.falhar('unzip: ' + erro);
    return erros.length > 0 ? 1 : 0;
  }
}

export class Rsync extends Comando {
  public readonly nome: string = 'rsync';
  public readonly resumo: string = 'sincroniza pastas copiando só o que mudou: rsync -av origem/ destino/ (--delete espelha, -n simula)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const letras: Set<string> = new Set(args.filter((a) => /^-[a-zA-Z]+$/.test(a)).flatMap((a) => Array.from(a.substring(1))));
    const apagar: boolean = args.includes('--delete');
    const simular: boolean = letras.has('n') || args.includes('--dry-run');
    const verboso: boolean = letras.has('v');
    const arquivar: boolean = letras.has('a');
    const recursivo: boolean = arquivar || letras.has('r');
    const caminhos: string[] = args.filter((a) => !a.startsWith('-'));
    if (caminhos.length < 2) {
      contexto.falhar('rsync: uso: rsync [opções] ORIGEM DESTINO (ex.: rsync -av /home/ /mnt/backup/)');
      return 1;
    }
    if (caminhos.some((c) => /^[\w.-]+@[\w.-]+:/.test(c))) {
      contexto.falhar('rsync: no simulador use caminhos locais (por exemplo um disco de backup montado em /mnt/backup).');
      return 1;
    }
    const destino: string = caminhos[caminhos.length - 1].replace(/\/+$/, '') || '/';
    const lista: string[] = [];
    let enviados: number = 0;
    let total: number = 0;
    let status: number = 0;
    const cwd: string = contexto.quadro.cwd;

    for (const origem of caminhos.slice(0, -1)) {
      let raiz: No;
      try {
        raiz = contexto.localizarSemSeguir(origem);
      } catch (erro) {
        contexto.falhar('rsync: link_stat "' + SistemaDeArquivos.absoluto(origem, cwd) + '" failed: ' + mensagemDe(erro) + ' (2)');
        status = 23;
        continue;
      }
      if (raiz instanceof Diretorio && !recursivo) {
        contexto.linha('skipping directory ' + origem);
        continue;
      }
      // "origem/" copia o CONTEÚDO da pasta; "origem" copia a própria pasta para dentro do destino
      const soConteudo: boolean = origem.endsWith('/') || !(raiz instanceof Diretorio);
      const nomeBase: string = origem.replace(/\/+$/, '').split('/').pop() || '/';
      const base: string = raiz instanceof Diretorio && !soConteudo ? destino + '/' + nomeBase : destino;
      const prefixoExibido: string = raiz instanceof Diretorio && !soConteudo ? nomeBase + '/' : '';

      // 1) lista o que existe na origem (caminho relativo → nó)
      const itens: Array<[string, No]> = [];
      const visitar = (relativo: string, no: No): void => {
        itens.push([relativo, no]);
        if (!(no instanceof Diretorio)) return;
        if (!contexto.fs.pode(no, contexto.credencial, 'r') || !contexto.fs.pode(no, contexto.credencial, 'x')) {
          contexto.falhar('rsync: opendir "' + relativo + '" failed: Permissão negada (13)');
          status = 23;
          return;
        }
        for (const nome of no.nomesOrdenados()) visitar(relativo === '' ? nome : relativo + '/' + nome, no.obter(nome) as No);
      };
      if (raiz instanceof Diretorio) visitar('', raiz);
      else itens.push([raiz.nome, raiz]);

      // 2) copia o que falta ou mudou
      for (const [relativo, no] of itens) {
        const alvo: string = relativo === '' ? base : base + '/' + relativo;
        const exibido: string = relativo === '' ? (prefixoExibido === '' ? './' : prefixoExibido) : prefixoExibido + relativo + (no instanceof Diretorio ? '/' : '');
        const atual: No | null = contexto.fs.obter(SistemaDeArquivos.absoluto(alvo, cwd), false);
        if (no instanceof Diretorio) {
          if (atual instanceof Diretorio) continue;
          lista.push(exibido);
          if (!simular) this.criar(alvo, new Diretorio('x', 0, 0, arquivar ? no.modo : 0o777 & ~contexto.quadro.umask), no, arquivar, contexto);
          continue;
        }
        const conteudo: string = no instanceof Compactado ? no.dados : no instanceof Link ? '' : (no as Arquivo).ler();
        total += conteudo.length;
        const igual: boolean = atual instanceof Arquivo && (atual instanceof Compactado ? atual.dados : atual.ler()) === conteudo && (!arquivar || atual.modo === no.modo);
        if (igual) continue;
        if (!contexto.fs.pode(no, contexto.credencial, 'r')) {
          contexto.falhar('rsync: send_files failed to open "' + relativo + '": Permissão negada (13)');
          status = 23;
          continue;
        }
        lista.push(exibido);
        enviados += conteudo.length;
        if (!simular) this.criar(alvo, no.clonar(), no, arquivar, contexto);
      }

      // 3) --delete: apaga no destino o que não existe mais na origem
      const destinoRaiz: No | null = contexto.fs.obter(SistemaDeArquivos.absoluto(base, cwd));
      if (apagar && destinoRaiz instanceof Diretorio) {
        const existentes: Set<string> = new Set(itens.map(([r]) => r));
        const limpar = (pasta: Diretorio, prefixo: string): void => {
          for (const nome of pasta.nomesOrdenados()) {
            const relativo: string = prefixo === '' ? nome : prefixo + '/' + nome;
            const filho: No = pasta.obter(nome) as No;
            if (!existentes.has(relativo)) {
              lista.push('deleting ' + prefixoExibido + relativo + (filho instanceof Diretorio ? '/' : ''));
              if (!simular) pasta.remover(nome);
            } else if (filho instanceof Diretorio) {
              limpar(filho, relativo);
            }
          }
        };
        limpar(destinoRaiz, '');
      }
    }
    if (verboso) {
      contexto.linha('sending incremental file list');
      for (const item of lista) contexto.linha(item);
      contexto.linha();
      const enviado: number = enviados + lista.length * 30 + 120;
      contexto.linha('sent ' + enviado.toLocaleString('pt-BR') + ' bytes  received ' + (lista.length * 19 + 34) + ' bytes  ' + (enviado * 2).toLocaleString('pt-BR') + ',00 bytes/sec');
      contexto.linha('total size is ' + total.toLocaleString('pt-BR') + '  speedup is ' + (total / enviado).toFixed(2).replace('.', ',') + (simular ? ' (DRY RUN)' : ''));
    }
    return status;
  }

  /** Coloca o nó no destino (substituindo arquivo existente). Com -a mantém dono, grupo, permissão e data. */
  private criar(alvo: string, novo: No, original: No, arquivar: boolean, contexto: Contexto): void {
    try {
      const { pai, nome } = contexto.localizarPai(alvo);
      if (!contexto.fs.pode(pai, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
      if (novo instanceof Diretorio && novo.filhos.size > 0) novo.filhos.clear();
      novo.nome = nome;
      const preservarDono: boolean = arquivar && contexto.ehRoot();
      novo.dono = preservarDono ? original.dono : contexto.credencial.uid;
      novo.grupo = preservarDono ? original.grupo : contexto.credencial.gids[0];
      if (!arquivar) novo.modo = original.modo & ~contexto.quadro.umask;
      if (arquivar) novo.modificadoEm = new Date(original.modificadoEm.getTime());
      if (pai.obter(nome) !== undefined && !(pai.obter(nome) instanceof Diretorio)) pai.remover(nome);
      if (pai.obter(nome) === undefined) pai.adicionar(novo);
    } catch (erro) {
      contexto.falhar('rsync: mkstemp "' + alvo + '" failed: ' + mensagemDe(erro) + ' (13)');
    }
  }
}
