import { Diretorio, type No } from './No';
import { ErroDeSistema } from './ErroDeSistema';
import { Permissoes } from './Permissoes';

/** Quem está pedindo o acesso: o UID e todos os grupos da sessão. */
export interface Credencial {
  uid: number;
  gids: number[];
}

export type Acesso = 'r' | 'w' | 'x';

/** A árvore de diretórios e as regras de permissão do kernel. */
export class SistemaDeArquivos {
  public readonly raiz: Diretorio;

  constructor(raiz: Diretorio) {
    this.raiz = raiz;
  }

  /** "../docs/./a.txt" a partir de "/home/ricardo" → ["home", "docs", "a.txt"]. */
  public static segmentos(caminho: string, cwd: string): string[] {
    const completo: string = caminho.startsWith('/') ? caminho : cwd + '/' + caminho;
    const pilha: string[] = [];
    for (const parte of completo.split('/')) {
      if (parte === '' || parte === '.') {
        continue;
      }
      if (parte === '..') {
        pilha.pop();
      } else {
        pilha.push(parte);
      }
    }
    return pilha;
  }

  public static absoluto(caminho: string, cwd: string): string {
    return '/' + SistemaDeArquivos.segmentos(caminho, cwd).join('/');
  }

  /**
   * Regra clássica do Unix: se você é o dono, valem só os bits do dono;
   * senão, se está no grupo, valem os do grupo; senão, os de "outros". Root pode tudo.
   */
  public pode(no: No, credencial: Credencial, acesso: Acesso): boolean {
    const bit: number = acesso === 'r' ? 4 : acesso === 'w' ? 2 : 1;
    if (credencial.uid === 0) {
      return acesso !== 'x' || no.ehDiretorio() || (no.modo & 0o111) !== 0;
    }
    if (credencial.uid === no.dono) {
      return ((no.modo >> 6) & bit) !== 0;
    }
    if (credencial.gids.includes(no.grupo)) {
      return ((no.modo >> 3) & bit) !== 0;
    }
    return (no.modo & bit) !== 0;
  }

  /** Para apagar/renomear algo é preciso w+x no diretório pai (e respeitar o sticky bit, como no /tmp). */
  public podeApagar(pai: Diretorio, filho: No, credencial: Credencial): boolean {
    if (!this.pode(pai, credencial, 'w') || !this.pode(pai, credencial, 'x')) {
      return false;
    }
    if ((pai.modo & Permissoes.STICKY) !== 0 && credencial.uid !== 0) {
      return credencial.uid === filho.dono || credencial.uid === pai.dono;
    }
    return true;
  }

  /** Acha um nó checando a permissão de "entrar" (x) em cada diretório do caminho. */
  public localizar(caminho: string, cwd: string, credencial: Credencial): No {
    let atual: No = this.raiz;
    for (const parte of SistemaDeArquivos.segmentos(caminho, cwd)) {
      if (!(atual instanceof Diretorio)) {
        throw new ErroDeSistema('ENOTDIR');
      }
      if (!this.pode(atual, credencial, 'x')) {
        throw new ErroDeSistema('EACCES');
      }
      const proximo: No | undefined = atual.obter(parte);
      if (proximo === undefined) {
        throw new ErroDeSistema('ENOENT');
      }
      atual = proximo;
    }
    if (caminho.endsWith('/') && !atual.ehDiretorio()) {
      throw new ErroDeSistema('ENOTDIR');
    }
    return atual;
  }

  /** Acha o diretório onde algo seria criado, e o nome final. */
  public localizarPai(caminho: string, cwd: string, credencial: Credencial): { pai: Diretorio; nome: string } {
    const partes: string[] = SistemaDeArquivos.segmentos(caminho, cwd);
    const nome: string = partes.pop() ?? '';
    const pai: No = this.localizar('/' + partes.join('/'), '/', credencial);
    if (!(pai instanceof Diretorio)) {
      throw new ErroDeSistema('ENOTDIR');
    }
    if (!this.pode(pai, credencial, 'x')) {
      throw new ErroDeSistema('EACCES');
    }
    return { pai, nome };
  }

  /** Versão sem checagem de permissão, usada para conferir os desafios. */
  public obter(caminhoAbsoluto: string): No | null {
    try {
      return this.localizar(caminhoAbsoluto, '/', { uid: 0, gids: [0] });
    } catch {
      return null;
    }
  }

  public caminhoDe(no: No): string {
    const partes: string[] = [];
    let atual: No | null = no;
    while (atual !== null && atual.pai !== null) {
      partes.unshift(atual.nome);
      atual = atual.pai;
    }
    return '/' + partes.join('/');
  }
}
