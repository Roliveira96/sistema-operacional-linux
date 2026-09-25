import type { Usuario } from './Contas';
import type { Credencial } from './SistemaDeArquivos';

/** Um shell aberto: quem está logado, onde está e com quais grupos entrou. */
export class Quadro {
  public readonly usuario: Usuario;
  /** Grupos lidos NO LOGIN: um usermod -aG só vale depois de logar de novo. */
  public readonly gids: number[];
  public cwd: string;
  public anterior: string;
  public umask: number;

  constructor(usuario: Usuario, gids: number[], cwd: string) {
    this.usuario = usuario;
    this.gids = gids;
    this.cwd = cwd;
    this.anterior = cwd;
    this.umask = usuario.uid === 0 ? 0o022 : 0o002;
  }
}

/** Pilha de shells: cada su/sudo -i empilha um quadro e o exit desempilha. */
export class Sessao {
  private readonly quadros: Quadro[] = [];
  public readonly historico: string[] = [];
  /** Usuários que já digitaram a senha do sudo (o Ubuntu lembra por 15 minutos). */
  public readonly sudoValidado: Set<string> = new Set();

  constructor(inicial: Quadro) {
    this.quadros.push(inicial);
  }

  public atual(): Quadro {
    return this.quadros[this.quadros.length - 1];
  }

  public credencial(): Credencial {
    const quadro: Quadro = this.atual();
    return { uid: quadro.usuario.uid, gids: quadro.gids };
  }

  public entrar(quadro: Quadro): void {
    this.quadros.push(quadro);
  }

  /** Fecha o shell atual. Retorna false se já estava no primeiro. */
  public sair(): boolean {
    if (this.quadros.length === 1) {
      return false;
    }
    this.quadros.pop();
    return true;
  }

  /** "~" quando estiver dentro da home de quem está logado. */
  public caminhoCurto(): string {
    const quadro: Quadro = this.atual();
    const home: string = quadro.usuario.home;
    if (quadro.cwd === home) {
      return '~';
    }
    if (home !== '/' && quadro.cwd.startsWith(home + '/')) {
      return '~' + quadro.cwd.substring(home.length);
    }
    return quadro.cwd;
  }

  public profundidade(): number {
    return this.quadros.length;
  }

  /** Quem fez o login SSH (o primeiro quadro), independente de su posteriores. */
  public usuarioDaConexao(): string {
    return this.quadros[0].usuario.nome;
  }

  public usuariosLogados(): string[] {
    return this.quadros.map((q: Quadro) => q.usuario.nome);
  }
}
