import type { Maquina } from '../linux/Maquina';
import type { Usuario } from '../linux/Contas';
import { TerminalUbuntu, type OuvinteDoTerminal } from './TerminalUbuntu';

export interface OuvinteDaJanela {
  aoExecutar(): void;
}

/**
 * A janela do GNOME Terminal com até 3 abas, cada uma uma conexão SSH à mesma máquina.
 * A aba 1 já nasce logada como root; as outras pedem usuário e senha.
 */
export class JanelaDeTerminais implements OuvinteDoTerminal {
  public static readonly MAXIMO: number = 3;

  private maquina: Maquina;
  private readonly ouvinte: OuvinteDaJanela;
  private readonly abas: HTMLElement;
  private readonly corpo: HTMLElement;
  private readonly botaoNovo: HTMLButtonElement;
  private readonly botaoDividir: HTMLButtonElement;
  private readonly terminais: Array<TerminalUbuntu | null> = [null, null, null];
  private ativo: number = 1;
  private dividida: boolean = false;
  private velocidade: number = 1;

  constructor(container: HTMLElement, maquina: Maquina, ouvinte: OuvinteDaJanela, emColunas: boolean = false) {
    this.maquina = maquina;
    this.ouvinte = ouvinte;
    container.innerHTML =
      '<div class="janela' + (emColunas ? ' em-colunas' : '') + '">' +
      '  <div class="janela-barra">' +
      '    <div class="janela-abas" role="tablist"></div>' +
      '    <button class="janela-nova" title="Abrir outra conexão SSH (até 3 terminais)">＋</button>' +
      '    <span class="janela-espaco"></span>' +
      '    <button class="janela-dividir" title="Ver todos os terminais ao mesmo tempo">⊞ Lado a lado</button>' +
      '    <span class="janela-botoes" aria-hidden="true"><i></i><i></i><i class="fechar"></i></span>' +
      '  </div>' +
      '  <div class="janela-corpo"></div>' +
      '</div>';
    this.abas = container.querySelector('.janela-abas') as HTMLElement;
    this.corpo = container.querySelector('.janela-corpo') as HTMLElement;
    this.botaoNovo = container.querySelector('.janela-nova') as HTMLButtonElement;
    this.botaoDividir = container.querySelector('.janela-dividir') as HTMLButtonElement;
    this.botaoNovo.addEventListener('click', () => this.abrir());
    this.botaoDividir.addEventListener('click', () => this.alternarDivisao());
    this.iniciar();
  }

  private iniciar(): void {
    const terminal: TerminalUbuntu = this.criar(1);
    terminal.conectarDireto(this.maquina.contas.usuario('root') as Usuario);
    this.selecionar(1);
  }

  /** Abre a próxima conexão livre (2 ou 3), que começa pedindo login. */
  public abrir(): number | null {
    const livre: number = this.terminais.findIndex((t: TerminalUbuntu | null) => t === null);
    if (livre < 0) {
      return null;
    }
    const terminal: TerminalUbuntu = this.criar(livre + 1);
    terminal.pedirLogin();
    this.selecionar(livre + 1);
    return livre + 1;
  }

  /** Para os roteiros: garante o terminal N aberto e, se pedido, logado como alguém. */
  public async obter(numero: number, login?: { usuario: string; senha: string }): Promise<TerminalUbuntu> {
    let terminal: TerminalUbuntu | null = this.terminais[numero - 1];
    if (terminal === null) {
      terminal = this.criar(numero);
      if (numero === 1) {
        terminal.conectarDireto(this.maquina.contas.usuario('root') as Usuario);
      } else {
        terminal.pedirLogin();
      }
    }
    this.selecionar(numero);
    if (login !== undefined && terminal.usuarioAtual() === null) {
      await terminal.loginAutomatico(login.usuario, login.senha);
    }
    return terminal;
  }

  public fechar(numero: number): void {
    const terminal: TerminalUbuntu | null = this.terminais[numero - 1];
    if (terminal === null || numero === 1) {
      return;
    }
    terminal.destruir();
    this.terminais[numero - 1] = null;
    if (this.ativo === numero) {
      this.selecionar(1);
    }
    this.atualizar();
  }

  /** Troca a máquina (reinício ou importação): fecha tudo e reabre o terminal do root. */
  public trocarMaquina(maquina: Maquina): void {
    for (let i: number = 0; i < JanelaDeTerminais.MAXIMO; i++) {
      this.terminais[i]?.destruir();
      this.terminais[i] = null;
    }
    this.maquina = maquina;
    this.iniciar();
  }

  public definirVelocidade(velocidade: number): void {
    this.velocidade = velocidade;
    for (const terminal of this.terminais) terminal?.definirVelocidade(velocidade);
  }

  public destruir(): void {
    for (const terminal of this.terminais) terminal?.destruir();
  }

  public focar(): void {
    this.terminais[this.ativo - 1]?.focar();
  }

  // OuvinteDoTerminal
  public aoExecutar(): void {
    this.ouvinte.aoExecutar();
  }

  public aoMudarTitulo(): void {
    this.atualizar();
  }

  private criar(numero: number): TerminalUbuntu {
    const terminal: TerminalUbuntu = new TerminalUbuntu(numero, this.maquina, this);
    terminal.definirVelocidade(this.velocidade);
    terminal.elemento.dataset.numero = String(numero);
    terminal.elemento.addEventListener('mousedown', () => {
      if (this.dividida && this.ativo !== numero) this.selecionar(numero, false);
    });
    this.terminais[numero - 1] = terminal;
    const depois: TerminalUbuntu | undefined = this.terminais.slice(numero).find((t) => t !== null) ?? undefined;
    this.corpo.insertBefore(terminal.elemento, depois !== undefined ? depois.elemento : null);
    return terminal;
  }

  private selecionar(numero: number, focar: boolean = true): void {
    this.ativo = numero;
    this.atualizar();
    if (focar) {
      window.setTimeout(() => this.terminais[numero - 1]?.focar(), 0);
    }
  }

  private alternarDivisao(): void {
    this.dividida = !this.dividida;
    if (this.dividida && this.terminais.filter((t) => t !== null).length === 1) {
      this.abrir();
    }
    this.atualizar();
  }

  private atualizar(): void {
    const abertos: TerminalUbuntu[] = this.terminais.filter((t): t is TerminalUbuntu => t !== null);
    this.abas.innerHTML = '';
    for (const terminal of abertos) {
      const aba: HTMLElement = document.createElement('div');
      aba.className = 'janela-aba' + (terminal.numero === this.ativo ? ' ativa' : '');
      aba.setAttribute('role', 'tab');
      const usuario: string | null = terminal.usuarioAtual();
      aba.innerHTML = '<span class="aba-numero"></span><span class="aba-titulo"></span>' +
        (terminal.numero > 1 ? '<button class="aba-fechar" title="Fechar esta conexão">✕</button>' : '');
      (aba.querySelector('.aba-numero') as HTMLElement).textContent = String(terminal.numero);
      (aba.querySelector('.aba-titulo') as HTMLElement).textContent = terminal.titulo();
      aba.classList.toggle('root', usuario === 'root');
      aba.addEventListener('click', () => this.selecionar(terminal.numero));
      aba.querySelector('.aba-fechar')?.addEventListener('click', (evento: Event) => {
        evento.stopPropagation();
        this.fechar(terminal.numero);
      });
      this.abas.appendChild(aba);
      terminal.elemento.classList.toggle('visivel', this.dividida || terminal.numero === this.ativo);
      terminal.elemento.classList.toggle('ativo', terminal.numero === this.ativo);
    }
    this.corpo.classList.toggle('dividida', this.dividida);
    this.corpo.style.setProperty('--quantidade', String(abertos.length));
    this.botaoNovo.disabled = abertos.length >= JanelaDeTerminais.MAXIMO;
    this.botaoDividir.classList.toggle('ligado', this.dividida);
  }
}
