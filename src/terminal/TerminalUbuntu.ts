import type { Maquina } from '../linux/Maquina';
import { Maquina as ClasseMaquina } from '../linux/Maquina';
import type { Sessao } from '../linux/Sessao';
import type { Usuario } from '../linux/Contas';
import { Diretorio, type No } from '../linux/No';
import type { Interacao, PedidoDeEdicao } from '../shell/Contexto';
import type { Saida } from '../shell/Saida';
import type { Interpretador } from '../shell/Interpretador';
import { Shell } from '../shell/Shell';
import { CHAVE_DO_NOTEBOOK, Fail2ban, ServidorSsh } from '../linux/Ssh';
import { EditorNano } from './EditorNano';
import { EditorVim } from './EditorVim';

type Estado = 'login-usuario' | 'login-senha' | 'comando' | 'pergunta' | 'ocupado' | 'desconectado' | 'editor';

export interface OuvinteDoTerminal {
  /** Depois de cada comando: hora de conferir desafios e salvar a máquina. */
  aoExecutar(terminal: TerminalUbuntu): void;
  /** O título mudou (troca de usuário ou de diretório). */
  aoMudarTitulo(terminal: TerminalUbuntu): void;
}

const esperar = (ms: number): Promise<void> => new Promise((resolver) => window.setTimeout(resolver, ms));

/**
 * Um terminal do GNOME conectado por "SSH" à máquina simulada.
 * É ao mesmo tempo a Saída dos comandos e a Interação (perguntas, editores, desconexão).
 */
export class TerminalUbuntu implements Saida, Interacao {
  public readonly numero: number;
  public readonly elemento: HTMLElement;
  private readonly maquina: Maquina;
  private readonly ouvinte: OuvinteDoTerminal;
  private readonly interpretador: Interpretador = Shell.criarInterpretador();

  private readonly tela: HTMLElement;
  private readonly linhas: HTMLElement;
  private readonly entrada: HTMLElement;
  private readonly areaEditor: HTMLElement;

  private sessao: Sessao | null = null;
  private estado: Estado = 'login-usuario';
  private buffer: string = '';
  private cursor: number = 0;
  private rotulo: string = '';
  private oculto: boolean = false;
  private linhaAtual: HTMLElement | null = null;
  private resolverPergunta: ((resposta: string) => void) | null = null;
  private respostasAutomaticas: string[] = [];
  private posicaoHistorico: number = 0;
  private loginPendente: string = '';
  private tentativasDeSenha: number = 0;
  private velocidade: number = 1;

  constructor(numero: number, maquina: Maquina, ouvinte: OuvinteDoTerminal) {
    this.numero = numero;
    this.maquina = maquina;
    this.ouvinte = ouvinte;
    this.elemento = document.createElement('div');
    this.elemento.className = 'term';
    this.elemento.innerHTML =
      '<div class="term-tela" tabindex="0" aria-label="Terminal ' + numero + '">' +
      '<div class="term-linhas"></div><div class="term-entrada"></div>' +
      '</div>' +
      '<div class="term-editor" hidden></div>';
    this.tela = this.elemento.querySelector('.term-tela') as HTMLElement;
    this.linhas = this.elemento.querySelector('.term-linhas') as HTMLElement;
    this.entrada = this.elemento.querySelector('.term-entrada') as HTMLElement;
    this.areaEditor = this.elemento.querySelector('.term-editor') as HTMLElement;
    this.tela.addEventListener('keydown', (evento: KeyboardEvent) => this.teclar(evento));
    this.tela.addEventListener('paste', (evento: ClipboardEvent) => {
      evento.preventDefault();
      this.inserir((evento.clipboardData?.getData('text') ?? '').split('\n')[0]);
    });
    this.tela.addEventListener('mouseup', () => {
      if ((window.getSelection()?.toString() ?? '') === '') this.focar();
    });
  }

  // ───────────── conexão ─────────────

  /** Terminal 1: já entra conectado como root. */
  public conectarDireto(usuario: Usuario): void {
    this.escrever('Conectado a ' + ClasseMaquina.IP + ' via SSH como ' + usuario.nome + '.\n', 'c-info');
    this.iniciarSessao(usuario);
  }

  /** Terminais 2 e 3: pedem usuário e senha como o PuTTY/ssh. */
  /** IP do "notebook" de onde este terminal conecta (terminal 2 → .52). */
  private ip(): string {
    return '192.168.0.' + (50 + this.numero);
  }

  public pedirLogin(): void {
    this.escrever('Conectando a ' + ClasseMaquina.IP + ' (' + this.maquina.hostname + ') pela porta 22...\n', 'c-info');
    const recusa: string | null = new ServidorSsh(this.maquina).conectar(this.ip());
    if (recusa !== null) {
      this.escrever(recusa + '\n', 'c-erro');
      if (recusa.includes('timed out')) this.escrever('(o firewall ufw está bloqueando a porta 22 para o IP ' + this.ip() + ')\n', 'c-info');
      else if (new Fail2ban(this.maquina).banidos().includes(this.ip())) this.escrever('(o fail2ban baniu o IP ' + this.ip() + ' por errar a senha demais: fail2ban-client set sshd unbanip ' + this.ip() + ')\n', 'c-info');
      else this.escrever('(o serviço ssh não está rodando no servidor: systemctl start ssh)\n', 'c-info');
      this.escrever('[Pressione Enter para tentar de novo]\n', 'c-info');
      this.estado = 'desconectado';
      this.renderizarEntrada();
      return;
    }
    this.estado = 'login-usuario';
    this.rotulo = 'login as: ';
    this.oculto = false;
    this.renderizarEntrada();
  }

  private iniciarSessao(usuario: Usuario): void {
    this.sessao = this.maquina.abrirSessao(usuario);
    // kill no bash/sshd desta conexão ou "pkill -u usuario" feito em outro terminal
    this.sessao.aoEncerrar = (): void => {
      window.setTimeout(() => {
        this.escrever('\nConnection to ' + ClasseMaquina.IP + ' closed by remote host.\n', 'c-erro');
        this.desconectar();
        this.renderizarEntrada();
      }, 0);
    };
    this.escrever('Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\n');
    this.escrever(' * Documentation:  https://help.ubuntu.com\n * Management:     https://landscape.canonical.com\n\n');
    if (this.sessao.atual().cwd !== usuario.home) {
      this.escrever('Could not chdir to home directory ' + usuario.home + ': No such file or directory\n', 'c-erro');
    }
    this.escrever('Last login: ' + new Date().toString().substring(0, 24) + ' from 192.168.0.' + (50 + this.numero) + '\n');
    this.estado = 'comando';
    this.renderizarEntrada();
    this.ouvinte.aoMudarTitulo(this);
  }

  public desconectar(): void {
    if (this.sessao !== null) {
      this.maquina.fecharSessao(this.sessao);
      this.sessao = null;
    }
    this.escrever('Connection to ' + ClasseMaquina.IP + ' closed.\n', 'c-info');
    this.escrever('[Pressione Enter para conectar de novo]\n', 'c-info');
    this.estado = 'desconectado';
    this.ouvinte.aoMudarTitulo(this);
  }

  /** Ao fechar a aba: encerra a sessão para o userdel não achar que ainda tem alguém logado. */
  public destruir(): void {
    if (this.sessao !== null) {
      this.maquina.fecharSessao(this.sessao);
      this.sessao = null;
    }
    this.resolverPergunta?.('');
    this.elemento.remove();
  }

  public titulo(): string {
    if (this.sessao === null) {
      return this.estado === 'desconectado' ? 'desconectado' : 'ssh ' + ClasseMaquina.IP;
    }
    return this.sessao.atual().usuario.nome + '@' + this.maquina.hostname + ': ' + this.sessao.caminhoCurto();
  }

  public usuarioAtual(): string | null {
    return this.sessao !== null ? this.sessao.atual().usuario.nome : null;
  }

  public estaLivre(): boolean {
    return this.estado === 'comando' || this.estado === 'login-usuario' || this.estado === 'desconectado';
  }

  public focar(): void {
    if (this.estado !== 'editor') {
      this.tela.focus({ preventScroll: true });
    }
  }

  public definirVelocidade(velocidade: number): void {
    this.velocidade = velocidade;
  }

  // ───────────── Saida ─────────────

  public escrever(texto: string, classe?: string): void {
    const partes: string[] = texto.split('\n');
    partes.forEach((parte: string, indice: number) => {
      if (indice > 0) {
        this.garantirLinha();
        this.linhaAtual = null;
      }
      if (parte !== '') {
        const trecho: HTMLSpanElement = document.createElement('span');
        trecho.textContent = parte;
        if (classe !== undefined && classe !== '') trecho.className = classe;
        this.garantirLinha().appendChild(trecho);
      }
    });
    while (this.linhas.childElementCount > 1500) {
      this.linhas.firstElementChild?.remove();
    }
    this.rolar();
  }

  private garantirLinha(): HTMLElement {
    if (this.linhaAtual === null) {
      this.linhaAtual = document.createElement('div');
      this.linhaAtual.className = 'term-linha';
      this.linhas.appendChild(this.linhaAtual);
    }
    return this.linhaAtual;
  }

  private rolar(): void {
    this.tela.scrollTop = this.tela.scrollHeight;
  }

  // ───────────── Interacao ─────────────

  public limparTela(): void {
    this.linhas.innerHTML = '';
    this.linhaAtual = null;
  }

  public async perguntar(pergunta: string, oculto: boolean): Promise<string> {
    if (this.respostasAutomaticas.length > 0) {
      const resposta: string = this.respostasAutomaticas.shift() as string;
      this.estado = 'pergunta';
      this.rotulo = pergunta;
      this.oculto = oculto;
      this.buffer = '';
      this.cursor = 0;
      this.renderizarEntrada();
      await esperar(350 / this.velocidade);
      await this.digitar(resposta, oculto);
      this.ecoarEntrada();
      this.estado = 'ocupado';
      this.renderizarEntrada();
      return resposta;
    }
    return new Promise((resolver) => {
      this.estado = 'pergunta';
      this.rotulo = pergunta;
      this.oculto = oculto;
      this.buffer = '';
      this.cursor = 0;
      this.resolverPergunta = resolver;
      this.renderizarEntrada();
      this.focar();
    });
  }

  public editar(pedido: PedidoDeEdicao): Promise<void> {
    return new Promise((resolver) => {
      const estadoAnterior: Estado = this.estado;
      this.estado = 'editor';
      this.tela.hidden = true;
      this.areaEditor.hidden = false;
      const fechar = (): void => {
        this.areaEditor.hidden = true;
        this.areaEditor.innerHTML = '';
        this.tela.hidden = false;
        this.estado = estadoAnterior;
        this.focar();
        resolver();
      };
      if (pedido.editor === 'nano') {
        new EditorNano(this.areaEditor, pedido, fechar);
      } else {
        new EditorVim(this.areaEditor, pedido, fechar);
      }
    });
  }

  // ───────────── automação (roteiros das aulas) ─────────────

  /** Digita e executa um comando como se fosse você, respondendo às perguntas com "respostas". */
  public async executarAutomatico(comando: string, respostas: string[] = []): Promise<void> {
    await this.aguardarLivre();
    if (this.estado === 'desconectado') {
      this.teclarEnter();
      await esperar(200);
    }
    if (this.estado !== 'comando') {
      return;
    }
    this.respostasAutomaticas = respostas.slice();
    this.buffer = '';
    this.cursor = 0;
    this.renderizarEntrada();
    await this.digitar(comando, false);
    await esperar(180 / this.velocidade);
    await this.enviarComando();
    this.respostasAutomaticas = [];
  }

  /** Faz o login SSH digitando usuário e senha. */
  public async loginAutomatico(usuario: string, senha: string): Promise<void> {
    await this.aguardarLivre();
    if (this.estado === 'desconectado') {
      this.teclarEnter();
    }
    if (this.estado !== 'login-usuario') {
      return;
    }
    await this.digitar(usuario, false);
    this.teclarEnter();
    await esperar(250 / this.velocidade);
    await this.digitar(senha, true);
    this.teclarEnter();
    await esperar(200 / this.velocidade);
  }

  private async aguardarLivre(): Promise<void> {
    for (let i: number = 0; i < 600 && !this.estaLivre(); i++) {
      await esperar(50);
    }
  }

  private async digitar(texto: string, oculto: boolean): Promise<void> {
    const atraso: number = Math.max(4, 38 / this.velocidade);
    for (const letra of texto) {
      this.buffer += letra;
      this.cursor = this.buffer.length;
      if (!oculto) this.renderizarEntrada();
      await esperar(atraso + Math.random() * atraso * 0.6);
    }
  }

  // ───────────── teclado ─────────────

  private teclar(evento: KeyboardEvent): void {
    if (this.estado === 'ocupado' || this.estado === 'editor') {
      const letra: string = evento.key.toLowerCase();
      if (this.estado === 'ocupado' && evento.ctrlKey && (letra === 'c' || letra === 'z')) {
        evento.preventDefault();
        if (letra === 'c') {
          this.escrever('^C\n');
          this.sessao?.interromper();
        } else {
          this.escrever('^Z');
          this.sessao?.suspender();
        }
      }
      return;
    }
    const tecla: string = evento.key;
    if (evento.ctrlKey && !evento.altKey) {
      const letra: string = tecla.toLowerCase();
      if (letra === 'c' && (window.getSelection()?.toString() ?? '') !== '') {
        return;
      }
      if (['c', 'l', 'u', 'a', 'e', 'd'].includes(letra)) evento.preventDefault();
      if (letra === 'c') this.cancelarLinha();
      if (letra === 'l') { this.limparTela(); this.renderizarEntrada(); }
      if (letra === 'u') { this.buffer = this.buffer.substring(this.cursor); this.cursor = 0; this.renderizarEntrada(); }
      if (letra === 'a') { this.cursor = 0; this.renderizarEntrada(); }
      if (letra === 'e') { this.cursor = this.buffer.length; this.renderizarEntrada(); }
      if (letra === 'd' && this.buffer === '' && this.estado === 'comando') { this.buffer = 'exit'; void this.enviarComando(); }
      if (letra === 'd' && this.buffer === '' && this.estado === 'pergunta' && this.resolverPergunta !== null) {
        // Ctrl+D: fim da entrada (encerra o "cat > arquivo")
        const resolver = this.resolverPergunta;
        this.resolverPergunta = null;
        this.estado = 'ocupado';
        this.renderizarEntrada();
        resolver('\u0004');
      }
      return;
    }
    if (evento.metaKey || evento.altKey) {
      return;
    }
    switch (tecla) {
      case 'Enter': evento.preventDefault(); this.teclarEnter(); return;
      case 'Backspace':
        evento.preventDefault();
        if (this.cursor > 0) {
          this.buffer = this.buffer.substring(0, this.cursor - 1) + this.buffer.substring(this.cursor);
          this.cursor--;
        }
        break;
      case 'Delete': this.buffer = this.buffer.substring(0, this.cursor) + this.buffer.substring(this.cursor + 1); break;
      case 'ArrowLeft': evento.preventDefault(); this.cursor = Math.max(0, this.cursor - 1); break;
      case 'ArrowRight': evento.preventDefault(); this.cursor = Math.min(this.buffer.length, this.cursor + 1); break;
      case 'Home': this.cursor = 0; break;
      case 'End': this.cursor = this.buffer.length; break;
      case 'ArrowUp': evento.preventDefault(); this.navegarHistorico(-1); return;
      case 'ArrowDown': evento.preventDefault(); this.navegarHistorico(1); return;
      case 'Tab': evento.preventDefault(); if (this.estado === 'comando') this.completar(); return;
      default:
        if (tecla.length === 1) {
          evento.preventDefault();
          this.inserir(tecla);
        }
        return;
    }
    this.renderizarEntrada();
  }

  private inserir(texto: string): void {
    if (this.estado === 'desconectado' || this.estado === 'ocupado') return;
    this.buffer = this.buffer.substring(0, this.cursor) + texto + this.buffer.substring(this.cursor);
    this.cursor += texto.length;
    this.renderizarEntrada();
  }

  private cancelarLinha(): void {
    if (this.estado === 'pergunta' && this.resolverPergunta !== null) {
      this.escrever(this.rotulo + (this.oculto ? '' : this.buffer) + '^C\n');
      const resolver = this.resolverPergunta;
      this.resolverPergunta = null;
      this.buffer = '';
      this.cursor = 0;
      this.estado = 'ocupado';
      resolver('\u0003');
      return;
    }
    this.escreverPrompt();
    this.escrever(this.buffer + '^C\n');
    this.buffer = '';
    this.cursor = 0;
    this.renderizarEntrada();
  }

  private teclarEnter(): void {
    switch (this.estado) {
      case 'comando':
        void this.enviarComando();
        return;
      case 'pergunta': {
        this.ecoarEntrada();
        const resposta: string = this.buffer;
        const resolver = this.resolverPergunta;
        this.resolverPergunta = null;
        this.buffer = '';
        this.cursor = 0;
        this.estado = 'ocupado';
        this.renderizarEntrada();
        resolver?.(resposta);
        return;
      }
      case 'login-usuario': {
        this.ecoarEntrada();
        this.loginPendente = this.buffer.trim();
        this.buffer = '';
        this.cursor = 0;
        if (this.loginPendente === '') {
          this.renderizarEntrada();
          return;
        }
        {
          const servidor: ServidorSsh = new ServidorSsh(this.maquina);
          const candidato: Usuario | undefined = this.maquina.contas.usuario(this.loginPendente);
          if (candidato !== undefined && servidor.aceitaChave(candidato, CHAVE_DO_NOTEBOOK)) {
            servidor.registrarEntrada(candidato, this.ip(), 'publickey');
            this.escrever('(autenticado com a chave SSH do notebook: sem senha)\n', 'c-info');
            this.entrar(candidato);
            return;
          }
          if (!servidor.aceitaSenha()) {
            servidor.registrarRecusaPorChave(this.loginPendente, this.ip());
            this.escrever(this.loginPendente + '@' + ClasseMaquina.IP + ': Permission denied (publickey).\n', 'c-erro');
            this.escrever('(o servidor só aceita chave SSH: PasswordAuthentication no)\n', 'c-info');
            this.desconectar();
            return;
          }
        }
        this.estado = 'login-senha';
        this.tentativasDeSenha = 0;
        this.rotulo = this.loginPendente + '@' + ClasseMaquina.IP + "'s password: ";
        this.oculto = true;
        this.renderizarEntrada();
        return;
      }
      case 'login-senha':
        this.validarLogin();
        return;
      case 'desconectado':
        this.limparTela();
        this.pedirLogin();
        return;
      default:
        return;
    }
  }

  private validarLogin(): void {
    this.ecoarEntrada();
    const senha: string = this.buffer;
    this.buffer = '';
    this.cursor = 0;
    const servidor: ServidorSsh = new ServidorSsh(this.maquina);
    const usuario: Usuario | undefined = this.maquina.contas.usuario(this.loginPendente);
    const autenticado: Usuario | null = servidor.autenticarSenha(this.loginPendente, senha, this.ip());
    if (autenticado !== null) {
      this.entrar(autenticado);
      return;
    }
    this.escrever('Access denied\n', 'c-erro');
    if (new Fail2ban(this.maquina).banidos().includes(this.ip())) {
      this.escrever('Connection closed by 192.168.0.10 port 22\n', 'c-erro');
      this.escrever('(o fail2ban acabou de banir o IP ' + this.ip() + ')\n', 'c-info');
      this.desconectar();
      return;
    }
    if (usuario !== undefined && usuario.uid === 0 && servidor.politica().permitRootLogin !== 'yes' && usuario.senha === senha) {
      this.escrever('(o SSH não aceita o root com senha: PermitRootLogin ' + servidor.politica().permitRootLogin + '. Entre como ricardo e use sudo -i)\n', 'c-info');
    } else if (usuario !== undefined && usuario.senha === null) {
      this.escrever('(Dica: ' + usuario.nome + ' ainda não tem senha. No terminal do root, rode: passwd ' + usuario.nome + ')\n', 'c-info');
    } else if (usuario !== undefined && usuario.bloqueado) {
      this.escrever('(Dica: a conta ' + usuario.nome + ' está bloqueada — usermod -U ' + usuario.nome + ' desbloqueia)\n', 'c-info');
    } else if (usuario === undefined) {
      this.escrever('(Dica: o usuário ' + this.loginPendente + ' não existe. Crie com useradd -m -s /bin/bash ' + this.loginPendente + ')\n', 'c-info');
    }
    this.tentativasDeSenha++;
    if (this.tentativasDeSenha >= 3) {
      this.estado = 'login-usuario';
      this.rotulo = 'login as: ';
      this.oculto = false;
    }
    this.renderizarEntrada();
  }

  /** Login aceito: confere o shell (nologin) e abre a sessão. */
  private entrar(usuario: Usuario): void {
    if (usuario.shell.endsWith('nologin') || usuario.shell.endsWith('false')) {
      this.escrever('This account is currently not available.\n');
      this.desconectar();
      return;
    }
    this.iniciarSessao(usuario);
  }

  private async enviarComando(): Promise<void> {
    if (this.sessao === null) return;
    const linha: string = this.buffer;
    this.escreverPrompt();
    this.escrever(linha + '\n');
    this.buffer = '';
    this.cursor = 0;
    this.estado = 'ocupado';
    this.renderizarEntrada();
    try {
      await this.interpretador.executarLinha(linha, this.maquina, this.sessao, this, this);
    } catch (erro) {
      this.escrever('erro interno do simulador: ' + String(erro) + '\n', 'c-erro');
      console.error(erro);
    }
    this.posicaoHistorico = this.sessao?.historico.length ?? 0;
    if (this.estado === 'ocupado') {
      this.estado = 'comando';
    }
    this.renderizarEntrada();
    this.ouvinte.aoMudarTitulo(this);
    this.ouvinte.aoExecutar(this);
  }

  private navegarHistorico(direcao: number): void {
    if (this.estado !== 'comando' || this.sessao === null) return;
    const historico: string[] = this.sessao.historico;
    this.posicaoHistorico = Math.max(0, Math.min(historico.length, this.posicaoHistorico + direcao));
    this.buffer = historico[this.posicaoHistorico] ?? '';
    this.cursor = this.buffer.length;
    this.renderizarEntrada();
  }

  // ───────────── Tab ─────────────

  private completar(): void {
    if (this.sessao === null) return;
    const antes: string = this.buffer.substring(0, this.cursor);
    const inicio: number = Math.max(antes.lastIndexOf(' ') + 1, 0);
    const palavra: string = antes.substring(inicio).replace(/\\ /g, ' ');
    const ehComando: boolean = antes.substring(0, inicio).trim() === '' || /(\||&&|;|sudo)\s*$/.test(antes.substring(0, inicio));
    let opcoes: string[];
    if (ehComando && !palavra.includes('/')) {
      opcoes = this.interpretador.nomesDeComandos().filter((n: string) => n.startsWith(palavra)).map((n: string) => n + ' ');
    } else {
      opcoes = this.completarCaminho(palavra);
    }
    if (opcoes.length === 0) return;
    let comum: string = opcoes[0];
    for (const opcao of opcoes) {
      while (!opcao.startsWith(comum)) comum = comum.substring(0, comum.length - 1);
    }
    const escapado = (t: string): string => t.replace(/ (?!$)/g, '\\ ');
    if (comum.length > palavra.length || opcoes.length === 1) {
      const novo: string = escapado(comum);
      this.buffer = this.buffer.substring(0, inicio) + novo + this.buffer.substring(this.cursor);
      this.cursor = inicio + novo.length;
      this.renderizarEntrada();
      return;
    }
    this.escreverPrompt();
    this.escrever(this.buffer + '\n');
    this.escrever(opcoes.map((o: string) => o.trim().split('/').filter((p: string) => p !== '').pop() + (o.endsWith('/') ? '/' : '')).join('  ') + '\n');
    this.renderizarEntrada();
  }

  private completarCaminho(palavra: string): string[] {
    if (this.sessao === null) return [];
    const barra: number = palavra.lastIndexOf('/');
    const pasta: string = barra >= 0 ? palavra.substring(0, barra + 1) : '';
    const prefixo: string = palavra.substring(barra + 1);
    let alvo: string = pasta === '' ? '.' : pasta;
    if (alvo.startsWith('~')) alvo = this.sessao.atual().usuario.home + alvo.substring(1);
    let dir: No;
    try {
      dir = this.maquina.fs.localizar(alvo, this.sessao.atual().cwd, this.sessao.credencial());
    } catch {
      return [];
    }
    if (!(dir instanceof Diretorio) || !this.maquina.fs.pode(dir, this.sessao.credencial(), 'r')) return [];
    return dir.nomesOrdenados()
      .filter((n: string) => n.startsWith(prefixo) && (prefixo.startsWith('.') || !n.startsWith('.')))
      .map((n: string) => pasta + n + ((dir as Diretorio).obter(n)?.ehDiretorio() ? '/' : ' '));
  }

  // ───────────── desenho da linha de entrada ─────────────

  private escreverPrompt(): void {
    if (this.sessao === null) return;
    const quadro = this.sessao.atual();
    this.escrever(quadro.usuario.nome + '@' + this.maquina.hostname, 'c-prompt-usuario');
    this.escrever(':');
    this.escrever(this.sessao.caminhoCurto(), 'c-prompt-caminho');
    this.escrever(quadro.usuario.uid === 0 ? '# ' : '$ ');
  }

  private ecoarEntrada(): void {
    this.escrever(this.rotulo + (this.oculto ? '' : this.buffer) + '\n');
  }

  private renderizarEntrada(): void {
    this.entrada.innerHTML = '';
    if (this.estado === 'ocupado' || this.estado === 'desconectado' || this.estado === 'editor') {
      return;
    }
    const adicionar = (texto: string, classe: string): void => {
      const trecho: HTMLSpanElement = document.createElement('span');
      trecho.textContent = texto;
      trecho.className = classe;
      this.entrada.appendChild(trecho);
    };
    if (this.estado === 'comando' && this.sessao !== null) {
      const quadro = this.sessao.atual();
      adicionar(quadro.usuario.nome + '@' + this.maquina.hostname, 'c-prompt-usuario');
      adicionar(':', '');
      adicionar(this.sessao.caminhoCurto(), 'c-prompt-caminho');
      adicionar(quadro.usuario.uid === 0 ? '# ' : '$ ', '');
    } else {
      adicionar(this.rotulo, '');
    }
    const visivel: string = this.oculto && this.estado !== 'comando' ? '' : this.buffer;
    const posicao: number = this.oculto && this.estado !== 'comando' ? 0 : this.cursor;
    adicionar(visivel.substring(0, posicao), '');
    adicionar(visivel.charAt(posicao) || ' ', 'term-cursor');
    adicionar(visivel.substring(posicao + 1), '');
    this.rolar();
  }
}
