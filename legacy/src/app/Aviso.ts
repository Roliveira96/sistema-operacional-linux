/** Mensagem rápida no rodapé ("Máquina reiniciada", "JSON importado"...). */
export class Aviso {
  private static elemento: HTMLElement | null = null;
  private static temporizador: number | null = null;

  public static mostrar(texto: string): void {
    if (Aviso.elemento === null) {
      Aviso.elemento = document.createElement('div');
      Aviso.elemento.className = 'toast';
      Aviso.elemento.setAttribute('role', 'status');
      document.body.appendChild(Aviso.elemento);
    }
    const elemento: HTMLElement = Aviso.elemento;
    elemento.textContent = texto;
    elemento.classList.add('visivel');
    if (Aviso.temporizador !== null) window.clearTimeout(Aviso.temporizador);
    Aviso.temporizador = window.setTimeout(() => elemento.classList.remove('visivel'), 2600);
  }
}
