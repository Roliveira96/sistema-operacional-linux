import { Comando, Opcoes, citar } from '../Comando';
import type { Contexto } from '../Contexto';
import { Diretorio, type No } from '../../linux/No';
import { ErroDeSistema } from '../../linux/ErroDeSistema';
import { Permissoes } from '../../linux/Permissoes';
import { exigirOperando, mensagemDe } from './util';

export class Mkdir extends Comando {
  public readonly nome: string = 'mkdir';
  public readonly resumo: string = 'cria diretórios (-p cria os pais que faltarem, -v mostra o que fez, -m define a permissão)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'm', { parents: 'p', verbose: 'v', mode: 'm' });
    if (!exigirOperando('mkdir', opcoes.operandos, contexto)) {
      return 1;
    }
    let modo: number = 0o777 & ~contexto.quadro.umask;
    const modoPedido: string | undefined = opcoes.valor('m');
    if (modoPedido !== undefined) {
      const lido: number | null = Permissoes.lerOctal(modoPedido) ?? Permissoes.aplicarSimbolico(0o777, modoPedido, true);
      if (lido === null) {
        contexto.falhar('mkdir: modo inválido ' + citar(modoPedido));
        return 1;
      }
      modo = lido;
    }

    let status: number = 0;
    for (const caminho of opcoes.operandos) {
      const alvos: string[] = opcoes.tem('p') ? this.prefixos(caminho) : [caminho];
      for (const alvo of alvos) {
        try {
          this.criar(alvo, modo, opcoes.tem('p'), contexto, opcoes.tem('v'));
        } catch (erro) {
          contexto.falhar('mkdir: não foi possível criar o diretório ' + citar(caminho) + ': ' + mensagemDe(erro));
          status = 1;
          break;
        }
      }
    }
    return status;
  }

  /** "a/b/c" → ["a", "a/b", "a/b/c"] (para o -p). */
  private prefixos(caminho: string): string[] {
    const partes: string[] = caminho.split('/');
    const prefixos: string[] = [];
    for (let i: number = 1; i <= partes.length; i++) {
      const prefixo: string = partes.slice(0, i).join('/');
      if (partes[i - 1] !== '' && partes[i - 1] !== '.' && partes[i - 1] !== '..') {
        prefixos.push(prefixo);
      }
    }
    return prefixos;
  }

  private criar(caminho: string, modo: number, tolerarExistente: boolean, contexto: Contexto, verboso: boolean): void {
    const { pai, nome } = contexto.localizarPai(caminho);
    const existente: No | undefined = pai.obter(nome);
    if (existente !== undefined) {
      if (tolerarExistente && existente.ehDiretorio()) {
        return;
      }
      throw new ErroDeSistema('EEXIST');
    }
    if (!contexto.fs.pode(pai, contexto.credencial, 'w')) {
      throw new ErroDeSistema('EACCES');
    }
    pai.adicionar(new Diretorio(nome, contexto.credencial.uid, contexto.credencial.gids[0], modo));
    if (verboso) {
      contexto.linha('mkdir: foi criado o diretório ' + citar(caminho));
    }
  }
}

export class Rmdir extends Comando {
  public readonly nome: string = 'rmdir';
  public readonly resumo: string = 'remove diretórios VAZIOS (-p remove também os pais vazios)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { parents: 'p', verbose: 'v' });
    if (!exigirOperando('rmdir', opcoes.operandos, contexto)) {
      return 1;
    }
    let status: number = 0;
    for (const caminho of opcoes.operandos) {
      const alvos: string[] = [caminho];
      if (opcoes.tem('p')) {
        const partes: string[] = caminho.replace(/\/+$/, '').split('/');
        while (partes.length > 1) {
          partes.pop();
          if (partes.join('/') !== '') alvos.push(partes.join('/'));
        }
      }
      for (const alvo of alvos) {
        try {
          this.remover(alvo, contexto);
          if (opcoes.tem('v')) {
            contexto.linha('rmdir: removendo o diretório ' + citar(alvo));
          }
        } catch (erro) {
          contexto.falhar('rmdir: falhou em remover ' + citar(alvo) + ': ' + mensagemDe(erro));
          status = 1;
          break;
        }
      }
    }
    return status;
  }

  private remover(caminho: string, contexto: Contexto): void {
    const ultimo: string = caminho.replace(/\/+$/, '').split('/').pop() ?? '';
    if (ultimo === '.' || ultimo === '..') {
      throw new ErroDeSistema('EINVAL');
    }
    const no: No = contexto.localizar(caminho);
    if (!(no instanceof Diretorio)) {
      throw new ErroDeSistema('ENOTDIR');
    }
    if (no.filhos.size > 0) {
      throw new ErroDeSistema('ENOTEMPTY');
    }
    const pai: Diretorio | null = no.pai;
    if (pai === null) {
      throw new ErroDeSistema('EPERM');
    }
    if (!contexto.fs.podeApagar(pai, no, contexto.credencial)) {
      throw new ErroDeSistema('EACCES');
    }
    pai.remover(no.nome);
  }
}
