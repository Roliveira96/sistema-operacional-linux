import type { Maquina } from '../linux/Maquina';
import { JanelaDeTerminais } from '../terminal/JanelaDeTerminais';
import { ArmazemDeMaquinas } from './ArmazemDeMaquinas';
import { Aviso } from './Aviso';

/**
 * A máquina de uma tela + a janela de terminais ligada a ela.
 * Salva sozinha a cada comando; reiniciar, exportar e importar ficam aqui.
 */
export class Bancada {
  private readonly chave: string;
  private readonly preparar: (maquina: Maquina) => void;
  private readonly aoExecutar: (maquina: Maquina) => void;
  private maquina: Maquina;
  public readonly janela: JanelaDeTerminais;

  constructor(container: HTMLElement, chave: string, preparar: (maquina: Maquina) => void,
    aoExecutar: (maquina: Maquina) => void, emColunas: boolean = false) {
    this.chave = chave;
    this.preparar = preparar;
    this.aoExecutar = aoExecutar;
    this.maquina = ArmazemDeMaquinas.carregar(chave) ?? this.criarNova();
    this.janela = new JanelaDeTerminais(container, this.maquina, {
      aoExecutar: () => {
        ArmazemDeMaquinas.salvar(this.chave, this.maquina);
        this.aoExecutar(this.maquina);
      },
    }, emColunas);
  }

  public obterMaquina(): Maquina {
    return this.maquina;
  }

  public reiniciar(silencioso: boolean = false): void {
    ArmazemDeMaquinas.apagar(this.chave);
    this.trocar(this.criarNova());
    if (!silencioso) Aviso.mostrar('🔄 Máquina reiniciada do zero');
  }

  public exportar(): void {
    ArmazemDeMaquinas.baixar(this.maquina, 'maquina-' + this.chave);
    Aviso.mostrar('💾 JSON da máquina baixado');
  }

  public async importar(): Promise<void> {
    try {
      const maquina: Maquina = await ArmazemDeMaquinas.importar();
      this.trocar(maquina);
      ArmazemDeMaquinas.salvar(this.chave, maquina);
      Aviso.mostrar('📂 Máquina importada do JSON');
    } catch (erro) {
      Aviso.mostrar('⚠️ ' + (erro instanceof Error ? erro.message : 'Não foi possível ler o JSON'));
    }
  }

  public destruir(): void {
    this.janela.destruir();
  }

  private trocar(maquina: Maquina): void {
    this.maquina = maquina;
    this.janela.trocarMaquina(maquina);
    this.aoExecutar(maquina);
  }

  private criarNova(): Maquina {
    const maquina: Maquina = ArmazemDeMaquinas.nova();
    this.preparar(maquina);
    return maquina;
  }
}
