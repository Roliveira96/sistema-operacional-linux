import type { Tela } from './Tela';
import { TelaMenu } from './TelaMenu';
import { TelaLaboratorio } from './TelaLaboratorio';
import { TelaTopico } from './TelaTopico';
import { TelaSimulado } from './TelaSimulado';
import { CatalogoDeTopicos } from '../conteudo/CatalogoDeTopicos';
import type { Topico } from '../conteudo/Topico';

/** Navega entre o menu, os tópicos e o laboratório pelo endereço (#/permissoes, #/laboratorio...). */
export class Aplicacao {
  private readonly raiz: HTMLElement;
  private readonly catalogo: CatalogoDeTopicos = new CatalogoDeTopicos();
  private telaAtual: Tela | null = null;

  private hashAtual: string = window.location.hash;

  constructor(raiz: HTMLElement) {
    this.raiz = raiz;
  }

  public iniciar(): void {
    window.addEventListener('hashchange', () => this.navegar());
    this.navegar();
  }

  private navegar(): void {
    if (this.telaAtual?.podeSair && !this.telaAtual.podeSair()) {
      // Cancela a navegação restaurando a rota anterior
      window.history.pushState(null, '', this.hashAtual || '#/simulado');
      return;
    }
    this.hashAtual = window.location.hash;

    const id: string = window.location.hash.replace('#/', '');
    if (id === 'laboratorio') {
      this.trocarTela(new TelaLaboratorio());
      return;
    }
    if (id === 'simulado') {
      this.trocarTela(new TelaSimulado());
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
