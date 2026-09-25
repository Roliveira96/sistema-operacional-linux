import { Comando, Opcoes, citar } from '../Comando';
import type { Contexto } from '../Contexto';
import { Diretorio, type No } from '../../linux/No';
import { Permissoes } from '../../linux/Permissoes';
import type { Quadro } from '../../linux/Sessao';
import { classeDoNo, dataDoLs, mensagemDe, nomeParaExibir, saidaEhTerminal } from './util';

export class Pwd extends Comando {
  public readonly nome: string = 'pwd';
  public readonly resumo: string = 'mostra o diretório atual (print working directory)';
  public readonly embutido: boolean = true;

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    contexto.linha(contexto.quadro.cwd);
    return 0;
  }
}

export class Cd extends Comando {
  public readonly nome: string = 'cd';
  public readonly resumo: string = 'entra em um diretório (change directory)';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const quadro: Quadro = contexto.quadro;
    if (args.length > 1) {
      contexto.falhar('bash: cd: número excessivo de argumentos');
      return 1;
    }
    let destino: string = args.length === 0 ? quadro.usuario.home : args[0];
    if (destino === '-') {
      destino = quadro.anterior;
      contexto.linha(destino);
    }
    let no: No;
    try {
      no = contexto.localizar(destino);
    } catch (erro) {
      contexto.falhar('bash: cd: ' + args[0] + ': ' + mensagemDe(erro));
      return 1;
    }
    if (!(no instanceof Diretorio)) {
      contexto.falhar('bash: cd: ' + args[0] + ': Não é um diretório');
      return 1;
    }
    if (!contexto.fs.pode(no, contexto.credencial, 'x')) {
      contexto.falhar('bash: cd: ' + args[0] + ': Permissão negada');
      return 1;
    }
    quadro.anterior = quadro.cwd;
    quadro.cwd = contexto.fs.caminhoDe(no);
    return 0;
  }
}

export class Ls extends Comando {
  public readonly nome: string = 'ls';
  public readonly resumo: string = 'lista arquivos e diretórios (-l detalhes, -a ocultos, -h tamanhos legíveis, -R recursivo)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', {
      all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', directory: 'd',
    });
    const alvos: string[] = opcoes.operandos.length > 0 ? opcoes.operandos : ['.'];
    const soltos: Array<[string, No]> = [];
    const pastas: Array<[string, Diretorio]> = [];
    let status: number = 0;

    for (const alvo of alvos) {
      try {
        const no: No = contexto.localizar(alvo);
        if (no instanceof Diretorio && !opcoes.tem('d')) {
          pastas.push([alvo, no]);
        } else {
          soltos.push([alvo, no]);
        }
      } catch (erro) {
        contexto.falhar('ls: não foi possível acessar ' + citar(alvo) + ': ' + mensagemDe(erro));
        status = 2;
      }
    }

    if (soltos.length > 0) {
      this.imprimir(soltos, opcoes, contexto, false);
    }
    const comCabecalho: boolean = alvos.length > 1 || opcoes.tem('R');
    pastas.forEach(([nome, pasta]: [string, Diretorio], indice: number) => {
      if (soltos.length > 0 || indice > 0) {
        contexto.linha();
      }
      if (!this.listarPasta(nome, pasta, opcoes, contexto, comCabecalho)) {
        status = 2;
      }
    });
    return status;
  }

  private listarPasta(nome: string, pasta: Diretorio, opcoes: Opcoes, contexto: Contexto, comCabecalho: boolean): boolean {
    if (comCabecalho) {
      contexto.linha(nome + ':');
    }
    if (!contexto.fs.pode(pasta, contexto.credencial, 'r')) {
      contexto.falhar('ls: não foi possível abrir o diretório ' + citar(nome) + ': Permissão negada');
      return false;
    }
    const entradas: Array<[string, No]> = [];
    if (opcoes.tem('a')) {
      entradas.push(['.', pasta], ['..', pasta.pai ?? pasta]);
    }
    for (const filho of pasta.nomesOrdenados()) {
      if (filho.startsWith('.') && !opcoes.tem('a', 'A')) {
        continue;
      }
      entradas.push([filho, pasta.obter(filho) as No]);
    }
    this.imprimir(entradas, opcoes, contexto, true);

    let ok: boolean = true;
    if (opcoes.tem('R')) {
      for (const [filho, no] of entradas) {
        if (no instanceof Diretorio && filho !== '.' && filho !== '..') {
          contexto.linha();
          const caminho: string = nome === '/' ? '/' + filho : nome + '/' + filho;
          ok = this.listarPasta(caminho, no, opcoes, contexto, true) && ok;
        }
      }
    }
    return ok;
  }

  private imprimir(entradas: Array<[string, No]>, opcoes: Opcoes, contexto: Contexto, mostrarTotal: boolean): void {
    if (opcoes.tem('l')) {
      this.imprimirDetalhado(entradas, opcoes, contexto, mostrarTotal);
      return;
    }
    if (entradas.length === 0) {
      return;
    }
    const umPorLinha: boolean = opcoes.tem('1') || !saidaEhTerminal(contexto);
    entradas.forEach(([nome, no]: [string, No], indice: number) => {
      contexto.escrever(nomeParaExibir(nome, contexto), classeDoNo(no));
      contexto.escrever(umPorLinha || indice === entradas.length - 1 ? '\n' : '  ');
    });
  }

  private imprimirDetalhado(entradas: Array<[string, No]>, opcoes: Opcoes, contexto: Contexto, mostrarTotal: boolean): void {
    const linhas: string[][] = [];
    let blocos: number = 0;
    for (const [, no] of entradas) {
      const tamanho: number = no.tamanho();
      blocos += no.ehDiretorio() ? 4 : Math.ceil(tamanho / 4096) * 4;
      linhas.push([
        Permissoes.paraTexto(no.modo, no.ehDiretorio()),
        String(this.contarLinks(no)),
        contexto.contas.nomeDoUsuario(no.dono),
        contexto.contas.nomeDoGrupo(no.grupo),
        opcoes.tem('h') ? this.tamanhoLegivel(tamanho) : String(tamanho),
        dataDoLs(no.modificadoEm),
      ]);
    }
    if (mostrarTotal) {
      contexto.linha('total ' + (opcoes.tem('h') ? this.tamanhoLegivel(blocos * 1024) : String(blocos)));
    }
    const larguras: number[] = [0, 0, 0, 0, 0, 0];
    for (const colunas of linhas) {
      colunas.forEach((coluna: string, i: number) => {
        larguras[i] = Math.max(larguras[i], coluna.length);
      });
    }
    linhas.forEach((colunas: string[], indice: number) => {
      const [nome, no] = entradas[indice];
      const texto: string = colunas[0] + ' ' + colunas[1].padStart(larguras[1]) + ' ' + colunas[2].padEnd(larguras[2]) + ' ' +
        colunas[3].padEnd(larguras[3]) + ' ' + colunas[4].padStart(larguras[4]) + ' ' + colunas[5] + ' ';
      contexto.escrever(texto);
      contexto.escrever(nomeParaExibir(nome, contexto), classeDoNo(no));
      contexto.escrever('\n');
    });
  }

  private contarLinks(no: No): number {
    if (!(no instanceof Diretorio)) {
      return 1;
    }
    let links: number = 2;
    for (const filho of no.filhos.values()) {
      if (filho.ehDiretorio()) links++;
    }
    return links;
  }

  private tamanhoLegivel(bytes: number): string {
    if (bytes < 1024) {
      return String(bytes);
    }
    const unidades: string[] = ['K', 'M', 'G'];
    let valor: number = bytes / 1024;
    let i: number = 0;
    while (valor >= 1024 && i < unidades.length - 1) {
      valor /= 1024;
      i++;
    }
    return (valor < 10 ? (Math.ceil(valor * 10) / 10).toFixed(1).replace('.', ',') : String(Math.ceil(valor))) + unidades[i];
  }
}

export class Tree extends Comando {
  public readonly nome: string = 'tree';
  public readonly resumo: string = 'desenha a árvore de diretórios (-a ocultos, -d só diretórios, -L nível)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'L');
    const nivelMaximo: number = Number(opcoes.valor('L') ?? '99');
    const alvo: string = opcoes.operandos[0] ?? '.';
    let raiz: No;
    try {
      raiz = contexto.localizar(alvo);
    } catch (erro) {
      contexto.linha(alvo + '  [error opening dir]');
      contexto.linha('\n0 directories, 0 files');
      mensagemDe(erro);
      return 2;
    }
    const contagem: { pastas: number; arquivos: number } = { pastas: 0, arquivos: 0 };
    contexto.linha(alvo, classeDoNo(raiz));
    if (raiz instanceof Diretorio) {
      this.desenhar(raiz, '', 1, nivelMaximo, opcoes, contexto, contagem);
    }
    contexto.linha();
    const pastas: string = contagem.pastas + (contagem.pastas === 1 ? ' directory' : ' directories');
    const arquivos: string = contagem.arquivos + (contagem.arquivos === 1 ? ' file' : ' files');
    contexto.linha(opcoes.tem('d') ? pastas : pastas + ', ' + arquivos);
    return 0;
  }

  private desenhar(pasta: Diretorio, prefixo: string, nivel: number, nivelMaximo: number, opcoes: Opcoes,
    contexto: Contexto, contagem: { pastas: number; arquivos: number }): void {
    if (!contexto.fs.pode(pasta, contexto.credencial, 'r')) {
      return;
    }
    const nomes: string[] = pasta.nomesOrdenados().filter((nome: string) => {
      const no: No = pasta.obter(nome) as No;
      return (opcoes.tem('a') || !nome.startsWith('.')) && (!opcoes.tem('d') || no.ehDiretorio());
    });
    nomes.forEach((nome: string, indice: number) => {
      const no: No = pasta.obter(nome) as No;
      const ultimo: boolean = indice === nomes.length - 1;
      contexto.escrever(prefixo + (ultimo ? '└── ' : '├── '));
      if (no instanceof Diretorio) {
        contagem.pastas++;
        const bloqueada: boolean = !contexto.fs.pode(no, contexto.credencial, 'r');
        contexto.escrever(nome, classeDoNo(no));
        contexto.linha(bloqueada ? '  [error opening dir]' : '');
        if (nivel < nivelMaximo && !bloqueada) {
          this.desenhar(no, prefixo + (ultimo ? '    ' : '│   '), nivel + 1, nivelMaximo, opcoes, contexto, contagem);
        }
      } else {
        contagem.arquivos++;
        contexto.linha(nome, classeDoNo(no));
      }
    });
  }
}
