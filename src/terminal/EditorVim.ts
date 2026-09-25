import type { PedidoDeEdicao } from '../shell/Contexto';

type Modo = 'normal' | 'insercao' | 'comando';

/**
 * vim simplificado com os três modos que caem em prova:
 * NORMAL (navegar: h j k l, x, dd, i a o), INSERÇÃO (digitar) e COMANDO (:w :q :wq :q!).
 */
export class EditorVim {
  private readonly pedido: PedidoDeEdicao;
  private readonly aoFechar: () => void;
  private readonly texto: HTMLTextAreaElement;
  private readonly barra: HTMLElement;
  private readonly linhaComando: HTMLInputElement;
  private readonly posicao: HTMLElement;
  private modo: Modo = 'normal';
  private original: string;
  private pendente: string = '';
  private avisouSomenteLeitura: boolean = false;

  constructor(container: HTMLElement, pedido: PedidoDeEdicao, aoFechar: () => void) {
    this.pedido = pedido;
    this.aoFechar = aoFechar;
    this.original = pedido.conteudo;
    container.innerHTML =
      '<div class="vim">' +
      '  <textarea class="vim-texto" spellcheck="false"></textarea>' +
      '  <div class="vim-rodape"><span class="vim-barra"></span><input class="vim-comando" spellcheck="false" hidden>' +
      '    <span class="vim-posicao"></span></div>' +
      '  <div class="vim-cola">NORMAL: <b>i</b> inserir · <b>a</b> após · <b>o</b> nova linha · <b>x</b> apaga letra · <b>dd</b> apaga linha · ' +
      '<b>h j k l</b> move &nbsp;|&nbsp; <b>Esc</b> volta ao NORMAL &nbsp;|&nbsp; <b>:w</b> grava · <b>:q</b> sai · <b>:wq</b> grava e sai · <b>:q!</b> sai sem gravar</div>' +
      '</div>';
    this.texto = container.querySelector('.vim-texto') as HTMLTextAreaElement;
    this.barra = container.querySelector('.vim-barra') as HTMLElement;
    this.linhaComando = container.querySelector('.vim-comando') as HTMLInputElement;
    this.posicao = container.querySelector('.vim-posicao') as HTMLElement;
    this.texto.value = pedido.conteudo;
    this.texto.addEventListener('keydown', (evento: KeyboardEvent) => this.teclar(evento));
    this.texto.addEventListener('keyup', () => this.atualizarPosicao());
    this.texto.addEventListener('click', () => this.atualizarPosicao());
    this.texto.addEventListener('input', () => this.aoDigitar());
    this.linhaComando.addEventListener('keydown', (evento: KeyboardEvent) => this.teclarComando(evento));

    if (pedido.aviso !== null) {
      this.mostrar('"' + pedido.caminho + '" [' + pedido.aviso + ']', true);
    } else if (pedido.novo) {
      this.mostrar('"' + pedido.caminho + '" [Novo]');
    } else {
      const linhas: number = pedido.conteudo === '' ? 0 : pedido.conteudo.split('\n').length - (pedido.conteudo.endsWith('\n') ? 1 : 0);
      this.mostrar('"' + pedido.caminho + '"' + (pedido.somenteLeitura ? ' [somente leitura]' : '') + ' ' + linhas + 'L, ' +
        new TextEncoder().encode(pedido.conteudo).length + 'B');
    }
    this.mudarModo('normal', false);
    this.texto.setSelectionRange(0, 0);
    window.setTimeout(() => this.texto.focus(), 0);
  }

  private mudarModo(modo: Modo, limparBarra: boolean = true): void {
    this.modo = modo;
    this.texto.readOnly = modo !== 'insercao';
    this.texto.classList.toggle('inserindo', modo === 'insercao');
    if (modo === 'insercao') {
      this.mostrar('-- INSERÇÃO --', false, true);
    } else if (limparBarra) {
      this.mostrar('');
    }
    this.linhaComando.hidden = modo !== 'comando';
    this.barra.hidden = modo === 'comando';
    if (modo === 'comando') {
      this.linhaComando.value = ':';
      this.linhaComando.focus();
    } else {
      this.texto.focus();
    }
  }

  private aoDigitar(): void {
    if (this.pedido.somenteLeitura && !this.avisouSomenteLeitura) {
      this.avisouSomenteLeitura = true;
      this.mostrar('W10: Aviso: Modificando um arquivo somente leitura', true);
    }
    this.atualizarPosicao();
  }

  private teclar(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      if (this.modo === 'insercao') {
        const p: number = Math.max(this.linhaInicio(this.texto.selectionStart), this.texto.selectionStart - 1);
        this.texto.setSelectionRange(p, p);
      }
      this.pendente = '';
      this.mudarModo('normal');
      return;
    }
    if (this.modo !== 'normal' || evento.ctrlKey || evento.metaKey) {
      return;
    }
    const tecla: string = evento.key;
    if (tecla.startsWith('Arrow')) {
      return;
    }
    evento.preventDefault();
    const valor: string = this.texto.value;
    const pos: number = this.texto.selectionStart;
    const comando: string = this.pendente + tecla;
    this.pendente = '';
    switch (comando) {
      case 'i': this.mudarModo('insercao'); break;
      case 'a': this.irPara(Math.min(pos + 1, this.linhaFim(pos))); this.mudarModo('insercao'); break;
      case 'A': this.irPara(this.linhaFim(pos)); this.mudarModo('insercao'); break;
      case 'I': this.irPara(this.linhaInicio(pos)); this.mudarModo('insercao'); break;
      case 'o': {
        const fim: number = this.linhaFim(pos);
        this.editarValor(valor.substring(0, fim) + '\n' + valor.substring(fim), fim + 1);
        this.mudarModo('insercao');
        break;
      }
      case 'O': {
        const inicio: number = this.linhaInicio(pos);
        this.editarValor(valor.substring(0, inicio) + '\n' + valor.substring(inicio), inicio);
        this.mudarModo('insercao');
        break;
      }
      case 'x':
        if (pos < this.linhaFim(pos)) this.editarValor(valor.substring(0, pos) + valor.substring(pos + 1), pos);
        break;
      case 'dd': {
        const inicio: number = this.linhaInicio(pos);
        let fim: number = this.linhaFim(pos);
        fim = fim < valor.length ? fim + 1 : fim;
        const inicioReal: number = fim === valor.length && inicio > 0 ? inicio - 1 : inicio;
        this.editarValor(valor.substring(0, inicioReal) + valor.substring(fim), Math.min(inicioReal, valor.length));
        break;
      }
      case 'h': this.irPara(Math.max(this.linhaInicio(pos), pos - 1)); break;
      case 'l': this.irPara(Math.min(this.linhaFim(pos), pos + 1)); break;
      case 'j': this.moverLinha(pos, 1); break;
      case 'k': this.moverLinha(pos, -1); break;
      case '0': this.irPara(this.linhaInicio(pos)); break;
      case '$': this.irPara(this.linhaFim(pos)); break;
      case 'gg': this.irPara(0); break;
      case 'G': this.irPara(this.linhaInicio(valor.length)); break;
      case ':': this.mudarModo('comando'); break;
      case 'd':
      case 'g':
        this.pendente = tecla;
        break;
      default:
        break;
    }
    this.atualizarPosicao();
  }

  private teclarComando(evento: KeyboardEvent): void {
    if (evento.key === 'Escape' || (evento.key === 'Backspace' && this.linhaComando.value === ':')) {
      evento.preventDefault();
      this.mudarModo('normal');
      return;
    }
    if (evento.key !== 'Enter') {
      return;
    }
    evento.preventDefault();
    const comando: string = this.linhaComando.value.replace(/^:/, '').trim();
    this.mudarModo('normal');
    this.executar(comando);
  }

  private executar(comando: string): void {
    const modificado: boolean = this.texto.value !== this.original;
    const forcar: boolean = comando.endsWith('!');
    const base: string = comando.replace(/!$/, '');
    if (base === 'q') {
      if (modificado && !forcar) {
        this.mostrar('E37: Nenhuma gravação desde a última alteração (adicione ! para forçar)', true);
        return;
      }
      this.aoFechar();
      return;
    }
    if (base === 'w' || base === 'wq' || base === 'x') {
      if (base === 'x' && !modificado) {
        this.aoFechar();
        return;
      }
      if (this.pedido.somenteLeitura && !forcar) {
        this.mostrar("E45: A opção 'readonly' está ativada (adicione ! para forçar)", true);
        return;
      }
      const valor: string = this.texto.value;
      // o vim sempre grava a última linha com quebra de linha
      const erro: string | null = this.pedido.gravar(valor !== '' && !valor.endsWith('\n') ? valor + '\n' : valor);
      if (erro !== null) {
        this.mostrar('"' + this.pedido.caminho + '" E212: Não é possível abrir o arquivo para escrita (' + erro + ')', true);
        return;
      }
      this.original = this.texto.value;
      const linhas: number = this.texto.value === '' ? 0 : this.texto.value.split('\n').length - (this.texto.value.endsWith('\n') ? 1 : 0);
      this.mostrar('"' + this.pedido.caminho + '" ' + linhas + 'L, ' + new TextEncoder().encode(this.texto.value).length + 'B gravado(s)');
      if (base !== 'w') {
        this.aoFechar();
      }
      return;
    }
    if (comando === '') {
      return;
    }
    this.mostrar('E492: Não é um comando do editor: ' + comando, true);
  }

  private editarValor(novo: string, cursor: number): void {
    this.texto.value = novo;
    this.irPara(cursor);
    this.aoDigitar();
  }

  private irPara(posicao: number): void {
    this.texto.setSelectionRange(posicao, posicao);
  }

  private linhaInicio(pos: number): number {
    return this.texto.value.lastIndexOf('\n', pos - 1) + 1;
  }

  private linhaFim(pos: number): number {
    const fim: number = this.texto.value.indexOf('\n', pos);
    return fim < 0 ? this.texto.value.length : fim;
  }

  private moverLinha(pos: number, direcao: number): void {
    const coluna: number = pos - this.linhaInicio(pos);
    if (direcao > 0) {
      const fim: number = this.linhaFim(pos);
      if (fim >= this.texto.value.length) return;
      this.irPara(Math.min(fim + 1 + coluna, this.linhaFim(fim + 1)));
    } else {
      const inicio: number = this.linhaInicio(pos);
      if (inicio === 0) return;
      const anterior: number = this.linhaInicio(inicio - 1);
      this.irPara(Math.min(anterior + coluna, inicio - 1));
    }
  }

  private atualizarPosicao(): void {
    const pos: number = this.texto.selectionStart;
    const linha: number = this.texto.value.substring(0, pos).split('\n').length;
    this.posicao.textContent = linha + ',' + (pos - this.linhaInicio(pos) + 1);
  }

  private mostrar(mensagem: string, erro: boolean = false, destaque: boolean = false): void {
    this.barra.textContent = mensagem;
    this.barra.className = 'vim-barra' + (erro ? ' erro' : '') + (destaque ? ' destaque' : '');
  }
}
