import { Arquivo, ArquivoGerado, Binario, Buraco, Diretorio, Dispositivo, Link, type No } from './No';
import { GerenciadorDePacotes } from './Pacotes';
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
      ['tty', 5, []], ['disk', 6, []], ['mail', 8, []], ['cdrom', 24, ['ricardo']], ['sudo', Contas.GID_SUDO, ['ricardo']], ['www-data', 33, []], ['shadow', 42, []],
      ['plugdev', 46, ['ricardo']], ['users', 100, []], ['nogroup', 65534, []], ['ricardo', 1000, []],
    ];
    for (const [nome, gid, membros] of grupos) {
      contas.adicionarGrupo(new Grupo(nome, gid, membros));
    }
    return contas;
  }

  /** Monta a árvore padrão do Linux (FHS), como num Ubuntu Server 24.04 recém-instalado. */
  private montarArvore(): void {
    const pastas: Array<[string, number]> = [
      ['/boot', 0o755], ['/boot/grub', 0o755], ['/boot/efi', 0o700], ['/dev', 0o755], ['/dev/pts', 0o755], ['/dev/shm', 0o1777],
      ['/etc', 0o755], ['/home', 0o755], ['/media', 0o755], ['/mnt', 0o755], ['/opt', 0o755], ['/proc', 0o555],
      ['/root', 0o700], ['/run', 0o755], ['/srv', 0o755], ['/sys', 0o555], ['/sys/block', 0o755], ['/sys/class', 0o755],
      ['/sys/kernel', 0o755], ['/tmp', 0o1777], ['/usr', 0o755], ['/usr/bin', 0o755], ['/usr/sbin', 0o755], ['/usr/lib', 0o755],
      ['/usr/lib/modules/6.8.0-45-generic', 0o755], ['/usr/lib/systemd/system', 0o755], ['/usr/local', 0o755],
      ['/usr/local/bin', 0o755], ['/usr/local/sbin', 0o755], ['/usr/share', 0o755], ['/usr/share/doc', 0o755],
      ['/usr/share/man/man1', 0o755], ['/usr/include', 0o755], ['/var', 0o755], ['/var/backups', 0o755], ['/var/cache/apt/archives', 0o755],
      ['/var/lib/apt/lists', 0o755], ['/var/lib/dpkg', 0o755], ['/var/log/apt', 0o755], ['/var/mail', 0o775],
      ['/var/spool/cron/crontabs', 0o730], ['/var/tmp', 0o1777],
    ];
    for (const [pasta, modo] of pastas) {
      this.criarDiretorio(pasta, 0, 0, 0o755).modo = modo;
    }
    // No Ubuntu moderno /bin, /sbin e /lib são atalhos para dentro de /usr ("usrmerge").
    this.fs.raiz.adicionar(new Link('bin', 'usr/bin'));
    this.fs.raiz.adicionar(new Link('sbin', 'usr/sbin'));
    this.fs.raiz.adicionar(new Link('lib', 'usr/lib'));
    this.fs.raiz.adicionar(new Link('lib64', 'usr/lib64'));
    this.criarDiretorio('/usr/lib64', 0, 0, 0o755);

    // /boot: o kernel e o carregador de inicialização
    this.colocar('/boot', new Binario('vmlinuz-6.8.0-45-generic', 14928264, 0, 0, 0o600));
    this.colocar('/boot', new Binario('initrd.img-6.8.0-45-generic', 71368522, 0, 0, 0o644));
    this.criarArquivo('/boot/config-6.8.0-45-generic', '# Configuração usada para compilar o kernel\nCONFIG_64BIT=y\nCONFIG_EXT4_FS=y\nCONFIG_USB=y\n', 0, 0, 0o644);
    this.colocar('/boot', new Link('vmlinuz', 'vmlinuz-6.8.0-45-generic'));
    this.colocar('/boot', new Link('initrd.img', 'initrd.img-6.8.0-45-generic'));
    this.criarArquivo('/boot/grub/grub.cfg', '# NÃO EDITE ESTE ARQUIVO: gerado pelo update-grub\nmenuentry \'Ubuntu\' {\n\tlinux /boot/vmlinuz-6.8.0-45-generic root=/dev/sda2 ro\n\tinitrd /boot/initrd.img-6.8.0-45-generic\n}\n', 0, 0, 0o444);

    // /dev: cada dispositivo de hardware vira um arquivo
    this.colocar('/dev', new Buraco('null', 0, 0, 0o666));
    for (const nome of ['zero', 'random', 'urandom', 'tty']) this.colocar('/dev', new Dispositivo(nome, 'c', 0, nome === 'tty' ? 5 : 0, 0o666));
    this.colocar('/dev', new Dispositivo('tty1', 'c', 0, 5, 0o620));
    this.colocar('/dev', new Dispositivo('console', 'c', 0, 5, 0o600));
    for (const nome of ['sda', 'sda1', 'sda2']) this.colocar('/dev', new Dispositivo(nome, 'b', 0, 6, 0o660));
    this.colocar('/dev', new Dispositivo('sr0', 'b', 0, 24, 0o660));

    // /proc: janela para dentro do kernel (arquivos "virtuais", gerados na hora)
    const proc: Array<[string, string]> = [
      ['cpuinfo', 'processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\ncpu cores\t: 2\n\nprocessor\t: 1\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\ncpu cores\t: 2\n'],
      ['meminfo', 'MemTotal:        4015604 kB\nMemFree:         1987332 kB\nMemAvailable:    2843120 kB\nSwapTotal:       2097148 kB\n'],
      ['version', 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-115) (gcc 13.2.0) #45-Ubuntu SMP PREEMPT_DYNAMIC\n'],
      ['uptime', '5231.44 10318.02\n'],
      ['loadavg', '0.08 0.03 0.01 1/187 2412\n'],
    ];
    for (const [nome, conteudo] of proc) this.criarArquivo('/proc/' + nome, conteudo, 0, 0, 0o444);

    // /etc: configurações
    for (const nome of ['passwd', 'group', 'shadow']) {
      this.colocar('/etc', this.criarArquivoGerado(nome) as ArquivoGerado);
    }
    const etc: Array<[string, string, number]> = [
      ['hostname', 'servidor\n', 0o644],
      ['hosts', '127.0.0.1 localhost\n127.0.1.1 servidor\n\n# IPv6\n::1     ip6-localhost ip6-loopback\n', 0o644],
      ['os-release', 'PRETTY_NAME="Ubuntu 24.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04 LTS (Noble Numbat)"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\n', 0o644],
      ['lsb-release', 'DISTRIB_ID=Ubuntu\nDISTRIB_RELEASE=24.04\nDISTRIB_CODENAME=noble\nDISTRIB_DESCRIPTION="Ubuntu 24.04 LTS"\n', 0o644],
      ['issue', 'Ubuntu 24.04 LTS \\n \\l\n\n', 0o644],
      ['timezone', 'America/Sao_Paulo\n', 0o644],
      ['resolv.conf', 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n', 0o644],
      ['fstab', '# <sistema de arquivos>  <ponto de montagem>  <tipo>  <opções>  <dump>  <pass>\n/dev/sda2  /          ext4  defaults  0  1\n/dev/sda1  /boot/efi  vfat  umask=0077  0  1\n/swap.img  none       swap  sw  0  0\n', 0o644],
      ['shells', '# /etc/shells: shells de login válidos\n/bin/sh\n/bin/bash\n/usr/bin/bash\n', 0o644],
      ['crontab', '# /etc/crontab: agendamentos do sistema\n# m h dom mon dow user  command\n17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly\n25 6    * * *   root    test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n', 0o644],
      ['sudoers', '# Membros do grupo sudo podem executar qualquer comando\n%sudo\tALL=(ALL:ALL) ALL\n', 0o440],
    ];
    for (const [nome, conteudo, modo] of etc) this.criarArquivo('/etc/' + nome, conteudo, 0, 0, modo);
    this.criarDiretorio('/etc/ssh', 0, 0, 0o755);
    this.criarArquivo('/etc/ssh/sshd_config', '# Configuração do servidor SSH\nPort 22\nPermitRootLogin prohibit-password\nPasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM yes\n', 0, 0, 0o644);
    this.criarDiretorio('/etc/apt/sources.list.d', 0, 0, 0o755);
    this.criarArquivo('/etc/apt/sources.list.d/ubuntu.sources', 'Types: deb\nURIs: http://br.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main restricted universe multiverse\n', 0, 0, 0o644);
    this.criarDiretorio('/etc/skel', 0, 0, 0o755);
    this.criarArquivo('/etc/skel/.bashrc', BASHRC, 0, 0, 0o644);
    this.criarArquivo('/etc/skel/.profile', PROFILE, 0, 0, 0o644);
    this.criarArquivo('/etc/skel/.bash_logout', BASH_LOGOUT, 0, 0, 0o644);
    this.criarArquivo('/root/.bashrc', BASHRC, 0, 0, 0o644);

    // /usr/lib: bibliotecas compartilhadas (as "DLLs" do Linux)
    this.criarDiretorio('/usr/lib/x86_64-linux-gnu', 0, 0, 0o755);
    this.colocar('/usr/lib/x86_64-linux-gnu', new Binario('libc.so.6', 2125328, 0, 0, 0o755));
    this.colocar('/usr/lib/x86_64-linux-gnu', new Binario('libssl.so.3', 667864, 0, 0, 0o644));
    this.criarArquivo('/usr/share/doc/README', 'Documentação dos pacotes instalados fica em /usr/share/doc/<pacote>.\n', 0, 0, 0o644);

    // /var/log: registros do sistema (o grupo adm pode ler)
    this.criarArquivo('/var/log/syslog',
      'Sep 25 08:00:01 servidor systemd[1]: Started cron.service - Regular background program processing daemon.\n' +
      'Sep 25 08:00:02 servidor systemd[1]: Started ssh.service - OpenBSD Secure Shell server.\n' +
      'Sep 25 08:15:44 servidor kernel: [  932.117] EXT4-fs (sda2): error count since last fsck: 0\n' +
      'Sep 25 09:00:01 servidor CRON[1893]: (root) CMD (cd / && run-parts --report /etc/cron.hourly)\n', 0, 4, 0o640);
    this.criarArquivo('/var/log/auth.log',
      'Sep 25 07:58:12 servidor sshd[1201]: Failed password for root from 45.155.205.12 port 51234 ssh2\n' +
      'Sep 25 07:58:15 servidor sshd[1201]: Failed password for root from 45.155.205.12 port 51234 ssh2\n' +
      'Sep 25 07:58:19 servidor sshd[1205]: Failed password for invalid user admin from 45.155.205.12 port 51290 ssh2\n' +
      'Sep 25 08:30:02 servidor sshd[1512]: Accepted password for ricardo from 192.168.0.50 port 50122 ssh2\n' +
      'Sep 25 08:31:10 servidor sudo:  ricardo : TTY=pts/0 ; PWD=/home/ricardo ; USER=root ; COMMAND=/usr/bin/apt update\n', 0, 4, 0o640);
    this.criarArquivo('/var/log/kern.log', 'Sep 25 07:50:01 servidor kernel: [    0.000000] Linux version 6.8.0-45-generic\n', 0, 4, 0o640);
    this.criarArquivo('/var/log/apt/history.log', '', 0, 0, 0o644);

    // pacotes que vêm com o Ubuntu Server (cria os programas em /usr/bin e /usr/sbin) e serviços ligados
    new GerenciadorDePacotes(this).instalarBase();

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
