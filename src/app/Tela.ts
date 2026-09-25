/** Toda tela do site sabe se montar num container e se desmontar ao sair. */
export interface Tela {
  montar(raiz: HTMLElement): void;
  desmontar(): void;
}
