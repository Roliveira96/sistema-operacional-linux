import type { Tela } from './Tela';
import { TelaMenu } from './TelaMenu';
import { TelaLaboratorio } from './TelaLaboratorio';
import { TelaTopico } from './TelaTopico';
import { CatalogoDeTopicos } from '../conteudo/CatalogoDeTopicos';
import type { Topico } from '../conteudo/Topico';

/** Navega entre o menu, os tópicos e o laboratório pelo endereço (#/permissoes, #/laboratorio...). */
export class Aplicacao {
  private readonly raiz: HTMLElement;
  private readonly catalogo: CatalogoDeTopicos = new CatalogoDeTopicos();
  private telaAtual: Tela | null = null;

  constructor(raiz: HTMLElement) {
    this.raiz = raiz;
  }

  public iniciar(): void {
    window.addEventListener('hashchange', () => this.navegar());
    this.navegar();
  }

  private navegar(): void {
    const id: string = window.location.hash.replace('#/', '');
    if (id === 'laboratorio') {
      this.trocarTela(new TelaLaboratorio());
      return;
    }
    const topico: Topico | undefined = this.catalogo.obter(id);
    this.trocarTela(topico !== undefined ? new TelaTopico(topico) : new TelaMenu(this.catalogo));
  }

  private trocarTela(novaTela: Tela): void {
    this.telaAtual?.desmontar();
    this.telaAtual = novaTela;
    this.raiz.innerHTML = '';
    novaTela.montar(this.raiz);
    window.scrollTo(0, 0);
  }
}
