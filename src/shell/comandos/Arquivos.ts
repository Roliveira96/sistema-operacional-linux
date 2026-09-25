import { Comando, Opcoes, citar } from '../Comando';
import type { Contexto } from '../Contexto';
import { Arquivo, Diretorio, Link, type No } from '../../linux/No';
import { ErroDeSistema } from '../../linux/ErroDeSistema';
import { Permissoes } from '../../linux/Permissoes';
import { Interpretador } from '../Interpretador';
import { dataCompleta, exigirOperando, lerEntradas, linhasDe, mensagemDe } from './util';

export class Touch extends Comando {
  public readonly nome: string = 'touch';
  public readonly resumo: string = 'cria um arquivo vazio (ou atualiza a data de um que já existe)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args);
    if (!exigirOperando('touch', opcoes.operandos, contexto)) {
      return 1;
    }
    let status: number = 0;
    for (const caminho of opcoes.operandos) {
      try {
        const existente: No | null = this.tentar(caminho, contexto);
        if (existente !== null) {
          if (contexto.credencial.uid !== 0 && contexto.credencial.uid !== existente.dono &&
            !contexto.fs.pode(existente, contexto.credencial, 'w')) {
            throw new ErroDeSistema('EACCES');
          }
          existente.tocar();
          continue;
        }
        const { pai, nome } = contexto.localizarPai(caminho);
        if (!contexto.fs.pode(pai, contexto.credencial, 'w')) {
          throw new ErroDeSistema('EACCES');
        }
        pai.adicionar(new Arquivo(nome, contexto.credencial.uid, contexto.credencial.gids[0], 0o666 & ~contexto.quadro.umask));
      } catch (erro) {
        contexto.falhar('touch: não foi possível tocar ' + citar(caminho) + ': ' + mensagemDe(erro));
        status = 1;
      }
    }
    return status;
  }

  private tentar(caminho: string, contexto: Contexto): No | null {
    try {
      return contexto.localizar(caminho);
    } catch (erro) {
      if (erro instanceof ErroDeSistema && erro.codigo === 'ENOENT') {
        return null;
      }
      throw erro;
    }
  }
}

export class Cat extends Comando {
  public readonly nome: string = 'cat';
  public readonly resumo: string = 'mostra o conteúdo de arquivos (-n numera as linhas)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { number: 'n' });
    if (opcoes.operandos.length === 0 && contexto.entrada === null) {
      // cat > arquivo: lê o teclado até Ctrl+D (fim da entrada)
      for (;;) {
        const linha: string = await contexto.interacao.perguntar('', false);
        if (linha === '\u0004' || linha === '\u0003') return linha === '\u0003' ? 130 : 0;
        contexto.linha(linha);
      }
    }
    const entradas = lerEntradas('cat', opcoes.operandos, contexto);
    if (entradas === null) {
      return 1;
    }
    let numero: number = 1;
    for (const entrada of entradas) {
      if (!opcoes.tem('n')) {
        contexto.escrever(entrada.texto);
        continue;
      }
      for (const linha of linhasDe(entrada.texto)) {
        contexto.linha(String(numero++).padStart(6) + '\t' + linha);
      }
    }
    return entradas.length < Math.max(1, opcoes.operandos.length) ? 1 : 0;
  }
}

export class Echo extends Comando {
  public readonly nome: string = 'echo';
  public readonly resumo: string = 'imprime um texto (use > para gravar num arquivo e >> para acrescentar)';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let semQuebra: boolean = false;
    let interpretar: boolean = false;
    let i: number = 0;
    while (i < args.length && /^-[neE]+$/.test(args[i])) {
      semQuebra = semQuebra || args[i].includes('n');
      interpretar = interpretar || args[i].includes('e');
      i++;
    }
    let texto: string = args.slice(i).join(' ');
    if (interpretar) {
      texto = texto.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }
    contexto.escrever(texto + (semQuebra ? '' : '\n'));
    return 0;
  }
}

export class Printf extends Comando {
  public readonly nome: string = 'printf';
  public readonly resumo: string = 'imprime com formato: printf "%s tem %d anos\\n" Ana 20';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      contexto.falhar('printf: uso: printf formato [argumentos]');
      return 2;
    }
    const [formato, ...valores] = args;
    let i: number = 0;
    let texto: string = '';
    do {
      texto += formato.replace(/%(-?\d*)(\.\d+)?([sdfi%])/g, (_t: string, largura: string, precisao: string | undefined, tipo: string): string => {
        if (tipo === '%') return '%';
        const valor: string = valores[i++] ?? '';
        let saida: string = tipo === 's' ? valor : tipo === 'f'
          ? (Number(valor) || 0).toFixed(precisao !== undefined ? Number(precisao.substring(1)) : 6)
          : String(Math.trunc(Number(valor) || 0));
        const n: number = Math.abs(Number(largura || '0'));
        saida = largura.startsWith('-') ? saida.padEnd(n) : saida.padStart(n);
        return saida;
      });
    } while (i < valores.length && /%[sdfi]/.test(formato));
    contexto.escrever(texto.replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
    return 0;
  }
}

/** Parte comum de cp e mv: descobrir o destino final de cada origem. */
abstract class ComandoDeCopia extends Comando {
  protected destinoDe(origem: string, destino: string, destinoEhPasta: boolean): string {
    if (!destinoEhPasta) {
      return destino;
    }
    const nome: string = origem.replace(/\/+$/, '').split('/').pop() ?? origem;
    return destino.replace(/\/+$/, '') + '/' + nome;
  }

  protected ehPasta(caminho: string, contexto: Contexto): boolean {
    const no: No | null = contexto.tentarLocalizar(caminho);
    return no !== null && no.ehDiretorio();
  }

  protected validarOperandos(operandos: string[], contexto: Contexto): boolean {
    if (operandos.length === 0) {
      contexto.falhar(this.nome + ': falta operando arquivo');
      return false;
    }
    if (operandos.length === 1) {
      contexto.falhar(this.nome + ': falta o operando arquivo de destino após ' + citar(operandos[0]));
      return false;
    }
    const destino: string = operandos[operandos.length - 1];
    if (operandos.length > 2 && !this.ehPasta(destino, contexto)) {
      contexto.falhar(this.nome + ': o destino ' + citar(destino) + ' não é um diretório');
      return false;
    }
    return true;
  }
}

export class Cp extends ComandoDeCopia {
  public readonly nome: string = 'cp';
  public readonly resumo: string = 'copia arquivos (-r copia diretórios inteiros, -v mostra o que fez)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { recursive: 'r', verbose: 'v' });
    if (!this.validarOperandos(opcoes.operandos, contexto)) {
      return 1;
    }
    const origens: string[] = opcoes.operandos.slice(0, -1);
    const destino: string = opcoes.operandos[opcoes.operandos.length - 1];
    const destinoEhPasta: boolean = this.ehPasta(destino, contexto);
    const recursivo: boolean = opcoes.tem('r', 'R', 'a');
    let status: number = 0;

    for (const origem of origens) {
      let no: No;
      try {
        no = contexto.localizar(origem);
      } catch (erro) {
        contexto.falhar('cp: não foi possível obter estado de ' + citar(origem) + ': ' + mensagemDe(erro));
        status = 1;
        continue;
      }
      if (no instanceof Diretorio && !recursivo) {
        contexto.falhar('cp: -r não especificado; omitindo o diretório ' + citar(origem));
        status = 1;
        continue;
      }
      const alvo: string = this.destinoDe(origem, destino, destinoEhPasta);
      try {
        this.copiar(no, alvo, contexto);
        if (opcoes.tem('v')) {
          contexto.linha(citar(origem) + ' -> ' + citar(alvo));
        }
      } catch (erro) {
        contexto.falhar('cp: não foi possível criar ' + (no.ehDiretorio() ? 'o diretório ' : 'arquivo comum ') + citar(alvo) + ': ' + mensagemDe(erro));
        status = 1;
      }
    }
    return status;
  }

  private copiar(origem: No, caminhoDestino: string, contexto: Contexto): void {
    if (!contexto.fs.pode(origem, contexto.credencial, 'r')) {
      throw new ErroDeSistema('EACCES');
    }
    const { pai, nome } = contexto.localizarPai(caminhoDestino);
    const existente: No | undefined = pai.obter(nome);
    if (existente instanceof Arquivo && origem instanceof Arquivo) {
      if (!contexto.fs.pode(existente, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
      existente.escrever(origem.ler());
      return;
    }
    if (existente instanceof Diretorio && origem instanceof Diretorio) {
      for (const filho of origem.filhos.values()) {
        this.copiar(filho, caminhoDestino + '/' + filho.nome, contexto);
      }
      return;
    }
    if (existente !== undefined) {
      throw new ErroDeSistema(existente.ehDiretorio() ? 'EISDIR' : 'ENOTDIR');
    }
    if (!contexto.fs.pode(pai, contexto.credencial, 'w')) {
      throw new ErroDeSistema('EACCES');
    }
    const copia: No = origem.clonar();
    copia.nome = nome;
    this.ajustarDono(copia, contexto);
    pai.adicionar(copia);
  }

  /** A cópia pertence a quem copiou, e perde permissões conforme o umask. */
  private ajustarDono(no: No, contexto: Contexto): void {
    no.dono = contexto.credencial.uid;
    no.grupo = contexto.credencial.gids[0];
    no.modo = no.modo & ~contexto.quadro.umask;
    no.tocar();
    if (no instanceof Diretorio) {
      for (const filho of no.filhos.values()) this.ajustarDono(filho, contexto);
    }
  }
}

export class Mv extends ComandoDeCopia {
  public readonly nome: string = 'mv';
  public readonly resumo: string = 'move OU renomeia arquivos e diretórios (-v mostra o que fez)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { verbose: 'v' });
    if (!this.validarOperandos(opcoes.operandos, contexto)) {
      return 1;
    }
    const origens: string[] = opcoes.operandos.slice(0, -1);
    const destino: string = opcoes.operandos[opcoes.operandos.length - 1];
    const destinoEhPasta: boolean = this.ehPasta(destino, contexto);
    let status: number = 0;

    for (const origem of origens) {
      const alvo: string = this.destinoDe(origem, destino, destinoEhPasta);
      try {
        this.mover(origem, alvo, contexto);
        if (opcoes.tem('v')) {
          contexto.linha('renomeado ' + citar(origem) + ' -> ' + citar(alvo));
        }
      } catch (erro) {
        const texto: string = mensagemDe(erro);
        contexto.falhar(texto === 'Arquivo ou diretório inexistente'
          ? 'mv: não foi possível obter estado de ' + citar(origem) + ': ' + texto
          : 'mv: não foi possível mover ' + citar(origem) + ' para ' + citar(alvo) + ': ' + texto);
        status = 1;
      }
    }
    return status;
  }

  private mover(origem: string, destino: string, contexto: Contexto): void {
    const no: No = contexto.localizarSemSeguir(origem);
    const paiOrigem: Diretorio | null = no.pai;
    if (paiOrigem === null) {
      throw new ErroDeSistema('EPERM');
    }
    if (!contexto.fs.podeApagar(paiOrigem, no, contexto.credencial)) {
      throw new ErroDeSistema('EACCES');
    }
    const { pai, nome } = contexto.localizarPai(destino);
    if (!contexto.fs.pode(pai, contexto.credencial, 'w')) {
      throw new ErroDeSistema('EACCES');
    }
    for (let ancestral: Diretorio | null = pai; ancestral !== null; ancestral = ancestral.pai) {
      if (ancestral === no) throw new ErroDeSistema('EINVAL');
    }
    const existente: No | undefined = pai.obter(nome);
    if (existente === no) {
      return;
    }
    if (existente instanceof Diretorio) {
      if (!no.ehDiretorio()) throw new ErroDeSistema('EISDIR');
      if (existente.filhos.size > 0) throw new ErroDeSistema('ENOTEMPTY');
    } else if (existente !== undefined && no.ehDiretorio()) {
      throw new ErroDeSistema('ENOTDIR');
    }
    paiOrigem.remover(no.nome);
    no.nome = nome;
    pai.adicionar(no);
  }
}

export class Stat extends Comando {
  public readonly nome: string = 'stat';
  public readonly resumo: string = 'mostra os detalhes de um arquivo: permissão em número e texto, dono, grupo, datas';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'c');
    if (!exigirOperando('stat', opcoes.operandos, contexto)) {
      return 1;
    }
    let status: number = 0;
    for (const caminho of opcoes.operandos) {
      let no: No;
      try {
        no = contexto.localizar(caminho);
      } catch (erro) {
        contexto.falhar('stat: não foi possível obter estado de ' + citar(caminho) + ': ' + mensagemDe(erro));
        status = 1;
        continue;
      }
      const formato: string | undefined = opcoes.valor('c');
      if (formato !== undefined) {
        contexto.linha(formato.replace(/%a/g, Permissoes.paraOctal(no.modo)).replace(/%A/g, Permissoes.paraTexto(no.modo, no.ehDiretorio()))
          .replace(/%U/g, contexto.contas.nomeDoUsuario(no.dono)).replace(/%G/g, contexto.contas.nomeDoGrupo(no.grupo))
          .replace(/%n/g, caminho).replace(/%s/g, String(no.tamanho())));
        continue;
      }
      const tamanho: number = no.tamanho();
      const data: string = dataCompleta(no.modificadoEm);
      contexto.linha('  Arquivo: ' + caminho);
      contexto.linha('  Tamanho: ' + String(tamanho).padEnd(10) + '\tBlocos: ' + String(no.ehDiretorio() ? 8 : Math.ceil(tamanho / 4096) * 8).padEnd(10) +
        ' bloco de E/S: 4096   ' + (no.ehDiretorio() ? 'diretório' : tamanho === 0 ? 'arquivo comum vazio' : 'arquivo comum'));
      contexto.linha('Acesso: (' + Permissoes.paraOctal(no.modo, true) + '/' + Permissoes.paraTexto(no.modo, no.ehDiretorio()) + ')  Uid: (' +
        String(no.dono).padStart(5) + '/' + contexto.contas.nomeDoUsuario(no.dono).padStart(8) + ')   Gid: (' +
        String(no.grupo).padStart(5) + '/' + contexto.contas.nomeDoGrupo(no.grupo).padStart(8) + ')');
      contexto.linha('Acesso: ' + data);
      contexto.linha('Modificação: ' + data);
      contexto.linha('Alteração: ' + data);
    }
    return status;
  }
}

export class Ln extends Comando {
  public readonly nome: string = 'ln';
  public readonly resumo: string = 'cria links: ln -s ALVO NOME cria um atalho (link simbólico)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { symbolic: 's', force: 'f', verbose: 'v' });
    if (opcoes.operandos.length === 0) {
      contexto.falhar('ln: falta operando arquivo');
      return 1;
    }
    if (!opcoes.tem('s')) {
      contexto.falhar('ln: o simulador só faz links simbólicos. Use: ln -s ALVO NOME');
      return 1;
    }
    const alvo: string = opcoes.operandos[0];
    let nomeLink: string = opcoes.operandos[1] ?? (alvo.replace(/\/+$/, '').split('/').pop() ?? alvo);
    const existente: No | null = (() => {
      try { return contexto.localizar(nomeLink); } catch { return null; }
    })();
    if (existente instanceof Diretorio) {
      nomeLink = nomeLink.replace(/\/+$/, '') + '/' + (alvo.replace(/\/+$/, '').split('/').pop() ?? alvo);
    }
    try {
      const { pai, nome } = contexto.localizarPai(nomeLink);
      const atual: No | undefined = pai.obter(nome);
      if (atual !== undefined) {
        if (!opcoes.tem('f')) throw new ErroDeSistema('EEXIST');
        pai.remover(nome);
      }
      if (!contexto.fs.pode(pai, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
      pai.adicionar(new Link(nome, alvo, contexto.credencial.uid, contexto.credencial.gids[0]));
      if (opcoes.tem('v')) contexto.linha(citar(nomeLink) + ' -> ' + citar(alvo));
      return 0;
    } catch (erro) {
      contexto.falhar('ln: falhou ao criar link simbólico ' + citar(nomeLink) + ': ' + mensagemDe(erro));
      return 1;
    }
  }
}

/** nano e vim: o terminal troca para o modo tela cheia até o editor ser fechado. */
export class Editor extends Comando {
  public readonly nome: string;
  public readonly resumo: string;
  private readonly tipo: 'nano' | 'vim';

  constructor(nome: 'nano' | 'vim' | 'vi') {
    super();
    this.nome = nome;
    this.tipo = nome === 'nano' ? 'nano' : 'vim';
    this.resumo = nome === 'nano'
      ? 'editor simples: Ctrl+O grava, Ctrl+X sai'
      : 'editor modal: i insere, Esc volta ao modo normal, :w grava, :q sai, :wq grava e sai, :q! sai sem gravar';
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const caminho: string | undefined = Opcoes.ler(args).operandos[0];
    if (caminho === undefined) {
      contexto.falhar(this.nome + ': informe o arquivo a editar, por exemplo: ' + this.nome + ' notas.txt');
      return 1;
    }
    let conteudo: string = '';
    let novo: boolean = true;
    let aviso: string | null = null;
    let somenteLeitura: boolean = false;
    try {
      const no: No = contexto.localizar(caminho);
      if (no instanceof Diretorio) {
        contexto.falhar(this.nome + ': ' + caminho + ': É um diretório');
        return 1;
      }
      novo = false;
      if (contexto.fs.pode(no, contexto.credencial, 'r')) {
        conteudo = (no as Arquivo).ler();
      } else {
        aviso = 'Permissão negada para ler ' + caminho;
      }
      somenteLeitura = !contexto.fs.pode(no, contexto.credencial, 'w');
    } catch (erro) {
      const texto: string = mensagemDe(erro);
      if (texto !== 'Arquivo ou diretório inexistente') {
        aviso = texto;
      }
    }
    await contexto.interacao.editar({
      editor: this.tipo,
      caminho,
      conteudo,
      novo,
      somenteLeitura,
      aviso,
      gravar: (texto: string): string | null => {
        try {
          Interpretador.abrirParaEscrita(caminho, true, contexto.maquina, contexto.sessao, contexto.credencial).escrever(texto);
          return null;
        } catch (erro) {
          return mensagemDe(erro);
        }
      },
    });
    return 0;
  }
}
