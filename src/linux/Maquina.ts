import { Arquivo, ArquivoGerado, Buraco, Diretorio, type No } from './No';
import { Contas, Grupo, Usuario } from './Contas';
import { SistemaDeArquivos } from './SistemaDeArquivos';
import { Quadro, Sessao } from './Sessao';

const BASHRC: string =
  '# ~/.bashrc: executado pelo bash(1) para shells não-login.\n' +
  "alias ll='ls -alF'\nalias la='ls -A'\nalias l='ls -CF'\n";
const PROFILE: string =
  '# ~/.profile: executado pelo interpretador de comandos para shells de login.\n' +
  'if [ -n "$BASH_VERSION" ]; then\n    . "$HOME/.bashrc"\nfi\n';
const BASH_LOGOUT: string = '# ~/.bash_logout: executado pelo bash(1) quando o shell de login termina.\n';

/**
 * Um Ubuntu inteiro em memória: sistema de arquivos, contas e o shell aberto.
 * Cada tópico começa com uma máquina nova e pode prepará-la do seu jeito.
 */
export class Maquina {
  public static readonly SENHA_PADRAO: string = '123';

  public static readonly IP: string = '192.168.0.10';

  public readonly fs: SistemaDeArquivos;
  public readonly contas: Contas;
  public readonly hostname: string = 'servidor';
  /** Um shell por terminal aberto (as "conexões SSH"). */
  private readonly sessoes: Sessao[] = [];

  public constructor(fs: SistemaDeArquivos, contas: Contas) {
    this.fs = fs;
    this.contas = contas;
  }

  public static criar(): Maquina {
    const maquina: Maquina = new Maquina(new SistemaDeArquivos(new Diretorio('', 0, 0, 0o755)), Maquina.criarContas());
    maquina.montarArvore();
    return maquina;
  }

  /** Login: lê os grupos do usuário NESTE momento e começa na home dele. */
  public abrirSessao(usuario: Usuario): Sessao {
    const home: string = this.fs.obter(usuario.home)?.ehDiretorio() ? usuario.home : '/';
    const sessao: Sessao = new Sessao(new Quadro(usuario, this.contas.gidsDe(usuario), home));
    this.sessoes.push(sessao);
    return sessao;
  }

  public fecharSessao(sessao: Sessao): void {
    const indice: number = this.sessoes.indexOf(sessao);
    if (indice >= 0) {
      this.sessoes.splice(indice, 1);
    }
  }

  /** Quem está logado em qualquer terminal (o userdel se recusa a apagar essas contas). */
  public usuariosLogados(): string[] {
    return this.sessoes.flatMap((s: Sessao) => s.usuariosLogados());
  }

  public usuariosNasConexoes(): string[] {
    return this.sessoes.map((s: Sessao) => s.usuarioDaConexao());
  }

  /** Arquivos gerados (/etc/passwd...) precisam da máquina; usados também ao restaurar do JSON. */
  public criarArquivoGerado(nome: string): ArquivoGerado | null {
    switch (nome) {
      case 'passwd': return new ArquivoGerado('passwd', 0, 0, 0o644, () => this.contas.gerarPasswd());
      case 'group': return new ArquivoGerado('group', 0, 0, 0o644, () => this.contas.gerarGroup());
      case 'shadow': return new ArquivoGerado('shadow', 0, 42, 0o640, () => this.contas.gerarShadow());
      default: return null;
    }
  }

  private static criarContas(): Contas {
    const contas: Contas = new Contas();
    contas.adicionarUsuario(new Usuario('root', 0, 0, '/root', '/bin/bash', Maquina.SENHA_PADRAO, 'root'));
    contas.adicionarUsuario(new Usuario('daemon', 1, 1, '/usr/sbin', '/usr/sbin/nologin', null, 'daemon'));
    contas.adicionarUsuario(new Usuario('bin', 2, 2, '/bin', '/usr/sbin/nologin', null, 'bin'));
    contas.adicionarUsuario(new Usuario('sys', 3, 3, '/dev', '/usr/sbin/nologin', null, 'sys'));
    contas.adicionarUsuario(new Usuario('www-data', 33, 33, '/var/www', '/usr/sbin/nologin', null, 'www-data'));
    contas.adicionarUsuario(new Usuario('nobody', 65534, 65534, '/nonexistent', '/usr/sbin/nologin', null, 'nobody'));
    contas.adicionarUsuario(new Usuario('ricardo', 1000, 1000, '/home/ricardo', '/bin/bash', Maquina.SENHA_PADRAO, 'Ricardo,,,'));
    const grupos: Array<[string, number, string[]]> = [
      ['root', 0, []], ['daemon', 1, []], ['bin', 2, []], ['sys', 3, []], ['adm', 4, ['ricardo']],
      ['cdrom', 24, ['ricardo']], ['sudo', Contas.GID_SUDO, ['ricardo']], ['www-data', 33, []], ['shadow', 42, []],
      ['plugdev', 46, ['ricardo']], ['users', 100, []], ['nogroup', 65534, []], ['ricardo', 1000, []],
    ];
    for (const [nome, gid, membros] of grupos) {
      contas.adicionarGrupo(new Grupo(nome, gid, membros));
    }
    return contas;
  }

  private montarArvore(): void {
    for (const dir of ['/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/media', '/mnt', '/opt', '/proc', '/sbin',
      '/srv', '/usr', '/usr/bin', '/usr/sbin', '/usr/share', '/var', '/var/log', '/var/www']) {
      this.criarDiretorio(dir, 0, 0, 0o755);
    }
    this.criarDiretorio('/root', 0, 0, 0o700);
    this.criarDiretorio('/tmp', 0, 0, 0o1777);
    this.colocar('/dev', new Buraco('null', 0, 0, 0o666));

    for (const nome of ['passwd', 'group', 'shadow']) {
      this.colocar('/etc', this.criarArquivoGerado(nome) as ArquivoGerado);
    }
    this.criarArquivo('/etc/hostname', 'servidor\n', 0, 0, 0o644);
    this.criarArquivo('/etc/os-release', 'PRETTY_NAME="Ubuntu 24.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\n' +
      'VERSION="24.04 LTS (Noble Numbat)"\nID=ubuntu\n', 0, 0, 0o644);
    this.criarArquivo('/etc/sudoers', '# Membros do grupo sudo podem executar qualquer comando\n%sudo\tALL=(ALL:ALL) ALL\n', 0, 0, 0o440);
    this.criarDiretorio('/etc/skel', 0, 0, 0o755);
    this.criarArquivo('/etc/skel/.bashrc', BASHRC, 0, 0, 0o644);
    this.criarArquivo('/etc/skel/.profile', PROFILE, 0, 0, 0o644);
    this.criarArquivo('/etc/skel/.bash_logout', BASH_LOGOUT, 0, 0, 0o644);
    this.criarArquivo('/root/.bashrc', BASHRC, 0, 0, 0o644);
    this.criarArquivo('/var/log/syslog', 'Sep 25 08:00:01 ubuntu systemd[1]: Started Daily apt upgrade.\n', 0, 4, 0o640);

    const ricardo: Usuario = this.contas.usuario('ricardo') as Usuario;
    this.criarHome(ricardo);
    for (const pasta of ['Área de Trabalho', 'Documentos', 'Downloads', 'Imagens', 'Modelos', 'Música', 'Público', 'Vídeos']) {
      this.criarDiretorio(ricardo.home + '/' + pasta, ricardo.uid, ricardo.gid, 0o755);
    }
  }

  /** Cria /home/usuario copiando o /etc/skel, com permissão 750 (padrão do Ubuntu desde a 21.04). */
  public criarHome(usuario: Usuario): void {
    const home: Diretorio = this.criarDiretorio(usuario.home, usuario.uid, usuario.gid, 0o750);
    const skel: No | null = this.fs.obter('/etc/skel');
    if (skel instanceof Diretorio) {
      for (const modelo of skel.filhos.values()) {
        const copia: No = modelo.clonar();
        copia.dono = usuario.uid;
        copia.grupo = usuario.gid;
        home.adicionar(copia);
      }
    }
  }

  /** Atalho de montagem dos tópicos: usuário com grupo próprio, bash, home e senha. */
  public criarUsuario(nome: string, senha: string | null, gruposExtras: string[] = []): Usuario {
    const uid: number = this.contas.proximoUid();
    const gid: number = this.contas.grupoPorGid(uid) === undefined ? uid : this.contas.proximoGid();
    this.contas.adicionarGrupo(new Grupo(nome, gid));
    const usuario: Usuario = new Usuario(nome, uid, gid, '/home/' + nome, '/bin/bash', senha, '');
    this.contas.adicionarUsuario(usuario);
    for (const nomeGrupo of gruposExtras) {
      let grupo: Grupo | undefined = this.contas.grupo(nomeGrupo);
      if (grupo === undefined) {
        grupo = new Grupo(nomeGrupo, this.contas.proximoGid());
        this.contas.adicionarGrupo(grupo);
      }
      grupo.membros.push(nome);
    }
    this.criarHome(usuario);
    return usuario;
  }

  /** Atalho de montagem (sem checar permissão): cria o diretório e os pais que faltarem. */
  public criarDiretorio(caminho: string, dono: number, grupo: number, modo: number): Diretorio {
    let atual: Diretorio = this.fs.raiz;
    for (const parte of SistemaDeArquivos.segmentos(caminho, '/')) {
      let proximo: No | undefined = atual.obter(parte);
      if (proximo === undefined) {
        proximo = new Diretorio(parte, dono, grupo, modo);
        atual.adicionar(proximo);
      }
      atual = proximo as Diretorio;
    }
    return atual;
  }

  public criarArquivo(caminho: string, conteudo: string, dono: number, grupo: number, modo: number): Arquivo {
    const partes: string[] = SistemaDeArquivos.segmentos(caminho, '/');
    const nome: string = partes.pop() as string;
    const arquivo: Arquivo = new Arquivo(nome, dono, grupo, modo, conteudo);
    this.colocar('/' + partes.join('/'), arquivo);
    return arquivo;
  }

  private colocar(pasta: string, no: No): void {
    (this.fs.obter(pasta) as Diretorio).adicionar(no);
  }

}
