/** Uma linha do /etc/passwd (+ a senha que ficaria no /etc/shadow). */
export class Usuario {
  public nome: string;
  public uid: number;
  public gid: number;
  public comentario: string;
  public home: string;
  public shell: string;
  /** null = sem senha definida ("!" no shadow); não dá para logar com su. */
  public senha: string | null;
  public bloqueado: boolean = false;

  constructor(nome: string, uid: number, gid: number, home: string, shell: string, senha: string | null, comentario: string = '') {
    this.nome = nome;
    this.uid = uid;
    this.gid = gid;
    this.home = home;
    this.shell = shell;
    this.senha = senha;
    this.comentario = comentario;
  }

  public clonar(): Usuario {
    const copia: Usuario = new Usuario(this.nome, this.uid, this.gid, this.home, this.shell, this.senha, this.comentario);
    copia.bloqueado = this.bloqueado;
    return copia;
  }
}

/** Uma linha do /etc/group. */
export class Grupo {
  public nome: string;
  public gid: number;
  public membros: string[];

  constructor(nome: string, gid: number, membros: string[] = []) {
    this.nome = nome;
    this.gid = gid;
    this.membros = membros;
  }

  public clonar(): Grupo {
    return new Grupo(this.nome, this.gid, this.membros.slice());
  }
}

/** O "banco" de contas: tudo que /etc/passwd, /etc/group e /etc/shadow mostram. */
export class Contas {
  public static readonly ROOT: number = 0;
  public static readonly GID_SUDO: number = 27;

  private readonly usuarios: Usuario[] = [];
  private readonly grupos: Grupo[] = [];

  public adicionarUsuario(usuario: Usuario): void {
    this.usuarios.push(usuario);
  }

  public adicionarGrupo(grupo: Grupo): void {
    this.grupos.push(grupo);
  }

  public removerUsuario(nome: string): void {
    const indice: number = this.usuarios.findIndex((u: Usuario) => u.nome === nome);
    if (indice >= 0) {
      this.usuarios.splice(indice, 1);
    }
    for (const grupo of this.grupos) {
      grupo.membros = grupo.membros.filter((m: string) => m !== nome);
    }
  }

  public removerGrupo(nome: string): void {
    const indice: number = this.grupos.findIndex((g: Grupo) => g.nome === nome);
    if (indice >= 0) {
      this.grupos.splice(indice, 1);
    }
  }

  public usuario(nome: string): Usuario | undefined {
    return this.usuarios.find((u: Usuario) => u.nome === nome);
  }

  public usuarioPorUid(uid: number): Usuario | undefined {
    return this.usuarios.find((u: Usuario) => u.uid === uid);
  }

  public grupo(nome: string): Grupo | undefined {
    return this.grupos.find((g: Grupo) => g.nome === nome);
  }

  public grupoPorGid(gid: number): Grupo | undefined {
    return this.grupos.find((g: Grupo) => g.gid === gid);
  }

  /** Aceita nome ou número, como o chown faz. */
  public acharUsuario(nomeOuUid: string): Usuario | undefined {
    return /^\d+$/.test(nomeOuUid) ? this.usuarioPorUid(Number(nomeOuUid)) : this.usuario(nomeOuUid);
  }

  public acharGrupo(nomeOuGid: string): Grupo | undefined {
    return /^\d+$/.test(nomeOuGid) ? this.grupoPorGid(Number(nomeOuGid)) : this.grupo(nomeOuGid);
  }

  public nomeDoUsuario(uid: number): string {
    const usuario: Usuario | undefined = this.usuarioPorUid(uid);
    return usuario !== undefined ? usuario.nome : String(uid);
  }

  public nomeDoGrupo(gid: number): string {
    const grupo: Grupo | undefined = this.grupoPorGid(gid);
    return grupo !== undefined ? grupo.nome : String(gid);
  }

  /** GIDs do usuário: primário primeiro, depois os suplementares. */
  public gidsDe(usuario: Usuario): number[] {
    const gids: number[] = [usuario.gid];
    for (const grupo of this.grupos) {
      if (grupo.membros.includes(usuario.nome) && !gids.includes(grupo.gid)) {
        gids.push(grupo.gid);
      }
    }
    return gids;
  }

  public listarUsuarios(): Usuario[] {
    return this.usuarios.slice();
  }

  public listarGrupos(): Grupo[] {
    return this.grupos.slice();
  }

  public proximoUid(): number {
    let uid: number = 1000;
    while (this.usuarioPorUid(uid) !== undefined || this.grupoPorGid(uid) !== undefined) {
      uid++;
    }
    return uid;
  }

  public proximoGid(): number {
    let gid: number = 1000;
    while (this.grupoPorGid(gid) !== undefined) {
      gid++;
    }
    return gid;
  }

  public gerarPasswd(): string {
    return this.usuarios.map((u: Usuario) =>
      [u.nome, 'x', u.uid, u.gid, u.comentario, u.home, u.shell].join(':')).join('\n') + '\n';
  }

  public gerarGroup(): string {
    return this.grupos.map((g: Grupo) => [g.nome, 'x', g.gid, g.membros.join(',')].join(':')).join('\n') + '\n';
  }

  public gerarShadow(): string {
    return this.usuarios.map((u: Usuario) => {
      let hash: string = u.senha === null ? (u.uid < 1000 ? '*' : '!') : Contas.hashDeMentira(u.nome + u.senha);
      if (u.bloqueado && u.senha !== null) {
        hash = '!' + hash;
      }
      return [u.nome, hash, '20356', '0', '99999', '7', '', '', ''].join(':');
    }).join('\n') + '\n';
  }

  public clonar(): Contas {
    const copia: Contas = new Contas();
    for (const usuario of this.usuarios) copia.adicionarUsuario(usuario.clonar());
    for (const grupo of this.grupos) copia.adicionarGrupo(grupo.clonar());
    return copia;
  }

  /** Só para o /etc/shadow parecer real: um "hash yescrypt" estável a partir da senha. */
  private static hashDeMentira(texto: string): string {
    const alfabeto: string = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let semente: number = 7;
    let saida: string = '';
    for (let i: number = 0; i < 65; i++) {
      semente = (semente * 31 + texto.charCodeAt(i % texto.length) + i) % 1000003;
      saida += alfabeto.charAt(semente % alfabeto.length);
    }
    return '$y$j9T$' + saida.substring(0, 22) + '$' + saida.substring(22);
  }
}
