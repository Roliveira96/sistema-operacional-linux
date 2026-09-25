import { Maquina } from '../linux/Maquina';
import { Serializador, type MaquinaJson } from '../linux/Serializador';

/** Guarda a máquina de cada tela no navegador (localStorage) e exporta/importa o JSON. */
export class ArmazemDeMaquinas {
  private static readonly PREFIXO: string = 'exame-so:maquina:';

  public static carregar(chave: string): Maquina | null {
    try {
      const texto: string | null = localStorage.getItem(ArmazemDeMaquinas.PREFIXO + chave);
      return texto !== null ? Serializador.deJson(JSON.parse(texto) as MaquinaJson) : null;
    } catch {
      return null;
    }
  }

  public static salvar(chave: string, maquina: Maquina): void {
    try {
      localStorage.setItem(ArmazemDeMaquinas.PREFIXO + chave, JSON.stringify(Serializador.paraJson(maquina)));
    } catch {
      // sem armazenamento: a máquina vive só enquanto a página estiver aberta
    }
  }

  public static apagar(chave: string): void {
    try {
      localStorage.removeItem(ArmazemDeMaquinas.PREFIXO + chave);
    } catch {
      // nada a apagar
    }
  }

  /** Baixa a máquina como arquivo .json. */
  public static baixar(maquina: Maquina, nome: string): void {
    const texto: string = JSON.stringify(Serializador.paraJson(maquina), null, 2);
    const link: HTMLAnchorElement = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    link.download = nome + '.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /** Abre o seletor de arquivos e devolve a máquina lida do JSON escolhido. */
  public static importar(): Promise<Maquina> {
    return new Promise((resolver, rejeitar) => {
      const seletor: HTMLInputElement = document.createElement('input');
      seletor.type = 'file';
      seletor.accept = 'application/json,.json';
      seletor.addEventListener('change', async () => {
        const arquivo: File | undefined = seletor.files?.[0];
        if (arquivo === undefined) return;
        try {
          resolver(Serializador.deJson(JSON.parse(await arquivo.text()) as MaquinaJson));
        } catch (erro) {
          rejeitar(erro);
        }
      });
      seletor.click();
    });
  }

  public static nova(): Maquina {
    return Maquina.criar();
  }
}
