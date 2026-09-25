import type { Maquina } from './Maquina';
import type { Usuario } from './Contas';
import { Arquivo, Diretorio, type No } from './No';
import { GerenciadorDePacotes, Servicos } from './Pacotes';
import { registrar, pidDeLog } from './Registro';

/** Chave pública do "seu notebook" (de onde saem as conexões dos terminais do simulador). */
export const CHAVE_DO_NOTEBOOK: string = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKq8ZrVt3mY0dQ2Lr1wP7cXbN5sJ4hT9eF6gU2vA0yEk ricardo@notebook';

export interface PoliticaSsh {
  permitRootLogin: 'yes' | 'no' | 'prohibit-password';
  passwordAuthentication: boolean;
  pubkeyAuthentication: boolean;
  porta: number;
}

/** Regras do firewall ufw, guardadas em /etc/ufw. */
export class Firewall {
  public static readonly CONF: string = '/etc/ufw/ufw.conf';
  public static readonly REGRAS: string = '/etc/ufw/user.rules';
  public static readonly SERVICOS: Record<string, number[]> = {
    ssh: [22], openssh: [22], http: [80], https: [443], 'nginx full': [80, 443], 'nginx http': [80], 'nginx https': [443],
    apache: [80], 'apache full': [80, 443], mysql: [3306], ftp: [21],
  };
  private readonly maquina: Maquina;

  constructor(maquina: Maquina) {
    this.maquina = maquina;
  }

  public ativo(): boolean {
    return /ENABLED=yes/.test(this.ler(Firewall.CONF));
  }

  public definirAtivo(ativo: boolean): void {
    this.gravar(Firewall.CONF, '# /etc/ufw/ufw.conf\nENABLED=' + (ativo ? 'yes' : 'no') + '\nLOGLEVEL=low\n');
  }

  /** "allow 22/tcp", "deny 80", "allow from 192.168.0.51 to any port 22"... uma por linha. */
  public regras(): string[] {
    return this.ler(Firewall.REGRAS).split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  }

  public salvarRegras(regras: string[]): void {
    this.gravar(Firewall.REGRAS, '# regras do ufw (formato simplificado do simulador)\n' + regras.join('\n') + (regras.length > 0 ? '\n' : ''));
  }

  public politicaEntrada(): 'allow' | 'deny' {
    return /DEFAULT_INPUT_POLICY="ACCEPT"/.test(this.ler('/etc/default/ufw')) ? 'allow' : 'deny';
  }

  public definirPoliticaEntrada(politica: 'allow' | 'deny'): void {
    this.gravar('/etc/default/ufw', 'DEFAULT_INPUT_POLICY="' + (politica === 'allow' ? 'ACCEPT' : 'DROP') + '"\nDEFAULT_OUTPUT_POLICY="ACCEPT"\n');
  }

  public static portas(alvo: string): number[] {
    const nome: string = alvo.toLowerCase().replace(/\/(tcp|udp)$/, '');
    if (/^\d+$/.test(nome)) return [Number(nome)];
    return Firewall.SERVICOS[nome] ?? [];
  }

  /** A conexão de ip para a porta passa pelo firewall? A primeira regra que casar decide. */
  public permite(porta: number, ip: string): boolean {
    if (!this.ativo() || ip === '127.0.0.1') return true;
    for (const regra of this.regras()) {
      const partes: string[] = regra.split(/\s+/);
      const acao: string = partes[0];
      const deIndice: number = partes.indexOf('from');
      const origem: string | null = deIndice >= 0 ? partes[deIndice + 1] : null;
      const portaIndice: number = partes.indexOf('port');
      const alvo: string = portaIndice >= 0 ? partes[portaIndice + 1] : deIndice === 1 ? '' : partes.slice(1).join(' ');
      if (origem !== null && origem !== 'any' && origem !== ip && !(origem.endsWith('/24') && ip.startsWith(origem.split('.').slice(0, 3).join('.') + '.'))) continue;
      if (alvo !== '' && !Firewall.portas(alvo).includes(porta)) continue;
      return acao === 'allow' || acao === 'limit';
    }
    return this.politicaEntrada() === 'allow';
  }

  private ler(caminho: string): string {
    const no: No | null = this.maquina.fs.obter(caminho);
    return no instanceof Arquivo ? no.ler() : '';
  }

  private gravar(caminho: string, texto: string): void {
    const no: No | null = this.maquina.fs.obter(caminho);
    if (no instanceof Arquivo) no.escrever(texto);
    else this.maquina.criarArquivo(caminho, texto, 0, 0, 0o640);
  }
}

/** fail2ban: lê o auth.log e bane quem erra a senha demais. */
export class Fail2ban {
  private static readonly DESBANIDOS: string = '/var/lib/fail2ban/desbanidos';
  private readonly maquina: Maquina;

  constructor(maquina: Maquina) {
    this.maquina = maquina;
  }

  public ativo(): boolean {
    return new GerenciadorDePacotes(this.maquina).instalado('fail2ban') && new Servicos(this.maquina).ativo('fail2ban');
  }

  public maxRetry(): number {
    for (const caminho of ['/etc/fail2ban/jail.local', '/etc/fail2ban/jail.conf']) {
      const no: No | null = this.maquina.fs.obter(caminho);
      const m: RegExpMatchArray | null = no instanceof Arquivo ? no.ler().match(/^\s*maxretry\s*=\s*(\d+)/m) : null;
      if (m !== null) return Number(m[1]);
    }
    return 5;
  }

  /** Falhas de senha por IP, contando só depois do último desbanimento daquele IP. */
  public falhas(): Map<string, number> {
    const log: No | null = this.maquina.fs.obter('/var/log/auth.log');
    const linhas: string[] = log instanceof Arquivo ? log.ler().split('\n') : [];
    const desde: Map<string, number> = this.desbanidos();
    const contagem: Map<string, number> = new Map();
    linhas.forEach((linha: string, i: number) => {
      const m: RegExpMatchArray | null = linha.match(/Failed password for .* from ([\d.]+) port/);
      if (m === null || i < (desde.get(m[1]) ?? 0)) return;
      contagem.set(m[1], (contagem.get(m[1]) ?? 0) + 1);
    });
    return contagem;
  }

  public banidos(): string[] {
    if (!this.ativo()) return [];
    const limite: number = this.maxRetry();
    return Array.from(this.falhas()).filter(([ip, n]) => n >= limite && ip !== '127.0.0.1').map(([ip]) => ip);
  }

  public desbanir(ip: string): void {
    const log: No | null = this.maquina.fs.obter('/var/log/auth.log');
    const total: number = log instanceof Arquivo ? log.ler().split('\n').length : 0;
    const atuais: Map<string, number> = this.desbanidos();
    atuais.set(ip, total);
    const texto: string = Array.from(atuais).map(([i, n]) => i + ' ' + n).join('\n') + '\n';
    const no: No | null = this.maquina.fs.obter(Fail2ban.DESBANIDOS);
    if (no instanceof Arquivo) no.escrever(texto);
    else {
      this.maquina.criarDiretorio('/var/lib/fail2ban', 0, 0, 0o755);
      this.maquina.criarArquivo(Fail2ban.DESBANIDOS, texto, 0, 0, 0o600);
    }
  }

  private desbanidos(): Map<string, number> {
    const no: No | null = this.maquina.fs.obter(Fail2ban.DESBANIDOS);
    const mapa: Map<string, number> = new Map();
    if (no instanceof Arquivo) {
      for (const linha of no.ler().split('\n')) {
        const [ip, n] = linha.split(' ');
        if (ip !== undefined && n !== undefined) mapa.set(ip, Number(n));
      }
    }
    return mapa;
  }
}

/** O sshd: decide quem entra e registra tudo no /var/log/auth.log. */
export class ServidorSsh {
  public static readonly ATIVA: string = '/run/sshd/sshd_config.ativa';
  private readonly maquina: Maquina;

  constructor(maquina: Maquina) {
    this.maquina = maquina;
  }

  /** A configuração só vale depois de reiniciar o serviço (systemctl restart ssh). */
  public aplicarConfiguracao(): void {
    const config: No | null = this.maquina.fs.obter('/etc/ssh/sshd_config');
    const texto: string = config instanceof Arquivo ? config.ler() : '';
    const atual: No | null = this.maquina.fs.obter(ServidorSsh.ATIVA);
    if (atual instanceof Arquivo) atual.escrever(texto);
    else {
      this.maquina.criarDiretorio('/run/sshd', 0, 0, 0o755);
      this.maquina.criarArquivo(ServidorSsh.ATIVA, texto, 0, 0, 0o600);
    }
  }

  public politica(): PoliticaSsh {
    const no: No | null = this.maquina.fs.obter(ServidorSsh.ATIVA) ?? this.maquina.fs.obter('/etc/ssh/sshd_config');
    const texto: string = no instanceof Arquivo ? no.ler() : '';
    const valor = (chave: string, padrao: string): string => {
      const m: RegExpMatchArray | null = texto.match(new RegExp('^\\s*' + chave + '\\s+(\\S+)', 'mi'));
      return m !== null ? m[1].toLowerCase() : padrao;
    };
    const root: string = valor('PermitRootLogin', 'prohibit-password');
    return {
      permitRootLogin: root === 'yes' ? 'yes' : root === 'no' ? 'no' : 'prohibit-password',
      passwordAuthentication: valor('PasswordAuthentication', 'yes') !== 'no',
      pubkeyAuthentication: valor('PubkeyAuthentication', 'yes') !== 'no',
      porta: Number(valor('Port', '22')) || 22,
    };
  }

  /** Antes de pedir usuário: o serviço está no ar? O firewall deixa passar? O IP está banido? */
  public conectar(ip: string, porta: number = 22): string | null {
    const politica: PoliticaSsh = this.politica();
    if (!new Servicos(this.maquina).ativo('ssh') || porta !== politica.porta) {
      return 'ssh: connect to host 192.168.0.10 port ' + porta + ': Connection refused';
    }
    if (new Fail2ban(this.maquina).banidos().includes(ip)) {
      return 'ssh: connect to host 192.168.0.10 port ' + porta + ': Connection refused';
    }
    if (!new Firewall(this.maquina).permite(porta, ip)) {
      return 'ssh: connect to host 192.168.0.10 port ' + porta + ': Connection timed out';
    }
    return null;
  }

  /** O authorized_keys do usuário tem esta chave? (e as permissões estão seguras, como exige o StrictModes) */
  public chaveAutorizada(usuario: Usuario, chave: string): boolean {
    const home: No | null = this.maquina.fs.obter(usuario.home);
    const pasta: No | null = this.maquina.fs.obter(usuario.home + '/.ssh');
    const arquivo: No | null = this.maquina.fs.obter(usuario.home + '/.ssh/authorized_keys');
    if (!(home instanceof Diretorio) || !(pasta instanceof Diretorio) || !(arquivo instanceof Arquivo)) return false;
    const seguro = (no: No): boolean => (no.modo & 0o022) === 0 && (no.dono === usuario.uid || no.dono === 0);
    if (!seguro(home) || !seguro(pasta) || !seguro(arquivo)) return false;
    const corpo: string = chave.trim().split(/\s+/).slice(0, 2).join(' ');
    return arquivo.ler().split('\n').some((linha: string) => linha.trim().split(/\s+/).slice(0, 2).join(' ') === corpo);
  }

  /** Pode entrar com chave? (a política e o root) */
  public aceitaChave(usuario: Usuario, chave: string | null): boolean {
    const politica: PoliticaSsh = this.politica();
    if (chave === null || !politica.pubkeyAuthentication) return false;
    if (usuario.uid === 0 && politica.permitRootLogin === 'no') return false;
    return this.chaveAutorizada(usuario, chave);
  }

  /** Pode ao menos tentar senha? */
  public aceitaSenha(): boolean {
    return this.politica().passwordAuthentication;
  }

  /** Confere a senha respeitando o PermitRootLogin. Registra sucesso ou falha no auth.log. */
  public autenticarSenha(nome: string, senha: string, ip: string): Usuario | null {
    const usuario: Usuario | undefined = this.maquina.contas.usuario(nome);
    const politica: PoliticaSsh = this.politica();
    const porta: number = 40000 + Math.floor(Math.random() * 20000);
    const pid: number = pidDeLog();
    const certo: boolean = usuario !== undefined && usuario.senha !== null && usuario.senha !== '' && !usuario.bloqueado && usuario.senha === senha;
    const rootBarrado: boolean = usuario !== undefined && usuario.uid === 0 && politica.permitRootLogin !== 'yes';
    if (usuario === undefined) {
      registrar(this.maquina, 'auth.log', 'sshd[' + pid + ']', 'Failed password for invalid user ' + nome + ' from ' + ip + ' port ' + porta + ' ssh2');
      return null;
    }
    if (!certo || rootBarrado) {
      registrar(this.maquina, 'auth.log', 'sshd[' + pid + ']', 'Failed password for ' + nome + ' from ' + ip + ' port ' + porta + ' ssh2');
      return null;
    }
    this.registrarEntrada(usuario, ip, 'password', pid, porta);
    return usuario;
  }

  public registrarEntrada(usuario: Usuario, ip: string, metodo: 'password' | 'publickey', pid: number = pidDeLog(), porta: number = 40000 + Math.floor(Math.random() * 20000)): void {
    registrar(this.maquina, 'auth.log', 'sshd[' + pid + ']', 'Accepted ' + metodo + ' for ' + usuario.nome + ' from ' + ip + ' port ' + porta + ' ssh2' +
      (metodo === 'publickey' ? ': ED25519 SHA256:q2v8mZt0uXw3kR5nB7cY1pL9sD4fG6hJ0aQeTyUiOp' : ''));
    registrar(this.maquina, 'auth.log', 'sshd[' + pid + ']', 'pam_unix(sshd:session): session opened for user ' + usuario.nome + '(uid=' + usuario.uid + ') by ' + usuario.nome + '(uid=0)');
  }

  public registrarRecusaPorChave(nome: string, ip: string): void {
    registrar(this.maquina, 'auth.log', 'sshd[' + pidDeLog() + ']', 'Connection closed by authenticating user ' + nome + ' ' + ip + ' port ' + (40000 + Math.floor(Math.random() * 20000)) + ' [preauth]');
  }
}
