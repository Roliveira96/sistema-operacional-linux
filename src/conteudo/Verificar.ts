import type { Maquina } from '../linux/Maquina';
import { Arquivo, Diretorio, type No } from '../linux/No';
import type { Grupo, Usuario } from '../linux/Contas';

/** Perguntas prontas sobre o estado da máquina, usadas pelos desafios. */
export class Verificar {
  public static no(maquina: Maquina, caminho: string): No | null {
    return maquina.fs.obter(caminho);
  }

  public static diretorio(maquina: Maquina, caminho: string): boolean {
    return maquina.fs.obter(caminho) instanceof Diretorio;
  }

  public static arquivo(maquina: Maquina, caminho: string): boolean {
    const no: No | null = maquina.fs.obter(caminho);
    return no instanceof Arquivo;
  }

  public static naoExiste(maquina: Maquina, caminho: string): boolean {
    return maquina.fs.obter(caminho) === null;
  }

  public static conteudo(maquina: Maquina, caminho: string): string | null {
    const no: No | null = maquina.fs.obter(caminho);
    return no instanceof Arquivo ? no.ler() : null;
  }

  public static contem(maquina: Maquina, caminho: string, trecho: string): boolean {
    return (Verificar.conteudo(maquina, caminho) ?? '').toLowerCase().includes(trecho.toLowerCase());
  }

  public static modo(maquina: Maquina, caminho: string, modo: number): boolean {
    const no: No | null = maquina.fs.obter(caminho);
    return no !== null && (no.modo & 0o777) === modo;
  }

  public static dono(maquina: Maquina, caminho: string, usuario: string, grupo?: string): boolean {
    const no: No | null = maquina.fs.obter(caminho);
    if (no === null) return false;
    const okDono: boolean = maquina.contas.nomeDoUsuario(no.dono) === usuario;
    return grupo === undefined ? okDono : okDono && maquina.contas.nomeDoGrupo(no.grupo) === grupo;
  }

  public static grupoDoNo(maquina: Maquina, caminho: string, grupo: string): boolean {
    const no: No | null = maquina.fs.obter(caminho);
    return no !== null && maquina.contas.nomeDoGrupo(no.grupo) === grupo;
  }

  public static usuario(maquina: Maquina, nome: string): Usuario | undefined {
    return maquina.contas.usuario(nome);
  }

  public static grupo(maquina: Maquina, nome: string): Grupo | undefined {
    return maquina.contas.grupo(nome);
  }

  public static membro(maquina: Maquina, usuario: string, grupo: string): boolean {
    const u: Usuario | undefined = maquina.contas.usuario(usuario);
    const g: Grupo | undefined = maquina.contas.grupo(grupo);
    return u !== undefined && g !== undefined && (g.membros.includes(usuario) || u.gid === g.gid);
  }

  public static vazio(maquina: Maquina, caminho: string): boolean {
    const no: No | null = maquina.fs.obter(caminho);
    return no instanceof Diretorio && no.filhos.size === 0;
  }
}
