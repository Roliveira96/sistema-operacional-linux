import { Comando, Opcoes, citar } from '../Comando';
import type { Contexto } from '../Contexto';
import { Diretorio, type No } from '../../linux/No';
import { SistemaDeArquivos } from '../../linux/SistemaDeArquivos';
import { exigirOperando, mensagemDe, simOuNao } from './util';

export class Rm extends Comando {
  public readonly nome: string = 'rm';
  public readonly resumo: string = 'apaga arquivos (-r apaga diretórios com tudo dentro, -f não pergunta nem reclama, -i pergunta antes)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', {
      recursive: 'r', force: 'f', interactive: 'i', verbose: 'v', dir: 'd', 'no-preserve-root': 'sem-protecao',
    });
    if (opcoes.operandos.length === 0) {
      return opcoes.tem('f') || exigirOperando('rm', [], contexto) ? 0 : 1;
    }
    const recursivo: boolean = opcoes.tem('r', 'R');
    let status: number = 0;

    for (const caminho of opcoes.operandos) {
      if (SistemaDeArquivos.absoluto(caminho, contexto.quadro.cwd) === '/' && recursivo && !opcoes.tem('sem-protecao')) {
        contexto.falhar("rm: é perigoso operar recursivamente em '/'");
        contexto.falhar('rm: use --no-preserve-root para ignorar esta proteção');
        status = 1;
        continue;
      }
      const ultimo: string = caminho.replace(/\/+$/, '').split('/').pop() ?? '';
      if (ultimo === '.' || ultimo === '..') {
        contexto.falhar("rm: recusa-se a remover os diretórios '.' ou '..': ignorando " + citar(caminho));
        status = 1;
        continue;
      }
      let no: No;
      try {
        no = contexto.localizarSemSeguir(caminho);
      } catch (erro) {
        const texto: string = mensagemDe(erro);
        if (!(opcoes.tem('f') && texto === 'Arquivo ou diretório inexistente')) {
          contexto.falhar('rm: não foi possível remover ' + citar(caminho) + ': ' + texto);
          status = 1;
        }
        continue;
      }
      if (!(await this.remover(caminho, no, opcoes, recursivo, contexto))) {
        status = 1;
      }
    }
    return status;
  }

  private async remover(caminho: string, no: No, opcoes: Opcoes, recursivo: boolean, contexto: Contexto): Promise<boolean> {
    const pai: Diretorio | null = no.pai;
    if (pai === null) {
      return false;
    }
    if (no instanceof Diretorio) {
      if (!recursivo && !(opcoes.tem('d') && no.filhos.size === 0)) {
        contexto.falhar('rm: não foi possível remover ' + citar(caminho) + ': É um diretório');
        return false;
      }
      if (no.filhos.size > 0) {
        if (opcoes.tem('i') && !simOuNao(await contexto.interacao.perguntar('rm: descer ao diretório ' + citar(caminho) + '? ', false))) {
          return true;
        }
        const podeListar: boolean = contexto.fs.pode(no, contexto.credencial, 'r') && contexto.fs.pode(no, contexto.credencial, 'x');
        if (!podeListar) {
          contexto.falhar('rm: não foi possível abrir o diretório ' + citar(caminho) + ': Permissão negada');
          return false;
        }
        let tudoOk: boolean = true;
        for (const nome of no.nomesOrdenados()) {
          tudoOk = (await this.remover(caminho.replace(/\/+$/, '') + '/' + nome, no.obter(nome) as No, opcoes, recursivo, contexto)) && tudoOk;
        }
        if (!tudoOk) {
          return false;
        }
      }
      if (opcoes.tem('i') && !simOuNao(await contexto.interacao.perguntar('rm: remover diretório ' + citar(caminho) + '? ', false))) {
        return true;
      }
    } else {
      const tipo: string = no.tamanho() === 0 ? 'arquivo comum vazio' : 'arquivo comum';
      if (opcoes.tem('i')) {
        if (!simOuNao(await contexto.interacao.perguntar('rm: remover ' + tipo + ' ' + citar(caminho) + '? ', false))) {
          return true;
        }
      } else if (!opcoes.tem('f') && !contexto.fs.pode(no, contexto.credencial, 'w')) {
        const pergunta: string = 'rm: remover ' + tipo + ' protegido contra escrita ' + citar(caminho) + '? ';
        if (!simOuNao(await contexto.interacao.perguntar(pergunta, false))) {
          return true;
        }
      }
    }
    if (!contexto.fs.podeApagar(pai, no, contexto.credencial)) {
      contexto.falhar('rm: não foi possível remover ' + citar(caminho) + ': Permissão negada');
      return false;
    }
    pai.remover(no.nome);
    if (opcoes.tem('v')) {
      contexto.linha(no instanceof Diretorio ? 'removido o diretório ' + citar(caminho) : 'removido ' + citar(caminho));
    }
    return true;
  }
}
