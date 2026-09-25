import type { Maquina } from './Maquina';
import { Arquivo, Binario, Diretorio, Link, type No } from './No';
import { SistemaDeArquivos } from './SistemaDeArquivos';

/** Arquivo que um pacote instala. "config" = fica no sistema após remove (sai só com purge). */
export interface ArquivoDoPacote {
  caminho: string;
  conteudo?: string;
  modo?: number;
  pasta?: boolean;
  config?: boolean;
  dono?: [number, number];
}

export interface DefinicaoDeServico {
  nome: string;
  descricao: string;
  execucao: string;
  processos: string[];
  documentacao: string;
}

export interface Pacote {
  nome: string;
  versao: string;
  /** Versão que aparece depois do apt update (pacote com atualização pendente). */
  versaoNova?: string;
  secao: string;
  repositorio: 'main' | 'universe';
  baixarKb: number;
  instaladoKb: number;
  descricao: string;
  dependencias: string[];
  /** Programas: "bin/nome" vai para /usr/bin, "sbin/nome" para /usr/sbin. */
  programas: string[];
  arquivos: ArquivoDoPacote[];
  servico?: DefinicaoDeServico;
  /** Já vem instalado no Ubuntu Server. */
  base?: boolean;
  /** Essencial: o apt se recusa a remover. */
  essencial?: boolean;
}

const BYTES: Record<string, number> = {
  bash: 1446024, ls: 142312, cp: 141832, mv: 137752, rm: 59912, cat: 35280, grep: 186824, nano: 283264, vim: 3977432,
  sudo: 277936, passwd: 64152, apt: 18728, dpkg: 318568, systemctl: 1485896, python3: 7934624, sshd: 921288, nginx: 1305376,
  git: 3801344, curl: 272232, htop: 334584, tree: 90936, mysqld: 64321528, apache2: 715672,
};

function bin(nomes: string, prefixo: string = 'bin'): string[] {
  return nomes.split(' ').map((n: string) => prefixo + '/' + n);
}

const NGINX_INDEX: string =
  '<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n' +
  '<p>If you see this page, the nginx web server is successfully installed and\nworking. Further configuration is required.</p>\n' +
  '<p><em>Thank you for using nginx.</em></p>\n</body>\n</html>\n';

const APACHE_INDEX: string =
  '<!DOCTYPE html>\n<html>\n<head><title>Apache2 Ubuntu Default Page: It works</title></head>\n<body>\n' +
  '<h1>It works!</h1>\n<p>This is the default welcome page used to test the correct operation of the Apache2 server after installation on Ubuntu systems.</p>\n' +
  '</body>\n</html>\n';

/** O "repositório" do Ubuntu 24.04 (noble) que o simulador conhece. */
export const CATALOGO: Pacote[] = [
  // ─── já instalados no Ubuntu Server ───
  { nome: 'coreutils', versao: '9.4-3ubuntu6', secao: 'utils', repositorio: 'main', baixarKb: 1413, instaladoKb: 7340, base: true, essencial: true,
    descricao: 'GNU core utilities', dependencias: [], arquivos: [],
    programas: bin('ls cp mv rm mkdir rmdir touch cat echo pwd chmod chown chgrp ln head tail wc sort cut stat whoami id groups date uname df who') },
  { nome: 'bash', versao: '5.2.21-2ubuntu4', secao: 'shells', repositorio: 'main', baixarKb: 794, instaladoKb: 1864, base: true, essencial: true,
    descricao: 'GNU Bourne Again SHell', dependencias: [], arquivos: [], programas: bin('bash') },
  { nome: 'grep', versao: '3.11-4build1', secao: 'utils', repositorio: 'main', baixarKb: 162, instaladoKb: 772, base: true, essencial: true,
    descricao: 'GNU grep, egrep and fgrep', dependencias: [], arquivos: [], programas: bin('grep') },
  { nome: 'passwd', versao: '1:4.13+dfsg1-4ubuntu3', secao: 'admin', repositorio: 'main', baixarKb: 845, instaladoKb: 2560, base: true, essencial: true,
    descricao: 'change and administer password and group data', dependencias: [], arquivos: [],
    programas: [...bin('passwd gpasswd'), ...bin('useradd userdel usermod groupadd groupdel groupmod', 'sbin')] },
  { nome: 'login', versao: '1:4.13+dfsg1-4ubuntu3', secao: 'admin', repositorio: 'main', baixarKb: 202, instaladoKb: 700, base: true, essencial: true,
    descricao: 'system login tools', dependencias: [], arquivos: [], programas: bin('su') },
  { nome: 'adduser', versao: '3.137ubuntu1', secao: 'admin', repositorio: 'main', baixarKb: 101, instaladoKb: 590, base: true,
    descricao: 'add and remove users and groups', dependencias: [], arquivos: [], programas: bin('adduser deluser addgroup delgroup', 'sbin') },
  { nome: 'sudo', versao: '1.9.15p5-3ubuntu5', secao: 'admin', repositorio: 'main', baixarKb: 947, instaladoKb: 3520, base: true,
    descricao: 'Provide limited super user privileges to specific users', dependencias: [], arquivos: [], programas: bin('sudo') },
  { nome: 'apt', versao: '2.7.14build2', secao: 'admin', repositorio: 'main', baixarKb: 1377, instaladoKb: 4156, base: true, essencial: true,
    descricao: 'commandline package manager', dependencias: [], arquivos: [], programas: bin('apt apt-get apt-cache') },
  { nome: 'dpkg', versao: '1.22.6ubuntu6', secao: 'admin', repositorio: 'main', baixarKb: 1281, instaladoKb: 6584, base: true, essencial: true,
    descricao: 'Debian package management system', dependencias: [], arquivos: [], programas: bin('dpkg') },
  { nome: 'systemd', versao: '255.4-1ubuntu8', secao: 'admin', repositorio: 'main', baixarKb: 3475, instaladoKb: 11210, base: true, essencial: true,
    descricao: 'system and service manager', dependencias: [], arquivos: [], programas: bin('systemctl') },
  { nome: 'debianutils', versao: '5.17build1', secao: 'utils', repositorio: 'main', baixarKb: 89, instaladoKb: 206, base: true, essencial: true,
    descricao: 'Miscellaneous utilities specific to Debian', dependencias: [], arquivos: [], programas: bin('which') },
  { nome: 'procps', versao: '2:4.0.4-4ubuntu3', secao: 'admin', repositorio: 'main', baixarKb: 708, instaladoKb: 2156, base: true,
    descricao: '/proc file system utilities', dependencias: [], arquivos: [], programas: bin('free') },
  { nome: 'util-linux', versao: '2.39.3-9ubuntu6', secao: 'utils', repositorio: 'main', baixarKb: 1128, instaladoKb: 4580, base: true, essencial: true,
    descricao: 'miscellaneous system utilities', dependencias: [], arquivos: [], programas: bin('lsblk') },
  { nome: 'hostname', versao: '3.23+nmu2ubuntu2', secao: 'admin', repositorio: 'main', baixarKb: 11, instaladoKb: 47, base: true, essencial: true,
    descricao: 'utility to set/show the host name or domain name', dependencias: [], arquivos: [], programas: bin('hostname') },
  { nome: 'ncurses-bin', versao: '6.4+20240113-1ubuntu2', secao: 'utils', repositorio: 'main', baixarKb: 188, instaladoKb: 652, base: true,
    descricao: 'terminal-related programs and man pages', dependencias: [], arquivos: [], programas: bin('clear') },
  { nome: 'man-db', versao: '2.12.0-4build2', secao: 'doc', repositorio: 'main', baixarKb: 1237, instaladoKb: 2796, base: true,
    descricao: 'tools for reading manual pages', dependencias: [], arquivos: [], programas: bin('man') },
  { nome: 'lsb-release', versao: '12.0-2', secao: 'misc', repositorio: 'main', baixarKb: 6, instaladoKb: 23, base: true,
    descricao: 'Linux Standard Base version reporting utility', dependencias: [], arquivos: [], programas: bin('lsb_release') },
  { nome: 'nano', versao: '7.2-2build1', secao: 'editors', repositorio: 'main', baixarKb: 281, instaladoKb: 881, base: true,
    descricao: 'small, friendly text editor inspired by Pico', dependencias: [], arquivos: [], programas: bin('nano') },
  { nome: 'vim', versao: '2:9.1.0016-1ubuntu7', secao: 'editors', repositorio: 'main', baixarKb: 1789, instaladoKb: 4064, base: true,
    descricao: 'Vi IMproved - enhanced vi editor', dependencias: [], arquivos: [], programas: bin('vim vi') },
  { nome: 'python3', versao: '3.12.3-0ubuntu2', secao: 'python', repositorio: 'main', baixarKb: 23, instaladoKb: 91, base: true,
    descricao: 'interactive high-level object-oriented language (default python3 version)', dependencias: [], arquivos: [], programas: bin('python3') },
  { nome: 'openssl', versao: '3.0.13-0ubuntu3.1', versaoNova: '3.0.13-0ubuntu3.4', secao: 'utils', repositorio: 'main', baixarKb: 1002, instaladoKb: 2210, base: true,
    descricao: 'Secure Sockets Layer toolkit - cryptographic utility', dependencias: [], arquivos: [], programas: bin('openssl') },
  { nome: 'tzdata', versao: '2024a-2ubuntu1', versaoNova: '2024a-3ubuntu1.1', secao: 'localization', repositorio: 'main', baixarKb: 273, instaladoKb: 1376, base: true,
    descricao: 'time zone and daylight-saving time data', dependencias: [], arquivos: [], programas: [] },
  { nome: 'openssh-server', versao: '1:9.6p1-3ubuntu13.4', versaoNova: '1:9.6p1-3ubuntu13.5', secao: 'net', repositorio: 'main', baixarKb: 510, instaladoKb: 2020, base: true,
    descricao: 'secure shell (SSH) server, for secure access from remote machines', dependencias: [], arquivos: [], programas: bin('sshd', 'sbin'),
    servico: { nome: 'ssh', descricao: 'OpenBSD Secure Shell server', execucao: '/usr/sbin/sshd -D', documentacao: 'man:sshd(8) man:sshd_config(5)',
      processos: ['sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups'] } },
  { nome: 'cron', versao: '3.0pl1-184ubuntu2', secao: 'admin', repositorio: 'main', baixarKb: 85, instaladoKb: 251, base: true,
    descricao: 'process scheduling daemon', dependencias: [], arquivos: [], programas: bin('cron', 'sbin'),
    servico: { nome: 'cron', descricao: 'Regular background program processing daemon', execucao: '/usr/sbin/cron -f -P', documentacao: 'man:cron(8)',
      processos: ['/usr/sbin/cron -f -P'] } },

  // ─── instaláveis ───
  { nome: 'tree', versao: '2.1.1-2ubuntu3', secao: 'utils', repositorio: 'universe', baixarKb: 47, instaladoKb: 111,
    descricao: 'displays an indented directory tree, in color', dependencias: [], arquivos: [], programas: bin('tree') },
  { nome: 'htop', versao: '3.3.0-4build1', secao: 'utils', repositorio: 'main', baixarKb: 171, instaladoKb: 434,
    descricao: 'interactive processes viewer', dependencias: [], arquivos: [], programas: bin('htop') },
  { nome: 'neofetch', versao: '7.1.0-4', secao: 'utils', repositorio: 'universe', baixarKb: 80, instaladoKb: 357,
    descricao: 'Shows Linux System Information with Distribution Logo', dependencias: [], arquivos: [], programas: bin('neofetch') },
  { nome: 'cowsay', versao: '3.03+dfsg2-8', secao: 'games', repositorio: 'universe', baixarKb: 18, instaladoKb: 93,
    descricao: 'configurable talking cow', dependencias: [], arquivos: [], programas: bin('cowsay') },
  { nome: 'git', versao: '1:2.43.0-1ubuntu7.1', secao: 'vcs', repositorio: 'main', baixarKb: 3679, instaladoKb: 20934,
    descricao: 'fast, scalable, distributed revision control system', dependencias: ['git-man'], arquivos: [], programas: bin('git') },
  { nome: 'git-man', versao: '1:2.43.0-1ubuntu7.1', secao: 'doc', repositorio: 'main', baixarKb: 1100, instaladoKb: 2011,
    descricao: 'fast, scalable, distributed revision control system (manual pages)', dependencias: [], arquivos: [], programas: [] },
  { nome: 'curl', versao: '8.5.0-2ubuntu10.4', secao: 'web', repositorio: 'main', baixarKb: 226, instaladoKb: 534, base: true,
    descricao: 'command line tool for transferring data with URL syntax', dependencias: [], arquivos: [], programas: bin('curl') },
  { nome: 'nginx', versao: '1.24.0-2ubuntu7.1', secao: 'httpd', repositorio: 'main', baixarKb: 520, instaladoKb: 1596,
    descricao: 'small, powerful, scalable web/proxy server', dependencias: ['nginx-common'], programas: bin('nginx', 'sbin'),
    arquivos: [
      { caminho: '/var/log/nginx', pasta: true, modo: 0o755, dono: [33, 4] },
      { caminho: '/var/log/nginx/access.log', conteudo: '', modo: 0o640, dono: [33, 4] },
      { caminho: '/var/log/nginx/error.log', conteudo: '', modo: 0o640, dono: [33, 4] },
    ],
    servico: { nome: 'nginx', descricao: 'A high performance web server and a reverse proxy server', execucao: '/usr/sbin/nginx -g daemon on; master_process on;',
      documentacao: 'man:nginx(8)', processos: ['nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', 'nginx: worker process'] } },
  { nome: 'nginx-common', versao: '1.24.0-2ubuntu7.1', secao: 'httpd', repositorio: 'main', baixarKb: 32, instaladoKb: 180,
    descricao: 'small, powerful, scalable web/proxy server - common files', dependencias: [], programas: [],
    arquivos: [
      { caminho: '/etc/nginx', pasta: true, config: true },
      { caminho: '/etc/nginx/nginx.conf', config: true, conteudo: 'user www-data;\nworker_processes auto;\npid /run/nginx.pid;\n\nevents {\n\tworker_connections 768;\n}\n\nhttp {\n\taccess_log /var/log/nginx/access.log;\n\terror_log /var/log/nginx/error.log;\n\tinclude /etc/nginx/sites-enabled/*;\n}\n' },
      { caminho: '/etc/nginx/sites-available', pasta: true, config: true },
      { caminho: '/etc/nginx/sites-available/default', config: true, conteudo: 'server {\n\tlisten 80 default_server;\n\troot /var/www/html;\n\tindex index.html index.htm index.nginx-debian.html;\n\tserver_name _;\n}\n' },
      { caminho: '/etc/nginx/sites-enabled', pasta: true, config: true },
      { caminho: '/var/www', pasta: true },
      { caminho: '/var/www/html', pasta: true },
      { caminho: '/var/www/html/index.nginx-debian.html', conteudo: NGINX_INDEX, modo: 0o644 },
    ] },
  { nome: 'apache2', versao: '2.4.58-1ubuntu8.4', secao: 'httpd', repositorio: 'main', baixarKb: 90, instaladoKb: 465,
    descricao: 'Apache HTTP Server', dependencias: ['apache2-bin', 'apache2-data', 'apache2-utils'], programas: [],
    arquivos: [
      { caminho: '/etc/apache2', pasta: true, config: true },
      { caminho: '/etc/apache2/apache2.conf', config: true, conteudo: '# Configuração principal do Apache\nServerRoot "/etc/apache2"\nUser ${APACHE_RUN_USER}\nGroup ${APACHE_RUN_GROUP}\nIncludeOptional sites-enabled/*.conf\n' },
      { caminho: '/var/log/apache2', pasta: true, modo: 0o750, dono: [0, 4] },
      { caminho: '/var/www', pasta: true },
      { caminho: '/var/www/html', pasta: true },
      { caminho: '/var/www/html/index.html', conteudo: APACHE_INDEX, modo: 0o644 },
    ],
    servico: { nome: 'apache2', descricao: 'The Apache HTTP Server', execucao: '/usr/sbin/apachectl start', documentacao: 'https://httpd.apache.org/docs/2.4/',
      processos: ['/usr/sbin/apache2 -k start', '/usr/sbin/apache2 -k start'] } },
  { nome: 'apache2-bin', versao: '2.4.58-1ubuntu8.4', secao: 'httpd', repositorio: 'main', baixarKb: 1329, instaladoKb: 5361,
    descricao: 'Apache HTTP Server (modules and other binary files)', dependencias: [], arquivos: [], programas: bin('apache2 apachectl', 'sbin') },
  { nome: 'apache2-data', versao: '2.4.58-1ubuntu8.4', secao: 'httpd', repositorio: 'main', baixarKb: 163, instaladoKb: 868,
    descricao: 'Apache HTTP Server (common files)', dependencias: [], arquivos: [], programas: [] },
  { nome: 'apache2-utils', versao: '2.4.58-1ubuntu8.4', secao: 'httpd', repositorio: 'main', baixarKb: 97, instaladoKb: 351,
    descricao: 'Apache HTTP Server (utility programs for web servers)', dependencias: [], arquivos: [], programas: bin('htpasswd') },
  { nome: 'mysql-server', versao: '8.0.39-0ubuntu0.24.04.2', secao: 'database', repositorio: 'main', baixarKb: 9, instaladoKb: 160,
    descricao: 'MySQL database server (metapackage depending on the latest version)', dependencias: ['mysql-server-8.0', 'mysql-client-8.0'], programas: [],
    arquivos: [
      { caminho: '/etc/mysql', pasta: true, config: true },
      { caminho: '/etc/mysql/my.cnf', config: true, conteudo: '[mysqld]\nbind-address = 127.0.0.1\n' },
      { caminho: '/var/lib/mysql', pasta: true, modo: 0o700 },
      { caminho: '/var/log/mysql', pasta: true, modo: 0o750 },
    ],
    servico: { nome: 'mysql', descricao: 'MySQL Community Server', execucao: '/usr/sbin/mysqld', documentacao: 'man:mysqld(8)',
      processos: ['/usr/sbin/mysqld'] } },
  { nome: 'mysql-server-8.0', versao: '8.0.39-0ubuntu0.24.04.2', secao: 'database', repositorio: 'main', baixarKb: 1462, instaladoKb: 13024,
    descricao: 'MySQL database server binaries and system database setup', dependencias: [], arquivos: [], programas: bin('mysqld', 'sbin') },
  { nome: 'mysql-client-8.0', versao: '8.0.39-0ubuntu0.24.04.2', secao: 'database', repositorio: 'main', baixarKb: 2713, instaladoKb: 63108,
    descricao: 'MySQL database client binaries', dependencias: [], arquivos: [], programas: bin('mysql') },
];

export interface EstadoDoPacote {
  versao: string;
  /** ii = instalado; rc = removido, mas com arquivos de configuração. */
  estado: 'ii' | 'rc';
  automatico: boolean;
}

/**
 * O "dpkg + apt": sabe o que está instalado (lendo /var/lib/dpkg/status),
 * instala e remove arquivos e mantém os serviços do systemd.
 */
export class GerenciadorDePacotes {
  public static readonly STATUS: string = '/var/lib/dpkg/status';
  public static readonly LISTAS: string = '/var/lib/apt/lists/br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease';

  private readonly maquina: Maquina;

  constructor(maquina: Maquina) {
    this.maquina = maquina;
  }

  public static pacote(nome: string): Pacote | undefined {
    return CATALOGO.find((p: Pacote) => p.nome === nome);
  }

  /** Qual pacote fornece este programa? (usado no "comando não encontrado, instale com..."). */
  public static fornecedor(programa: string): Pacote | undefined {
    return CATALOGO.find((p: Pacote) => p.programas.some((c: string) => c.split('/')[1] === programa));
  }

  // ─── banco de dados do dpkg ───

  public estado(): Map<string, EstadoDoPacote> {
    const mapa: Map<string, EstadoDoPacote> = new Map();
    const no: No | null = this.maquina.fs.obter(GerenciadorDePacotes.STATUS);
    const texto: string = no instanceof Arquivo ? no.ler() : '';
    for (const bloco of texto.split('\n\n')) {
      const campos: Map<string, string> = new Map();
      for (const linha of bloco.split('\n')) {
        const i: number = linha.indexOf(': ');
        if (i > 0) campos.set(linha.substring(0, i), linha.substring(i + 2));
      }
      const nome: string | undefined = campos.get('Package');
      if (nome === undefined) continue;
      mapa.set(nome, {
        versao: campos.get('Version') ?? '',
        estado: (campos.get('Status') ?? '').includes('config-files') ? 'rc' : 'ii',
        automatico: campos.get('Auto-Installed') === '1',
      });
    }
    return mapa;
  }

  private salvar(mapa: Map<string, EstadoDoPacote>): void {
    let texto: string = '';
    for (const nome of Array.from(mapa.keys()).sort()) {
      const e: EstadoDoPacote = mapa.get(nome) as EstadoDoPacote;
      const pacote: Pacote | undefined = GerenciadorDePacotes.pacote(nome);
      texto += 'Package: ' + nome + '\nStatus: ' + (e.estado === 'ii' ? 'install ok installed' : 'deinstall ok config-files') +
        '\nSection: ' + (pacote?.secao ?? 'misc') + '\nArchitecture: amd64\nVersion: ' + e.versao +
        '\nAuto-Installed: ' + (e.automatico ? '1' : '0') + '\nDescription: ' + (pacote?.descricao ?? '') + '\n\n';
    }
    this.arquivo(GerenciadorDePacotes.STATUS, 0o644).escrever(texto);
  }

  public instalado(nome: string): boolean {
    return this.estado().get(nome)?.estado === 'ii';
  }

  public versaoInstalada(nome: string): string | undefined {
    const e: EstadoDoPacote | undefined = this.estado().get(nome);
    return e?.estado === 'ii' ? e.versao : undefined;
  }

  // ─── apt update / upgrade ───

  public listasAtualizadas(): boolean {
    return this.maquina.fs.obter(GerenciadorDePacotes.LISTAS) !== null;
  }

  public marcarListasAtualizadas(): void {
    this.arquivo(GerenciadorDePacotes.LISTAS, 0o644).escrever('Origin: Ubuntu\nSuite: noble-updates\nCodename: noble\n');
  }

  /** Versão que o apt "conhece" do repositório (a nova só aparece depois do apt update). */
  public versaoCandidata(pacote: Pacote): string {
    return this.listasAtualizadas() && pacote.versaoNova !== undefined ? pacote.versaoNova : pacote.versao;
  }

  public atualizaveis(): Pacote[] {
    const estado: Map<string, EstadoDoPacote> = this.estado();
    return CATALOGO.filter((p: Pacote) => {
      const e: EstadoDoPacote | undefined = estado.get(p.nome);
      return e?.estado === 'ii' && e.versao !== this.versaoCandidata(p);
    });
  }

  public atualizar(pacote: Pacote): void {
    const estado: Map<string, EstadoDoPacote> = this.estado();
    const e: EstadoDoPacote | undefined = estado.get(pacote.nome);
    if (e === undefined) return;
    const antiga: string = e.versao;
    e.versao = this.versaoCandidata(pacote);
    this.salvar(estado);
    this.registrarDpkg('upgrade ' + pacote.nome + ':amd64 ' + antiga + ' ' + e.versao);
  }

  // ─── install / remove ───

  /** Pacotes que precisam entrar (o pedido + dependências que faltam), em ordem de instalação. */
  public resolver(nomes: string[]): Pacote[] {
    const estado: Map<string, EstadoDoPacote> = this.estado();
    const ordem: Pacote[] = [];
    const visitar = (nome: string): void => {
      const pacote: Pacote | undefined = GerenciadorDePacotes.pacote(nome);
      if (pacote === undefined || ordem.includes(pacote) || estado.get(nome)?.estado === 'ii') return;
      for (const dependencia of pacote.dependencias) visitar(dependencia);
      ordem.push(pacote);
    };
    for (const nome of nomes) visitar(nome);
    return ordem;
  }

  public instalar(pacote: Pacote, automatico: boolean): void {
    const fs: SistemaDeArquivos = this.maquina.fs;
    for (const programa of pacote.programas) {
      const [pasta, nome] = programa.split('/');
      const dir: Diretorio = this.maquina.criarDiretorio('/usr/' + pasta, 0, 0, 0o755);
      if (dir.obter(nome) === undefined) {
        dir.adicionar(new Binario(nome, BYTES[nome] ?? 20000 + nome.length * 7919));
      }
    }
    for (const item of pacote.arquivos) {
      const [dono, grupo] = item.dono ?? [0, 0];
      if (item.pasta) {
        const dir: Diretorio = this.maquina.criarDiretorio(item.caminho, dono, grupo, item.modo ?? 0o755);
        dir.dono = dono;
        dir.grupo = grupo;
        if (item.modo !== undefined) dir.modo = item.modo;
      } else if (fs.obter(item.caminho) === null) {
        this.maquina.criarArquivo(item.caminho, item.conteudo ?? '', dono, grupo, item.modo ?? 0o644);
      }
    }
    if (pacote.nome === 'nginx-common' && fs.obter('/etc/nginx/sites-enabled/default', false) === null) {
      (fs.obter('/etc/nginx/sites-enabled') as Diretorio).adicionar(new Link('default', '/etc/nginx/sites-available/default'));
    }
    if (pacote.servico !== undefined) {
      const s: DefinicaoDeServico = pacote.servico;
      this.maquina.criarArquivo('/usr/lib/systemd/system/' + s.nome + '.service',
        '[Unit]\nDescription=' + s.descricao + '\nDocumentation=' + s.documentacao + '\nAfter=network.target\n\n[Service]\nExecStart=' +
        s.execucao + '\n\n[Install]\nWantedBy=multi-user.target\n', 0, 0, 0o644);
      const servicos: Servicos = new Servicos(this.maquina);
      servicos.habilitar(s.nome);
      servicos.iniciar(s.nome);
    }
    const estado: Map<string, EstadoDoPacote> = this.estado();
    estado.set(pacote.nome, { versao: this.versaoCandidata(pacote), estado: 'ii', automatico });
    this.salvar(estado);
    this.registrarDpkg('install ' + pacote.nome + ':amd64 <none> ' + this.versaoCandidata(pacote));
  }

  /** remove apaga os programas; purge apaga também as configurações em /etc. */
  public remover(pacote: Pacote, purgar: boolean): void {
    const fs: SistemaDeArquivos = this.maquina.fs;
    for (const programa of pacote.programas) {
      const [pasta, nome] = programa.split('/');
      (fs.obter('/usr/' + pasta) as Diretorio | null)?.remover(nome);
    }
    if (pacote.servico !== undefined) {
      const servicos: Servicos = new Servicos(this.maquina);
      servicos.parar(pacote.servico.nome);
      servicos.desabilitar(pacote.servico.nome);
      this.apagar('/usr/lib/systemd/system/' + pacote.servico.nome + '.service');
    }
    for (const item of pacote.arquivos.slice().reverse()) {
      if (item.config && !purgar) continue;
      if (!item.config && item.caminho.startsWith('/var/www')) continue; // o site fica: pode ter conteúdo seu
      const no: No | null = fs.obter(item.caminho, false);
      if (no instanceof Diretorio && !item.config && no.filhos.size > 0) continue;
      this.apagar(item.caminho);
    }
    const estado: Map<string, EstadoDoPacote> = this.estado();
    const temConfig: boolean = pacote.arquivos.some((a: ArquivoDoPacote) => a.config);
    if (purgar || !temConfig) {
      estado.delete(pacote.nome);
    } else {
      const e: EstadoDoPacote | undefined = estado.get(pacote.nome);
      if (e !== undefined) e.estado = 'rc';
    }
    this.salvar(estado);
    this.registrarDpkg((purgar ? 'purge ' : 'remove ') + pacote.nome + ':amd64 ' + pacote.versao + ' <none>');
  }

  /** Instalados automaticamente (como dependência) de que ninguém mais precisa: candidatos ao autoremove. */
  public orfaos(): Pacote[] {
    const estado: Map<string, EstadoDoPacote> = this.estado();
    const necessarios: Set<string> = new Set();
    const marcar = (nome: string): void => {
      if (necessarios.has(nome)) return;
      necessarios.add(nome);
      for (const d of GerenciadorDePacotes.pacote(nome)?.dependencias ?? []) marcar(d);
    };
    for (const [nome, e] of estado) {
      if (e.estado === 'ii' && !e.automatico) marcar(nome);
    }
    return CATALOGO.filter((p: Pacote) => estado.get(p.nome)?.estado === 'ii' && estado.get(p.nome)?.automatico && !necessarios.has(p.nome));
  }

  /** Arquivos de um pacote (dpkg -L). */
  public arquivosDe(pacote: Pacote): string[] {
    const lista: string[] = pacote.programas.map((p: string) => '/usr/' + p);
    for (const item of pacote.arquivos) lista.push(item.caminho);
    if (pacote.servico !== undefined) lista.push('/usr/lib/systemd/system/' + pacote.servico.nome + '.service');
    return lista;
  }

  public instalarBase(): void {
    for (const pacote of CATALOGO.filter((p: Pacote) => p.base)) {
      this.instalar(pacote, false);
    }
    this.apagar('/var/log/dpkg.log');
    this.maquina.criarArquivo('/var/log/dpkg.log', '2024-04-24 12:00:01 startup archives install\n', 0, 0, 0o644);
  }

  public registrarHistorico(comando: string, acao: string, pacotes: Pacote[]): void {
    const agora: string = GerenciadorDePacotes.agora();
    const lista: string = pacotes.map((p: Pacote) => p.nome + ':amd64 (' + this.versaoCandidata(p) + ')').join(', ');
    this.arquivo('/var/log/apt/history.log', 0o644).acrescentar(
      '\nStart-Date: ' + agora + '\nCommandline: ' + comando + '\n' + acao + ': ' + lista + '\nEnd-Date: ' + agora + '\n');
  }

  private registrarDpkg(texto: string): void {
    this.arquivo('/var/log/dpkg.log', 0o644).acrescentar(GerenciadorDePacotes.agora() + ' ' + texto + '\n');
  }

  private arquivo(caminho: string, modo: number): Arquivo {
    const no: No | null = this.maquina.fs.obter(caminho);
    if (no instanceof Arquivo) return no;
    return this.maquina.criarArquivo(caminho, '', 0, 0, modo);
  }

  private apagar(caminho: string): void {
    const no: No | null = this.maquina.fs.obter(caminho, false);
    no?.pai?.remover(no.nome);
  }

  public static agora(): string {
    const d: Date = new Date();
    const dois = (n: number): string => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate()) + ' ' + dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds());
  }
}

/** systemd simplificado: unidade em /usr/lib/systemd/system, "habilitado" = link em multi-user.target.wants, "ativo" = arquivo em /run. */
export class Servicos {
  private static readonly WANTS: string = '/etc/systemd/system/multi-user.target.wants';
  private static readonly ATIVOS: string = '/run/systemd/ativos';
  private readonly maquina: Maquina;

  constructor(maquina: Maquina) {
    this.maquina = maquina;
  }

  public static normalizar(nome: string): string {
    const sem: string = nome.replace(/\.service$/, '');
    return sem === 'sshd' ? 'ssh' : sem;
  }

  public existe(nome: string): boolean {
    return this.maquina.fs.obter('/usr/lib/systemd/system/' + nome + '.service') !== null;
  }

  public descricao(nome: string): string {
    const no: No | null = this.maquina.fs.obter('/usr/lib/systemd/system/' + nome + '.service');
    const texto: string = no instanceof Arquivo ? no.ler() : '';
    return texto.match(/Description=(.*)/)?.[1] ?? nome;
  }

  public ativo(nome: string): boolean {
    return this.maquina.fs.obter(Servicos.ATIVOS + '/' + nome) !== null;
  }

  public desde(nome: string): Date | null {
    return this.maquina.fs.obter(Servicos.ATIVOS + '/' + nome)?.modificadoEm ?? null;
  }

  public habilitado(nome: string): boolean {
    return this.maquina.fs.obter(Servicos.WANTS + '/' + nome + '.service', false) !== null;
  }

  public iniciar(nome: string): void {
    if (!this.ativo(nome)) {
      this.maquina.criarDiretorio(Servicos.ATIVOS, 0, 0, 0o755);
      this.maquina.criarArquivo(Servicos.ATIVOS + '/' + nome, 'active\n', 0, 0, 0o644);
    }
  }

  public parar(nome: string): void {
    const no: No | null = this.maquina.fs.obter(Servicos.ATIVOS + '/' + nome);
    no?.pai?.remover(no.nome);
  }

  public habilitar(nome: string): boolean {
    if (this.habilitado(nome)) return false;
    const dir: Diretorio = this.maquina.criarDiretorio(Servicos.WANTS, 0, 0, 0o755);
    dir.adicionar(new Link(nome + '.service', '/usr/lib/systemd/system/' + nome + '.service'));
    return true;
  }

  public desabilitar(nome: string): boolean {
    const no: No | null = this.maquina.fs.obter(Servicos.WANTS + '/' + nome + '.service', false);
    if (no === null) return false;
    no.pai?.remover(no.nome);
    return true;
  }

  /** Um PID estável por serviço, só para a saída parecer real. */
  public pid(nome: string): number {
    let soma: number = 0;
    for (const letra of nome) soma = (soma * 31 + letra.charCodeAt(0)) % 9000;
    return 600 + soma;
  }

  public listar(): string[] {
    const dir: No | null = this.maquina.fs.obter('/usr/lib/systemd/system');
    return dir instanceof Diretorio ? dir.nomesOrdenados().map((n: string) => n.replace(/\.service$/, '')) : [];
  }

  public processos(nome: string): string[] {
    for (const pacote of CATALOGO) {
      if (pacote.servico?.nome === nome) return pacote.servico.processos;
    }
    return [];
  }

  public caminhoUnidade(nome: string): string {
    return SistemaDeArquivos.absoluto(nome + '.service', '/usr/lib/systemd/system');
  }
}
