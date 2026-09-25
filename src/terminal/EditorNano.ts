import type { PedidoDeEdicao } from '../shell/Contexto';

/**
 * nano simplificado: digita-se direto no texto.
 * Ctrl+O grava (confirmando o nome com Enter), Ctrl+X sai (perguntando se quer salvar), Ctrl+K recorta a linha, Ctrl+U cola.
 */
export class EditorNano {
  private readonly pedido: PedidoDeEdicao;
  private readonly aoFechar: () => void;
  private readonly texto: HTMLTextAreaElement;
  private readonly estado: HTMLElement;
  private readonly indicador: HTMLElement;
  private original: string;
  private recortado: string = '';
  /** Quando não é null, o nano está esperando uma resposta na barra de baixo. */
  private aguardando: 'gravar' | 'salvar-ao-sair' | null = null;
  private sairDepoisDeGravar: boolean = false;

  constructor(container: HTMLElement, pedido: PedidoDeEdicao, aoFechar: () => void) {
    this.pedido = pedido;
    this.aoFechar = aoFechar;
    this.original = pedido.conteudo;
    container.innerHTML =
      '<div class="nano">' +
      '  <div class="nano-topo"><span>GNU nano 7.2</span><span class="nano-nome"></span><span class="nano-mod"></span></div>' +
      '  <textarea class="nano-texto" spellcheck="false"></textarea>' +
      '  <div class="nano-estado"></div>' +
      '  <div class="nano-atalhos">' +
      '    <button data-nano="ajuda"><b>^G</b> Ajuda</button><button data-nano="gravar"><b>^O</b> Gravar</button>' +
      '    <button data-nano="recortar"><b>^K</b> Recortar</button><button data-nano="colar"><b>^U</b> Colar</button>' +
      '    <button data-nano="sair"><b>^X</b> Sair</button>' +
      '  </div>' +
      '</div>';
    (container.querySelector('.nano-nome') as HTMLElement).textContent = pedido.caminho;
    this.indicador = container.querySelector('.nano-mod') as HTMLElement;
    this.texto = container.querySelector('.nano-texto') as HTMLTextAreaElement;
    this.estado = container.querySelector('.nano-estado') as HTMLElement;
    this.texto.value = pedido.conteudo;
    this.texto.addEventListener('keydown', (evento: KeyboardEvent) => this.teclar(evento));
    this.texto.addEventListener('input', () => this.atualizarIndicador());
    container.querySelectorAll('[data-nano]').forEach((botao: Element) => {
      botao.addEventListener('click', () => {
        this.executar((botao as HTMLElement).dataset.nano as string);
        this.texto.focus();
      });
    });

    if (pedido.aviso !== null) {
      this.mostrar('[ ' + pedido.aviso + ' ]', true);
    } else if (pedido.novo) {
      this.mostrar('[ Novo arquivo ]');
    } else {
      const linhas: number = pedido.conteudo === '' ? 0 : pedido.conteudo.split('\n').length - (pedido.conteudo.endsWith('\n') ? 1 : 0);
      this.mostrar('[ ' + linhas + ' linhas lidas ]' + (pedido.somenteLeitura ? '  (somente leitura: você não tem permissão de escrita)' : ''));
    }
    this.texto.setSelectionRange(0, 0);
    window.setTimeout(() => this.texto.focus(), 0);
  }

  private teclar(evento: KeyboardEvent): void {
    const letra: string = evento.key.toLowerCase();
    if (this.aguardando === 'salvar-ao-sair') {
      evento.preventDefault();
      if (letra === 's' || letra === 'y') {
        this.aguardando = null;
        this.sairDepoisDeGravar = true;
        this.pedirNome();
      } else if (letra === 'n') {
        this.aoFechar();
      } else if (letra === 'escape' || (evento.ctrlKey && letra === 'c')) {
        this.aguardando = null;
        this.mostrar('[ Cancelado ]');
      }
      return;
    }
    if (!evento.ctrlKey) {
      return;
    }
    const acoes: Record<string, string> = { o: 'gravar', s: 'gravar', x: 'sair', k: 'recortar', u: 'colar', g: 'ajuda' };
    if (acoes[letra] !== undefined) {
      evento.preventDefault();
      this.executar(acoes[letra]);
    }
  }

  private executar(acao: string): void {
    switch (acao) {
      case 'gravar':
        this.sairDepoisDeGravar = false;
        this.pedirNome();
        break;
      case 'sair':
        if (this.texto.value === this.original) {
          this.aoFechar();
        } else {
          this.aguardando = 'salvar-ao-sair';
          this.mostrar('Salvar o buffer modificado?   S Sim   N Não   ^C Cancelar', false, true);
        }
        break;
      case 'recortar': this.recortarLinha(); break;
      case 'colar': this.colar(); break;
      case 'ajuda':
        this.mostrar('Ajuda: ^O grava · ^X sai · ^K recorta a linha · ^U cola · setas movem o cursor');
        break;
    }
  }

  /** Barra "Nome do arquivo para gravar:" — Enter confirma, Esc cancela. */
  private pedirNome(): void {
    this.aguardando = 'gravar';
    this.estado.innerHTML = '<label class="nano-pergunta">Nome do arquivo para gravar: <input type="text" spellcheck="false"></label>';
    this.estado.className = 'nano-estado ativo';
    const campo: HTMLInputElement = this.estado.querySelector('input') as HTMLInputElement;
    campo.value = this.pedido.caminho;
    campo.focus();
    campo.addEventListener('keydown', (evento: KeyboardEvent) => {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        this.aguardando = null;
        this.gravar();
      } else if (evento.key === 'Escape' || (evento.ctrlKey && evento.key.toLowerCase() === 'c')) {
        evento.preventDefault();
        this.aguardando = null;
        this.mostrar('[ Cancelado ]');
        this.texto.focus();
      }
    });
  }

  private gravar(): void {
    const conteudo: string = this.texto.value;
    // como o nano real, garante a quebra de linha no fim do arquivo
    const erro: string | null = this.pedido.gravar(conteudo !== '' && !conteudo.endsWith('\n') ? conteudo + '\n' : conteudo);
    if (erro !== null) {
      this.mostrar('[ Erro ao gravar ' + this.pedido.caminho + ': ' + erro + ' ]', true);
      this.texto.focus();
      return;
    }
    this.original = conteudo;
    this.atualizarIndicador();
    const linhas: number = conteudo === '' ? 0 : conteudo.split('\n').length - (conteudo.endsWith('\n') ? 1 : 0);
    this.mostrar('[ ' + linhas + (linhas === 1 ? ' linha gravada' : ' linhas gravadas') + ' ]');
    if (this.sairDepoisDeGravar) {
      this.aoFechar();
      return;
    }
    this.texto.focus();
  }

  private recortarLinha(): void {
    const valor: string = this.texto.value;
    const inicio: number = valor.lastIndexOf('\n', this.texto.selectionStart - 1) + 1;
    let fim: number = valor.indexOf('\n', this.texto.selectionStart);
    fim = fim < 0 ? valor.length : fim + 1;
    this.recortado = valor.substring(inicio, fim);
    this.texto.value = valor.substring(0, inicio) + valor.substring(fim);
    this.texto.setSelectionRange(inicio, inicio);
    this.atualizarIndicador();
  }

  private colar(): void {
    const posicao: number = this.texto.selectionStart;
    const valor: string = this.texto.value;
    const inicio: number = valor.lastIndexOf('\n', posicao - 1) + 1;
    this.texto.value = valor.substring(0, inicio) + this.recortado + valor.substring(inicio);
    this.texto.setSelectionRange(inicio + this.recortado.length, inicio + this.recortado.length);
    this.atualizarIndicador();
  }

  private atualizarIndicador(): void {
    this.indicador.textContent = this.texto.value !== this.original ? 'Modificado' : '';
  }

  private mostrar(mensagem: string, erro: boolean = false, pergunta: boolean = false): void {
    this.estado.textContent = mensagem;
    this.estado.className = 'nano-estado' + (erro ? ' erro' : '') + (pergunta ? ' ativo' : '');
  }
}
