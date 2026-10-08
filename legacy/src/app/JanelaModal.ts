/** Janela sobreposta usada para "Conceito" e "Materiais". */
export class JanelaModal {
  private readonly fundo: HTMLElement;
  private readonly titulo: HTMLElement;
  private readonly conteudo: HTMLElement;

  constructor() {
    this.fundo = document.createElement('div');
    this.fundo.className = 'modal-fundo';
    this.fundo.innerHTML =
      '<div class="modal"><header><h2></h2><button class="botao-fechar" title="Fechar">✕</button></header>' +
      '<div class="modal-conteudo"></div></div>';
    this.titulo = this.fundo.querySelector('h2') as HTMLElement;
    this.conteudo = this.fundo.querySelector('.modal-conteudo') as HTMLElement;
    (this.fundo.querySelector('.botao-fechar') as HTMLElement).addEventListener('click', () => this.fechar());
    this.fundo.addEventListener('click', (evento: MouseEvent) => {
      if (evento.target === this.fundo) {
        this.fechar();
      }
    });
    document.body.appendChild(this.fundo);
  }

  public abrir(titulo: string, html: string): void {
    this.titulo.textContent = titulo;
    this.conteudo.innerHTML = html;
    this.fundo.classList.add('aberto');
  }

  public fechar(): void {
    this.fundo.classList.remove('aberto');
  }

  public destruir(): void {
    this.fundo.remove();
  }
}
